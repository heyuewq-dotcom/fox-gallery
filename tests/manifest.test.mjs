import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCSV,
  parseManifest,
  safeRelative,
  importManifest,
} from "../src/manifest.js";
const hash = "a".repeat(64);
test("CSV handles BOM, quoted commas, escaped quotes and newlines", () => {
  const [row] = parseCSV(
    `\uFEFFfilename,sha256,note\r\n"a,b.png",${hash},"say ""hi""\nnext"\r\n`,
  );
  assert.equal(row.filename, "a,b.png");
  assert.equal(row.note, 'say "hi"\nnext');
});
test("manifest rejects malformed containers, CSV and unsafe paths", () => {
  assert.throws(() => parseManifest('{"schemaVersion":2,"images":[]}'));
  assert.throws(() => parseCSV("filename,sha256\na,b,c"));
  for (const path of ["../secret", "https://host/image.png", "/root", "a/../b"])
    assert.throws(() => safeRelative(path));
  assert.equal(safeRelative("thumbs/a.png"), "thumbs/a.png");
});
test("incremental manifest retains user data, sources and isolates bad rows", async () => {
  const data = {
    images: new Map(),
    assets: new Map(),
    users: new Map([[hash, { favorite: true, note: "keep" }]]),
  };
  const store = {
    get: async (s, k) => data[s].get(k),
    write: async (entries) => {
      for (const [s, rows] of entries)
        for (const row of rows) data[s].set(row.sha256, row);
    },
  };
  await importManifest([{ sha256: hash, filename: "old.png", width: 12 }], {
    store,
  });
  const result = await importManifest(
    [
      { sha256: hash, filename: "renamed.png", width: 24 },
      { sha256: "bad", filename: "bad.png" },
    ],
    { store },
  );
  assert.equal(result.existing, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.errors, 1);
  assert.equal(data.images.get(hash).sources.length, 2);
  assert.equal(data.images.get(hash).width, 24);
  assert.equal(data.users.get(hash).note, "keep");
});
