import { test } from "node:test";
import assert from "node:assert/strict";
import { GalleryIndex } from "../src/gallery-index.js";
import { normalizeRecord, filterImages, emptyUser } from "../src/model.js";
import { virtualWindow } from "../src/virtual.js";
test("legacy duplicate tags can be reindexed and removed", () => {
  const index = new GalleryIndex();
  const image = normalizeRecord({
    sha256: "a".repeat(64),
    filename: "legacy.png",
  });
  index.upsert(image, { ...emptyUser(), tags: ["fox", "fox"] });
  index.upsert(image, { ...emptyUser(), tags: ["red"] });
  assert.equal(index.query({ tags: ["fox"] }).length, 0);
  assert.equal(index.query({ tags: ["red"] }).length, 1);
  assert.equal(index.sourceCount, 1);
});
test("incremental facets and search match legacy filtering after edits and new imports", () => {
  const index = new GalleryIndex(),
    images = Array.from({ length: 100 }, (_, n) =>
      normalizeRecord({
        filename: `image-${n}.png`,
        sha256: n.toString(16).padStart(64, "0"),
        category: n % 2 ? "art" : "photo",
      }),
    );
  const users = new Map(
    images.map((i, n) => [
      i.sha256,
      {
        ...emptyUser(),
        tags: n % 2 ? ["fox", "red"] : ["blue"],
        favorite: n % 3 === 0,
        note: "note " + n,
      },
    ]),
  );
  for (const i of images) index.upsert(i, users.get(i.sha256));
  const options = [
    {},
    { query: "note 1" },
    { tags: ["red", "fox"] },
    { tags: ["red", "blue"], tagMode: "any", filter: "favorite" },
    { category: "art", tags: ["blue"] },
  ];
  const check = () => {
    for (const o of options)
      assert.deepEqual(
        index
          .query(o)
          .map((i) => i.sha256)
          .sort(),
        filterImages(images, users, o)
          .map((i) => i.sha256)
          .sort(),
      );
  };
  check();
  const unchanged = index.docs.get(images[2].sha256);
  const changed = images[0];
  users.set(changed.sha256, {
    ...users.get(changed.sha256),
    tags: ["red"],
    category: "art",
    note: "edited",
  });
  index.upsert(changed, users.get(changed.sha256));
  check();
  assert.equal(index.docs.get(images[2].sha256), unchanged);
  assert.equal(index.query({ query: "edited" }).length, 1);
  assert.equal(
    index.query({ tags: ["blue"] }).some((i) => i === changed),
    false,
  );
  assert.equal(index.sourceCount, 100);
  const cached = index.query();
  assert.equal(index.query(), cached);
  const extra = normalizeRecord({
    sha256: "f".repeat(64),
    filename: "new.png",
  });
  images.push(extra);
  index.upsert(extra);
  check();
  assert.equal(index.sourceCount, 101);
});
test("virtual windows bound card count and clamp empty, final and resized views", () => {
  for (const width of [320, 390, 1366])
    for (const count of [0, 1, 10000])
      for (const top of [0, 30000, 9999999]) {
        const g = virtualWindow(count, width, 700, top);
        assert.ok(g.start <= g.end);
        assert.ok(g.end <= count);
        assert.ok(g.end - g.start <= g.columns * 8);
        assert.ok(g.cardWidth > 0);
        if (top === 9999999) assert.equal(g.end, count);
      }
});
