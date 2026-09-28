import {SCHEMA_VERSION,HASH} from './model.js';
export function makeBackup(users){return {format:'fox-gallery-user-data',schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),users};}
export function migrateBackup(input){
  if(input?.schemaVersion===0&&Array.isArray(input.users))return {...input,schemaVersion:1,users:input.users.map(u=>({...u,note:u.note??u.notes??''}))};
  return input;
}
export function validateBackup(input){
  const data=migrateBackup(input);
  if(!data||data.format!=='fox-gallery-user-data'||data.schemaVersion!==SCHEMA_VERSION||!Array.isArray(data.users))throw new Error('不支持的备份格式或 schemaVersion');
  if(data.users.length>100000)throw new Error('备份记录过多');
  const seen=new Set();
  const rows=data.users.map((row,index)=>{
    const fail=why=>{throw new Error(`第 ${index+1} 条用户数据：${why}。未写入任何记录。`);};
    if(!row||!HASH.test(row.sha256||''))fail('SHA-256 无效');
    const sha256=row.sha256.toLowerCase();if(seen.has(sha256))fail('重复 SHA-256');seen.add(sha256);
    if(typeof row.favorite!=='boolean')fail('favorite 必须为布尔值');
    if(!Array.isArray(row.tags)||row.tags.length>200||row.tags.some(t=>typeof t!=='string'||t.length>200))fail('tags 无效');
    if(typeof row.category!=='string'||row.category.length>120)fail('category 无效');
    if(typeof row.note!=='string'||row.note.length>20000)fail('note 无效');
    if(row.hidden!==undefined&&typeof row.hidden!=='boolean')fail('hidden 无效');
    return {...row,sha256,tags:[...new Set(row.tags)]};
  });
  return rows;
}
export function restoreSummary(rows,images,users){return {total:rows.length,matched:rows.filter(r=>images.has(r.sha256)).length,orphans:rows.filter(r=>!images.has(r.sha256)).length,conflicts:rows.filter(r=>users.has(r.sha256)).length};}
