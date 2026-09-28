import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://localhost:4173');
await page.waitForFunction(()=>document.querySelector('#total').textContent==='295');
assert.equal(await page.locator('.card').count(),60);
await page.locator('.image-button').first().click();
await page.locator('#edit-note').fill('persistent test note');await page.locator('#edit-tags').fill('fox, verified');await page.locator('#edit-category').fill('我的分类');await page.locator('#favorite').check();
await page.locator('#detail-form button[type=submit]').click();await page.locator('#save-hint').filter({hasText:'已保存'}).waitFor();
await page.reload();await page.locator('.card').first().waitFor();await page.locator('#search').fill('persistent test note');assert.equal(await page.locator('.card').count(),1);
await page.locator('.image-button').click();assert.equal(await page.locator('#edit-category').inputValue(),'我的分类');assert.equal(await page.locator('#edit-note').inputValue(),'persistent test note');await page.locator('#detail-close').click();
await page.locator('#search').fill('');await page.locator('[data-filter=duplicate]').click();assert.equal(await page.locator('.card').count(),3);
await page.locator('[data-filter=all]').click();
const migration=await page.evaluate(async()=>{
 const {openStore}=await import('/src/store.js');
 const name='fox-migration-test';
 await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{for(const s of ['images','users'])r.result.createObjectStore(s,{keyPath:'sha256'});r.result.createObjectStore('settings',{keyPath:'id'});r.transaction.objectStore('users').put({sha256:'a'.repeat(64),note:'preserved'});};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
 const db=await openStore(name);const note=(await db.get('users','a'.repeat(64))).note;await db.put('assets',{sha256:'a'.repeat(64),thumbnail:new Blob(['test'])});db.close();return note;
});assert.equal(migration,'preserved');
await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/desktop.png',fullPage:false});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:false});
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
assert.deepEqual(errors,[]);console.log('PASS browser: persistence, search, duplicates, v1→v2 migration, desktop/mobile layouts');
}finally{await browser.close();}
