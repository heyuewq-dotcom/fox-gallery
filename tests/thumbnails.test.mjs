import { test } from "node:test";
import assert from "node:assert/strict";
import { ThumbnailCache } from "../src/thumbnails.js";
test("cards and detail share one asset read and URL", async () => {
  let reads = 0,
    created = 0;
  const cache = new ThumbnailCache(
    async () => {
      reads++;
      return { thumbnail: new Blob(["x"]) };
    },
    () => `blob:${++created}`,
    () => {},
  );
  const results = await Promise.all([cache.get("a"), cache.get("a")]);
  assert.deepEqual(results, ["blob:1", "blob:1"]);
  assert.equal(reads, 1);
  assert.equal(created, 1);
});
test("leaving a page revokes URLs and ignores pending reads", async () => {
  const revoked = [];
  let complete;
  const cache = new ThumbnailCache(
    (hash) =>
      hash === "a"
        ? { thumbnail: new Blob(["x"]) }
        : new Promise((resolve) => (complete = resolve)),
    () => "blob:a",
    (url) => revoked.push(url),
  );
  await cache.get("a");
  const pending = cache.get("b");
  await Promise.resolve();
  cache.retain(new Set());
  complete({ thumbnail: new Blob(["x"]) });
  assert.equal(await pending, "");
  assert.deepEqual(revoked, ["blob:a"]);
  assert.equal(cache.entries.size, 0);
});
test("missing assets use manifest previews; failed reads can retry", async () => {
  let failed = true;
  const cache = new ThumbnailCache(async () => {
    if (failed) throw new Error("read");
  });
  await assert.rejects(cache.get("a"));
  failed = false;
  assert.equal(await cache.get("a", "thumbs/a.webp"), "thumbs/a.webp");
  cache.clear();
});
