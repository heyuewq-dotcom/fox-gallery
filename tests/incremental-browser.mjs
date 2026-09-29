import assert from "node:assert/strict";
import { chromium } from "playwright";

// Synthetic batches only, in a fresh browser context; never open the daily profile.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://localhost:4173");
  const result = await page.evaluate(async () => {
    const { openStore } = await import("/src/store.js");
    const { importManifest, parseManifest } = await import("/src/manifest.js");
    const db = await openStore("fox-gallery-incremental-test");
    const hash = (n) => n.toString(16).padStart(64, "0");
    const row = (n) => ({
      sha256: hash(n),
      filename: `${n}.png`,
      batch: n <= 900 ? "1-900" : "901-1109",
      width: 640,
      height: 480,
      size_bytes: 1234,
    });
    try {
      const first = await importManifest(
        Array.from({ length: 900 }, (_, i) => row(i + 1)),
        { store: db },
      );
      await db.putMany(
        "users",
        [1, 900, 901].map((n) => ({
          sha256: hash(n),
          favorite: true,
          tags: ["保留标签"],
          category: "自定义分类",
          note: "原备注",
          custom: { retained: true },
        })),
      );
      await db.put("assets", {
        sha256: hash(1),
        thumbnail: new Blob(["cached"]),
        custom: "keep",
      });
      const usersBefore = await db.all("users");
      const batch = Array.from({ length: 209 }, (_, i) => row(i + 901));
      // A renamed duplicate from the first batch, including user-like manifest fields.
      batch[0] = {
        sha256: hash(1).toUpperCase(),
        filename: "901-renamed.png",
        batch: "901-1109",
        favorite: false,
        tags: [],
        category: "索引分类",
        note: "不得覆盖用户备注",
      };
      const second = await importManifest(
        parseManifest(JSON.stringify({ schemaVersion: 1, images: batch })),
        { store: db },
      );
      const imageBeforeRepeat = await db.get("images", hash(1));
      const repeat = await importManifest(batch, { store: db });
      const csv = `filename,sha256,batch\n901-renamed.png,${hash(1)},901-1109\n`;
      const csvResult = await importManifest(
        parseManifest(csv, "manifest.csv"),
        { store: db },
      );
      const invalid = await importManifest(
        [{ sha256: "bad", filename: "invalid.png" }],
        { store: db },
      );
      const asset = await db.get("assets", hash(1));
      return {
        first,
        second,
        repeat,
        csvResult,
        invalid,
        usersBefore,
        usersAfter: await db.all("users"),
        count: (await db.all("images")).length,
        imageBeforeRepeat,
        image: await db.get("images", hash(1)),
        asset: { text: await asset.thumbnail.text(), custom: asset.custom },
      };
    } finally {
      db.close();
    }
  });
  assert.equal(result.first.added, 900);
  assert.equal(result.second.added, 208);
  assert.equal(result.second.existing, 1);
  assert.equal(result.second.errors, 0);
  assert.equal(result.count, 1108);
  assert.equal(result.repeat.added, 0);
  assert.equal(result.repeat.existing, 209);
  assert.equal(result.repeat.updated, 0);
  assert.equal(result.csvResult.added, 0);
  assert.equal(result.invalid.errors, 1);
  assert.deepEqual(result.usersAfter, result.usersBefore);
  assert.equal(result.image.sources.length, 2);
  assert.equal(result.image.width, 640);
  assert.equal(result.image.height, 480);
  assert.equal(result.image.fileSize, 1234);
  assert.equal(result.image.importedAt, result.imageBeforeRepeat.importedAt);
  assert.deepEqual(result.asset, { text: "cached", custom: "keep" });
  await page.reload();
  const persisted = await page.evaluate(async () => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore("fox-gallery-incremental-test");
    try {
      return {
        count: (await db.all("images")).length,
        users: await db.all("users"),
      };
    } finally {
      db.close();
    }
  });
  assert.equal(persisted.count, 1108);
  assert.deepEqual(persisted.users, result.usersBefore);
  console.log(
    "Incremental IndexedDB: synthetic 900 + 209, duplicates, repeat import, JSON/CSV, user fields, orphan users, assets and reload passed.",
  );
} finally {
  await browser.close();
}
