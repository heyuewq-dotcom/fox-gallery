import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../local-data/starter');
const records = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
const hashes = new Map();
const missing = [];
for (const row of records) {
  if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid SHA-256');
  hashes.set(row.sha256, (hashes.get(row.sha256) || 0) + 1);
  if (!row.thumb) missing.push(row.filename);
  else await access(resolve(dir, 'thumbs', row.thumb));
}
console.log(JSON.stringify({records:records.length,uniqueHashes:hashes.size,duplicateGroups:[...hashes.values()].filter(n=>n>1).length,thumbnailFiles:(await readdir(resolve(dir,'thumbs'))).length,missing},null,2));
