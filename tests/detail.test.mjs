import { test } from "node:test";
import assert from "node:assert/strict";
import { detailPatch, formatFileSize } from "../src/detail.js";
const original = {
  favorite: false,
  tags: ["keep"],
  category: "original",
  note: "before",
};
test("detail editing only patches changed fields", () => {
  assert.deepEqual(detailPatch(original, { ...original, note: "after" }), {
    note: "after",
  });
  assert.deepEqual(detailPatch(original, { ...original, tags: ["keep"] }), {});
  assert.deepEqual(
    detailPatch(original, { ...original, favorite: true, tags: [] }),
    { favorite: true, tags: [] },
  );
  assert.equal(original.note, "before");
});
test("file sizes distinguish missing metadata and large originals", () => {
  assert.equal(formatFileSize(0), "未提供");
  assert.equal(formatFileSize(1), "1 B");
  assert.equal(formatFileSize(1024), "1.0 KB");
  assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
});
