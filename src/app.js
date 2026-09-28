import {openStore} from './store.js';
import {makeBackup,validateBackup,restoreSummary} from './backup.js';
import {emptyUser,categoryOf,isDuplicate,parseTags,filterImages,normalizeRecord,mergeImage,userPatch} from './model.js';

const $ = id => document.getElementById(id);
const state = {images:new Map(),users:new Map(),selected:new Set(),filter:'all',page:0,selecting:false,active:null,busy:false};
const PAGE_SIZE=60;
let store;
const objectUrls = new Map();
function message(text,error=false) { $('status').textContent=text; $('status').classList.toggle('error',error); }
function element(tag,text,className) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function userFor(hash) {return state.users.get(hash) || emptyUser();}
function filtered() {return filterImages([...state.images.values()],state.users,{query:$('search').value,category:$('category-filter').value,filter:state.filter});}

async function thumbnail(image) {
  if (objectUrls.has(image.sha256)) return objectUrls.get(image.sha256);
  const asset = await store.get('assets',image.sha256);
  if (asset?.thumbnail) {const url=URL.createObjectURL(asset.thumbnail);objectUrls.set(image.sha256,url);return url;}
  return image.thumbnail;
}
function refreshCategories() {
  const selected=$('category-filter').value;
  const categories=[...new Set([...state.images.values()].map(i=>categoryOf(i,userFor(i.sha256))))].sort();
  $('category-filter').replaceChildren(new Option('全部分类',''),...categories.map(c=>new Option(c,c)));
  if(categories.includes(selected))$('category-filter').value=selected;
  $('categories').replaceChildren(...categories.map(c=>new Option(c,c)));
}
function render() {
  const rows=filtered();state.page=Math.max(0,Math.min(state.page,Math.ceil(rows.length/PAGE_SIZE)-1));
  $('total').textContent=state.images.size.toLocaleString();
  $('result-count').textContent=`${rows.length} 张图片 · ${[...state.images.values()].reduce((n,i)=>n+i.sources.length,0)} 个文件来源`;
  $('grid').replaceChildren();$('empty').hidden=rows.length>0;
  for(const image of rows.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE)) {
    const hash=image.sha256,user=userFor(hash),card=element('article',undefined,'card');card.dataset.hash=hash;
    card.classList.toggle('selected',state.selected.has(hash));
    const open=element('button',undefined,'image-button');open.setAttribute('aria-label',`查看 ${image.filename}`);
    const placeholder=element('div',undefined,'placeholder');placeholder.append(element('b','◇'),element('small','暂无预览'));open.append(placeholder);
    thumbnail(image).then(url=>{if(!url||!open.isConnected)return;const img=element('img');img.alt=image.filename;img.loading='lazy';img.decoding='async';img.src=url;img.onerror=()=>img.replaceWith(placeholder);open.replaceChildren(img);}).catch(()=>{});
    open.onclick=()=>state.selecting?toggleSelect(hash):showDetail(hash);
    const controls=element('div',undefined,'card-controls');
    if(state.selecting){const label=element('label',undefined,'select-check');const check=element('input');check.type='checkbox';check.checked=state.selected.has(hash);check.setAttribute('aria-label',`选择 ${image.filename}`);check.onchange=()=>toggleSelect(hash);label.append(check);controls.append(label);}
    const heart=element('button',user.favorite?'♥':'♡','heart');heart.setAttribute('aria-label',`${user.favorite?'取消收藏':'收藏'} ${image.filename}`);heart.setAttribute('aria-pressed',String(user.favorite));heart.onclick=()=>saveUsers([hash],{favorite:!userFor(hash).favorite});controls.append(heart);
    const meta=element('div',undefined,'card-meta'),title=element('p',image.filename,'card-title');title.title=image.filename;meta.append(title);
    const pills=element('div',undefined,'pills');pills.append(element('span',categoryOf(image,user),'pill'));if(isDuplicate(image))pills.append(element('span',`重复 · ${image.sources.length}`,'pill duplicate'));for(const tag of user.tags.slice(0,2))pills.append(element('span',`#${tag}`,'pill'));meta.append(pills);
    card.append(open,controls,meta);$('grid').append(card);
  }
  $('page-label').textContent=`${state.page+1} / ${Math.max(1,Math.ceil(rows.length/PAGE_SIZE))}`;$('previous').disabled=!state.page;$('next').disabled=(state.page+1)*PAGE_SIZE>=rows.length;
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter)));
  $('select-mode').setAttribute('aria-pressed',String(state.selecting));$('batch').hidden=!state.selecting;$('selection-count').textContent=`已选 ${state.selected.size} 张`;
}
function toggleSelect(hash){state.selected.has(hash)?state.selected.delete(hash):state.selected.add(hash);render();}
async function saveUsers(hashes,patch) {
  try {const rows=await store.updateUsers(hashes,patch);for(const row of rows)state.users.set(row.sha256,row);refreshCategories();render();return true;}
  catch(error){message(`保存失败：${error.message}。请备份现有用户数据。`,true);return false;}
}
async function showDetail(hash) {
  state.active=hash;const image=state.images.get(hash),user=userFor(hash);$('detail-name').textContent=image.filename;$('detail-image').removeAttribute('src');$('detail-image').alt=image.filename;
  $('preview-hint').textContent='缩略图预览 · 原图仍保留在本地';$('favorite').checked=user.favorite;$('edit-category').value=categoryOf(image,user);$('edit-tags').value=user.tags.join(', ');$('edit-note').value=user.note;$('save-hint').textContent='';
  $('metadata').replaceChildren();for(const [label,value] of [['SHA-256',hash],['尺寸',`${image.width} × ${image.height}`],['文件大小',`${(image.fileSize/1024).toFixed(1)} KB`],['MIME',image.mimeType||'未提供'],['来源',image.source],['重复组',image.duplicateGroup|| (isDuplicate(image)?'相同内容的多个来源':'无')]])$('metadata').append(element('dt',label),element('dd',value));
  $('sources').replaceChildren(...image.sources.map(s=>element('li',`${s.path} · ${s.origin}${s.batch?' · '+s.batch:''}`)));
  if(!$('detail').open)$('detail').showModal();
  const url=await thumbnail(image);if(state.active===hash&&url)$('detail-image').src=url;
}
async function loadStarter() {
  try {message('正在载入 Starter…');const response=await fetch('local-data/starter/manifest.json');if(!response.ok)throw new Error('请先按 README 解压 Starter ZIP');const records=await response.json();
    for(const row of records){const image=normalizeRecord(row,{origin:'starter',thumbnail:row.thumb?'local-data/starter/thumbs/'+encodeURIComponent(row.thumb):''});state.images.set(image.sha256,mergeImage(state.images.get(image.sha256),image));}
    await store.putMany('images',[...state.images.values()]);refreshCategories();render();message(`Starter 已载入：${records.length} 条来源，${state.images.size} 张独立图片。3 条 SVG 没有缩略图。`);
  }catch(e){message(e.message,true);}
}
$('search').oninput=()=>{state.page=0;render();};$('category-filter').onchange=()=>{state.page=0;render();};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;state.page=0;render();});
$('previous').onclick=()=>{state.page--;render();};$('next').onclick=()=>{state.page++;render();window.scrollTo({top:0});};
$('detail-close').onclick=()=>{$('detail').close();state.active=null;};
$('detail-form').onsubmit=async e=>{e.preventDefault();if(await saveUsers([state.active],{favorite:$('favorite').checked,category:$('edit-category').value.trim(),tags:parseTags($('edit-tags').value),note:$('edit-note').value}))$('save-hint').textContent='已保存';};
$('starter').onclick=loadStarter;$('load-starter').onclick=loadStarter;
$('import-open').onclick=()=>$('import-dialog').showModal();$('import-close').onclick=()=>$('import-dialog').close();
$('select-mode').onclick=()=>{state.selecting=!state.selecting;if(!state.selecting)state.selected.clear();render();};
let batchMode='category';
function openBatch(mode){if(!state.selected.size){message('请先选择图片');return;}batchMode=mode;$('batch-title').textContent=mode==='tags'?'批量添加标签':'批量设置分类';$('batch-description').textContent=`将修改 ${state.selected.size} 张图片。${mode==='tags'?'现有标签将保留。':'只改变所选图片的分类。'}`;$('batch-value').value='';$('batch-value').maxLength=mode==='tags'?2000:120;$('batch-label').textContent=mode==='tags'?'标签（逗号分隔）':'分类名称';$('batch-dialog').showModal();}
$('batch-category').onclick=()=>openBatch('category');$('batch-tags').onclick=()=>openBatch('tags');
$('batch-favorite').onclick=async()=>{if(!state.selected.size)return message('请先选择图片');if(await saveUsers([...state.selected],{favorite:true}))message(`已收藏 ${state.selected.size} 张图片`);};
$('batch-cancel').onclick=()=>$('batch-dialog').close();
$('batch-form').onsubmit=async e=>{e.preventDefault();const value=$('batch-value').value.trim();if(!value)return;const patch=batchMode==='tags'?{addTags:parseTags(value)}:{category:value};if(await saveUsers([...state.selected],patch)){$('batch-dialog').close();message(`已更新 ${state.selected.size} 张图片`);}};
$('select-page').onclick=()=>{for(const i of filtered().slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE))state.selected.add(i.sha256);render();};
$('clear-selection').onclick=()=>{state.selected.clear();state.selecting=false;render();};
function downloadJSON(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('backup').onclick=async()=>{try{downloadJSON(makeBackup(await store.all('users')),`fox-gallery-users-${new Date().toISOString().slice(0,10)}.json`);message('用户数据备份已导出（不包含原图）。');}catch(e){message(e.message,true);}};
let pendingRestore=[];
$('pick-restore').onclick=()=>$('restore-input').click();
$('restore-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>20*1024*1024)throw new Error('备份超过 20 MB 限制');pendingRestore=validateBackup(JSON.parse(await file.text()));const summary=restoreSummary(pendingRestore,state.images,state.users);$('restore-summary').textContent=`共 ${summary.total} 条，匹配图片 ${summary.matched} 条，孤立用户数据 ${summary.orphans} 条，已有用户记录 ${summary.conflicts} 条。`;$('restore-mode').value='keep';$('restore-dialog').showModal();}catch(e){$('import-report').textContent=`恢复校验失败：${e.message}`;}};
$('restore-cancel').onclick=()=>{$('restore-dialog').close();pendingRestore=[];};
$('restore-apply').onclick=async()=>{const button=$('restore-apply');button.disabled=true;try{await store.put('settings',{id:'before-last-restore',backup:makeBackup(await store.all('users'))});const result=await store.restoreUsers(pendingRestore,$('restore-mode').value==='replace');state.users=new Map((await store.all('users')).map(u=>[u.sha256,u]));refreshCategories();render();$('restore-dialog').close();$('import-report').textContent=`已恢复 ${result.restored} 条，保留当前记录 ${result.kept} 条。`;pendingRestore=[];}catch(e){$('restore-summary').textContent=`恢复失败：${e.message}`;}finally{button.disabled=false;}};
for(const id of ['pick-files','pick-directory','pick-manifest','reconnect'])$(id).onclick=()=>message('此功能正在下一阶段接入。');
try {store=await openStore();for(const i of await store.all('images'))state.images.set(i.sha256,i);for(const u of await store.all('users'))state.users.set(u.sha256,u);refreshCategories();render();if(!state.images.size)await loadStarter();}
catch(e){message(`无法启动存储：${e.message}`,true);}
