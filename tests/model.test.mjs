import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeRecord,
  mergeImage,
  filterImages,
  parseTags,
  isDuplicate,
  userPatch,
} from "../src/model.js";
const hash = "a".repeat(64);
test("sparse metadata updates retain measured dimensions and category", () => {
  const old = normalizeRecord({
    sha256: hash,
    filename: "a.png",
    width: 100,
    height: 80,
    category: "known",
    size_bytes: 123,
  });
  const merged = mergeImage(
    old,
    normalizeRecord({ sha256: hash, filename: "renamed.png" }),
  );
  assert.equal(merged.width, 100);
  assert.equal(merged.height, 80);
  assert.equal(merged.category, "known");
  assert.equal(merged.fileSize, 123);
});
test("batch tags add without removing old tags, notes or favorites", () => {
  const original = {
    favorite: true,
    tags: ["old"],
    note: "keep",
    category: "old category",
  };
  const changed = userPatch(original, { addTags: ["new", "old"] });
  assert.deepEqual(changed.tags, ["old", "new"]);
  assert.equal(changed.note, "keep");
  assert.equal(changed.favorite, true);
  assert.equal(userPatch(original, { category: "new category" }).note, "keep");
  assert.deepEqual(original.tags, ["old"]);
});
test("same hash groups files while retaining every distinct source", () => {
  const a = normalizeRecord({ sha256: hash, filename: "a.png" });
  const b = normalizeRecord({ sha256: hash, filename: "renamed.png" });
  const merged = mergeImage(a, b);
  assert.equal(merged.sources.length, 2);
  assert.equal(mergeImage(merged, b).sources.length, 2);
  assert.ok(isDuplicate(merged));
});
test("user metadata remains separate and searchable", () => {
  const image = normalizeRecord({
    sha256: hash,
    filename: "a.png",
    category: "auto",
  });
  const users = new Map([
    [
      hash,
      { favorite: true, tags: ["fox"], category: "custom", note: "remember" },
    ],
  ]);
  assert.equal(
    filterImages([image], users, {
      query: "remember",
      category: "custom",
      filter: "favorite",
    }).length,
    1,
  );
  assert.equal(filterImages([image], users, { filter: "duplicate" }).length, 0);
  assert.deepEqual(parseTags("fox, fox，art"), ["fox", "art"]);
});
test("invalid content identifiers are rejected", () =>
  assert.throws(() =>
    normalizeRecord({ sha256: "file-name", filename: "a.png" }),
  ));
test("starter retains 300 sources grouped into 295 contents", async (t) => {
  let rows;
  try {
    rows = JSON.parse(
      await readFile(
        new URL("../local-data/starter/manifest.json", import.meta.url),
      ),
    );
  } catch {
    t.skip("Starter not extracted");
    return;
  }
  const map = new Map();
  for (const row of rows) {
    const image = normalizeRecord(row);
    map.set(image.sha256, mergeImage(map.get(image.sha256), image));
  }
  assert.equal(map.size, 295);
  assert.equal(
    [...map.values()].reduce((n, i) => n + i.sources.length, 0),
    300,
  );
  assert.equal([...map.values()].filter(isDuplicate).length, 3);
});
