import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeRecord,mergeImage,filterImages,parseTags,isDuplicate} from '../src/model.js';
const hash='a'.repeat(64);
test('same hash groups files while retaining every distinct source',()=>{const a=normalizeRecord({sha256:hash,filename:'a.png'});const b=normalizeRecord({sha256:hash,filename:'renamed.png'});const merged=mergeImage(a,b);assert.equal(merged.sources.length,2);assert.equal(mergeImage(merged,b).sources.length,2);assert.ok(isDuplicate(merged));});
test('user metadata remains separate and searchable',()=>{const image=normalizeRecord({sha256:hash,filename:'a.png',category:'auto'});const users=new Map([[hash,{favorite:true,tags:['fox'],category:'custom',note:'remember'}]]);assert.equal(filterImages([image],users,{query:'remember',category:'custom',filter:'favorite'}).length,1);assert.equal(filterImages([image],users,{filter:'duplicate'}).length,0);assert.deepEqual(parseTags('fox, fox，art'),['fox','art']);});
test('invalid content identifiers are rejected',()=>assert.throws(()=>normalizeRecord({sha256:'file-name',filename:'a.png'})));
test('starter retains 300 sources grouped into 295 contents',async(t)=>{let rows;try{rows=JSON.parse(await readFile(new URL('../local-data/starter/manifest.json',import.meta.url)));}catch{t.skip('Starter not extracted');return;}const map=new Map();for(const row of rows){const image=normalizeRecord(row);map.set(image.sha256,mergeImage(map.get(image.sha256),image));}assert.equal(map.size,295);assert.equal([...map.values()].reduce((n,i)=>n+i.sources.length,0),300);assert.equal([...map.values()].filter(isDuplicate).length,3);});
