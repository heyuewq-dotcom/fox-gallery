import {userPatch} from './model.js';
export const DB_VERSION=2;
export function migrateDatabase(db,oldVersion) {
  if(oldVersion<1){db.createObjectStore('images',{keyPath:'sha256'});db.createObjectStore('users',{keyPath:'sha256'});db.createObjectStore('settings',{keyPath:'id'});}
  if(oldVersion<2){db.createObjectStore('assets',{keyPath:'sha256'});db.createObjectStore('sources',{keyPath:'id'});}
}
export async function openStore(name='fox-gallery') {
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,DB_VERSION);
    request.onupgradeneeded=e=>migrateDatabase(request.result,e.oldVersion);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('请关闭其他旧版本图库标签页后重试'));
  });
  db.onversionchange=()=>db.close();
  function read(name,key,all=false){return new Promise((resolve,reject)=>{const tx=db.transaction(name);const request=all?tx.objectStore(name).getAll():tx.objectStore(name).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function write(entries){return new Promise((resolve,reject)=>{
    const tx=db.transaction([...new Set(entries.map(e=>e[0]))],'readwrite');
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存事务中止'));
    try{for(const [name,values] of entries)for(const value of values)tx.objectStore(name).put(value);}catch(e){tx.abort();reject(e);}
  });}
  return {all:name=>read(name,null,true),get:read,put:(name,value)=>write([[name,[value]]]),putMany:(name,values)=>write([[name,values]]),write,
    updateUsers(hashes,patch){return new Promise((resolve,reject)=>{const tx=db.transaction('users','readwrite'),s=tx.objectStore('users'),rows=[];tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存事务中止'));for(const sha256 of hashes){const request=s.get(sha256);request.onsuccess=()=>{const row={...userPatch(request.result,patch),sha256,updatedAt:new Date().toISOString()};delete row.addTags;s.put(row);rows.push(row);};}});},
    restoreUsers(rows,replace=false){return new Promise((resolve,reject)=>{const tx=db.transaction('users','readwrite'),s=tx.objectStore('users');let restored=0,kept=0;tx.oncomplete=()=>resolve({restored,kept});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('恢复事务中止'));for(const row of rows){const request=s.get(row.sha256);request.onsuccess=()=>{if(request.result&&!replace){kept++;return;}s.put(row);restored++;};}});},
    close:()=>db.close()
  };
}
