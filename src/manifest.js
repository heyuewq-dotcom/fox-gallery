import {HASH,normalizeRecord,mergeImage} from './model.js';
import {newStats,importFiles} from './importer.js';
import {createThumbnail,hashFile,supportedImage} from './media.js';

export function parseCSV(text){
 const rows=[],row=[];let cell='',quoted=false,closed=false;
 const pushCell=()=>{row.push(cell);cell='';closed=false;};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c==='"'){if(cell||closed)throw new Error('CSV 引号位置无效');quoted=true;}
  else if(c===',')pushCell();
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushCell();if(row.some(Boolean))rows.push(row.splice(0));else row.length=0;}
  else{if(closed&&!/\s/.test(c))throw new Error('CSV 引号后的内容无效');if(!closed)cell+=c;}
 }
 if(quoted)throw new Error('CSV 引号未闭合');pushCell();if(row.some(Boolean))rows.push(row);
 const headers=rows.shift()?.map(s=>s.trim().replace(/^\uFEFF/,''));
 if(!headers?.includes('sha256')||!headers.includes('filename')||new Set(headers).size!==headers.length)throw new Error('CSV 必须包含唯一的 filename、sha256 列');
 return rows.map((cells,i)=>{if(cells.length!==headers.length)throw new Error(`CSV 第 ${i+2} 行列数不匹配`);return Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));});
}
export function parseManifest(text,name='manifest.json'){
 if(text.length>40*1024*1024)throw new Error('manifest 超过 40 MB');
 if(/\.csv$/i.test(name))return parseCSV(text);
 const value=JSON.parse(text.replace(/^\uFEFF/,''));
 if(Array.isArray(value))return value;
 if(!value||value.schemaVersion!==1||!Array.isArray(value.images))throw new Error('manifest 应为数组或 {schemaVersion:1, images:[]}');
 return value.images;
}
export function safeRelative(value){
 if(typeof value!=='string'||!value.trim())return '';
 const p=value.replaceAll('\\','/');
 if(/[:\x00-\x1f?#]/.test(p)||p.startsWith('/')||p.split('/').some(s=>s==='..'||s==='.'))throw new Error('manifest 路径必须为安全的本地相对路径');
 return p;
}
export function validateManifestRow(row){
 if(!row||typeof row!=='object'||!HASH.test(row.sha256||''))throw new Error('SHA-256 无效');
 for(const field of ['width','height','size_bytes','fileSize'])if(row[field]!==undefined&&row[field]!==''&&(!Number.isFinite(Number(row[field]))||Number(row[field])<0))throw new Error(`${field} 无效`);
 for(const field of ['thumb','thumbnail','original_rel','filePath'])if(row[field])safeRelative(row[field]);
 return row;
}
export async function importManifest(rows,{store,origin='manifest',resolveMedia,onProgress=()=>{},onImported=()=>{},signal,thumbnailURL}={}){
 const stats=newStats();if(rows.length>100000)throw new Error('manifest 记录过多');
 for(const [index,row] of rows.entries()){
  if(signal?.aborted){stats.cancelled=true;break;}
  try{
   validateManifestRow(row);const next=normalizeRecord(row,{origin,thumbnail:thumbnailURL?.(row)||''});
   const previous=await store.get('images',next.sha256),oldAsset=await store.get('assets',next.sha256);
   const media=await resolveMedia?.(row);
   const merged=mergeImage(previous,next),entries=[['images',[merged]]];
   if(media?.thumbnail||media?.handle)entries.push(['assets',[{...oldAsset,sha256:next.sha256,...(media.thumbnail?{thumbnail:media.thumbnail}:{}),...(media.handle?{handle:media.handle}:{})}]]);
   await store.write(entries);
   if(previous){stats.existing++;stats.duplicates++;if(JSON.stringify(previous)!==JSON.stringify(merged))stats.updated++;}else stats.added++;
   onImported(merged,media?.file);
  }catch(e){stats.errors++;stats.details.push(`记录 ${index+1} ${row?.filename||''}：${e.message}`);}
  finally{stats.processed++;onProgress(stats);if(index%20===0)await new Promise(resolve=>setTimeout(resolve,0));}
 }
 onProgress(stats);return stats;
}
export async function importSelection(input,options){
 const entries=[];for await(const entry of input)entries.push(entry);
 const getFile=async entry=>entry.file||await entry.handle.getFile();
 const paths=new Map(entries.map(e=>[e.path||e.file?.name,e]));const consumed=new Set(),stats=newStats();
 const addStats=s=>{for(const k of ['added','existing','updated','duplicates','errors','skipped','processed'])stats[k]+=s[k];stats.details.push(...s.details);stats.cancelled||=s.cancelled;};
 const progress=s=>options.onProgress?.({...stats,...Object.fromEntries(['added','existing','updated','duplicates','errors','skipped','processed'].map(k=>[k,stats[k]+s[k]])),details:[...stats.details,...s.details]});
 const manifests=entries.filter(e=>/\.(json|csv)$/i.test(e.path||e.file?.name||''));
 for(const entry of manifests){
  if(options.signal?.aborted){stats.cancelled=true;break;}
  const path=entry.path||entry.file.name;consumed.add(entry);
  if(/manifest\.csv$/i.test(path)&&paths.has(path.replace(/\.csv$/i,'.json'))){stats.skipped++;stats.processed++;continue;}
  try{
   const file=await getFile(entry);if(file.size>40*1024*1024)throw new Error('manifest 超过 40 MB');
   const rows=parseManifest(await file.text(),path),base=path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
   const resolveMedia=async row=>{
    const original=safeRelative(row.original_rel||row.filePath||'');const thumb=safeRelative(row.thumb||row.thumbnail||'');
    const originalEntry=original?paths.get(base+original):null;
    const thumbEntry=thumb?(paths.get(base+thumb)||paths.get(base+'thumbs/'+thumb)):null;
    if(thumbEntry)consumed.add(thumbEntry);
    if(originalEntry){consumed.add(originalEntry);const file=await getFile(originalEntry);if(file.size>150*1024*1024)throw new Error('原图超过 150 MB');if(await hashFile(file)!==row.sha256.toLowerCase())throw new Error('原图 SHA-256 与 manifest 不一致');const media=await createThumbnail(file);return {...media,file,handle:originalEntry.handle};}
    if(thumbEntry){const file=await getFile(thumbEntry);if(file.size>20*1024*1024)throw new Error('缩略图超过 20 MB');return await createThumbnail(file);}
   };
   addStats(await importManifest(rows,{...options,resolveMedia,onProgress:progress}));
  }catch(e){stats.errors++;stats.processed++;stats.details.push(`${path}：${e.message}`);}
 }
 // Thumbnail folders are presentation assets, never standalone original content.
 const remaining=entries.filter(e=>!consumed.has(e)&&!/(^|\/)thumbs\//i.test(e.path||''));
 if(!stats.cancelled)addStats(await importFiles(remaining,{...options,onProgress:progress}));
 options.onProgress?.(stats);return stats;
}
