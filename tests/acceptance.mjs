import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const uploadJSON = (locator, value, name = "manifest.json") =>
  page.locator(locator).setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
const readUser = (hash) =>
  page.evaluate(async (hash) => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    try {
      return await db.get("users", hash);
    } finally {
      db.close();
    }
  }, hash);
const waitFinished = () =>
  page.waitForFunction(
    () =>
      document.querySelector("#cancel-import").hidden &&
      !document
        .querySelector("#import-report")
        .textContent.includes("正在扫描"),
  );
try {
  await page.goto("http://localhost:4173");
  await page.waitForFunction(
    () => document.querySelector("#total").textContent === "295",
  );
  // Batch updates target selected content only, including additive tags.
  await page.locator("#select-mode").click();
  await page.locator(".select-check input").nth(0).check();
  await page.locator(".select-check input").nth(1).check();
  const selected = await page
    .locator(".card.selected")
    .evaluateAll((cards) => cards.map((c) => c.dataset.hash));
  await page.locator("#batch-tags").click();
  await page.locator("#batch-value").fill("batch-one, batch-two");
  await page.locator("#batch-form button[type=submit]").click();
  await page.locator("#batch-dialog").waitFor({ state: "hidden" });
  await page.locator("#batch-category").click();
  await page.locator("#batch-value").fill("批量分类");
  await page.locator("#batch-form button[type=submit]").click();
  await page.locator("#batch-dialog").waitFor({ state: "hidden" });
  await page.locator("#batch-favorite").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("已收藏 2"),
  );
  await page.locator("#clear-selection").click();
  for (const hash of selected) {
    const user = await readUser(hash);
    assert.equal(user.favorite, true);
    assert.equal(user.category, "批量分类");
    assert.deepEqual(user.tags, ["batch-one", "batch-two"]);
  }
  console.log("PASS batch selection and additive metadata");
  // Actual JSON download and restore UI, orphan records, conflict policy and invalid input.
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await downloadPromise;
  await mkdir("test-results", { recursive: true });
  await download.saveAs("test-results/user-backup.json");
  const original = await readUser(selected[0]),
    orphan = "f".repeat(64);
  const backup = {
    format: "fox-gallery-user-data",
    schemaVersion: 1,
    users: [
      { ...original, note: "restored note" },
      {
        sha256: orphan,
        favorite: true,
        tags: ["orphan"],
        category: "孤立分类",
        note: "orphan note",
      },
    ],
  };
  await page.locator("#import-open").click();
  await uploadJSON("#restore-input", backup, "backup.json");
  await page.locator("#restore-dialog").waitFor();
  assert.match(
    await page.locator("#restore-summary").textContent(),
    /孤立用户数据 1/,
  );
  await page.locator("#restore-apply").click();
  await page.locator("#restore-dialog").waitFor({ state: "hidden" });
  assert.equal((await readUser(selected[0])).note, original.note);
  assert.equal((await readUser(orphan)).note, "orphan note");
  await uploadJSON("#restore-input", backup, "backup.json");
  await page.locator("#restore-mode").selectOption("replace");
  await page.locator("#restore-apply").click();
  await page.locator("#restore-dialog").waitFor({ state: "hidden" });
  assert.equal((await readUser(selected[0])).note, "restored note");
  await uploadJSON(
    "#restore-input",
    { ...backup, users: [{ ...original, favorite: "invalid" }] },
    "invalid.json",
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#import-report")
      .textContent.includes("恢复校验失败"),
  );
  assert.equal((await readUser(selected[0])).note, "restored note");
  console.log(
    "PASS backup download, restore keep/replace, orphan and validation",
  );
  // Mixed valid/invalid incremental manifest; filenames are irrelevant to user association.
  await uploadJSON("#manifest-input", [
    { sha256: selected[0], filename: "manifest-renamed.png", width: 123 },
    { sha256: orphan, filename: "orphan-rejoined.png" },
    { sha256: "invalid", filename: "bad.png" },
  ]);
  await waitFinished();
  assert.match(await page.locator("#import-report").textContent(), /错误 1/);
  assert.equal((await readUser(selected[0])).note, "restored note");
  assert.equal((await readUser(orphan)).note, "orphan note");
  await page.locator("#import-close").click();
  await page.locator("#search").fill("orphan note");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#search").fill("");
  // Folder fallback imports manifest + thumbnails without treating thumbnails as originals.
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 24;
      c.height = 16;
      const x = c.getContext("2d");
      x.fillStyle = "#559966";
      x.fillRect(0, 0, 24, 16);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const hash = createHash("sha256").update(png).digest("hex"),
    folder = resolve("test-results/bundle");
  await mkdir(resolve(folder, "originals"), { recursive: true });
  await mkdir(resolve(folder, "thumbs"), { recursive: true });
  const rows = [
    {
      sha256: hash,
      filename: "folder-original.png",
      original_rel: "originals/folder-original.png",
      thumb: "folder-thumb.png",
      width: 24,
      height: 16,
    },
  ];
  await writeFile(resolve(folder, "manifest.json"), JSON.stringify(rows));
  await writeFile(
    resolve(folder, "manifest.csv"),
    `filename,sha256\nfolder-original.png,${hash}`,
  );
  await writeFile(resolve(folder, "originals/folder-original.png"), png);
  await writeFile(resolve(folder, "thumbs/folder-thumb.png"), png);
  await page.locator("#import-open").click();
  await page.locator("#directory-input").setInputFiles(folder);
  await waitFinished();
  assert.match(
    await page.locator("#import-report").textContent(),
    /新增 1 · 已存在 0/,
  );
  assert.match(await page.locator("#import-report").textContent(), /错误 0/);
  // Drop a renamed copy through the real DataTransfer route.
  await page.locator("#import-close").click();
  await page.evaluate(
    (bytes) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(bytes)], "dragged-copy.png", {
          type: "image/png",
        }),
      );
      window.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [...png],
  );
  await waitFinished();
  assert.match(
    await page.locator("#import-report").textContent(),
    /新增 0 · 已存在 1/,
  );
  await page.locator("#import-close").click();
  console.log("PASS manifest, directory fallback and drag/drop");
  // Real browser filesystem handles in OPFS exercise serializing/read/reconnect APIs without an OS picker.
  const handleResult = await page.evaluate(
    async (bytes) => {
      const { openStore } = await import("/src/store.js"),
        { importFiles, directoryEntries } = await import("/src/importer.js");
      const db = await openStore();
      const root = await navigator.storage.getDirectory(),
        dir = await root.getDirectoryHandle("fox-test", { create: true }),
        handle = await dir.getFileHandle("handle-image.png", { create: true }),
        writer = await handle.createWritable();
      await writer.write(new Uint8Array(bytes));
      await writer.close();
      await db.put("sources", {
        id: "opfs-test",
        name: "fox-test",
        handle: dir,
      });
      const stats = await importFiles(
        directoryEntries(dir, "fox-test", "opfs-test"),
        { store: db },
      );
      const restored = await db.get("sources", "opfs-test");
      const same = await restored.handle.isSameEntry(dir);
      db.close();
      return { same, errors: stats.errors, existing: stats.existing };
    },
    [...png],
  );
  assert.equal(handleResult.same, true);
  assert.equal(handleResult.errors, 0);
  // A transaction failure must roll back the other writes in the same transaction.
  const atomic = await page.evaluate(async () => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    const before = await db.get("users", "e".repeat(64));
    try {
      await db.write([
        ["users", [{ sha256: "e".repeat(64), note: "must rollback" }, {}]],
      ]);
    } catch {}
    const after = await db.get("users", "e".repeat(64));
    db.close();
    return { before, after };
  });
  assert.equal(atomic.after, atomic.before);
  // Concurrent content and user writes must preserve all sources and unrelated user fields.
  const concurrent = await page.evaluate(async () => {
    const { openStore } = await import("/src/store.js"),
      { normalizeRecord } = await import("/src/model.js");
    const a = await openStore(),
      b = await openStore(),
      hash = "d".repeat(64);
    await Promise.all([
      a.mergeImage(normalizeRecord({ sha256: hash, filename: "one.png" })),
      b.mergeImage(normalizeRecord({ sha256: hash, filename: "two.png" })),
    ]);
    await Promise.all([
      a.updateUsers([hash], { favorite: true }),
      b.updateUsers([hash], { note: "concurrent note" }),
    ]);
    const result = {
      image: await a.get("images", hash),
      user: await a.get("users", hash),
    };
    a.close();
    b.close();
    return result;
  });
  assert.equal(concurrent.image.sources.length, 2);
  assert.equal(concurrent.user.favorite, true);
  assert.equal(concurrent.user.note, "concurrent note");
  console.log(
    "PASS persisted file handles, transaction rollback and concurrent writes",
  );
  // 2,000 synthetic manifest rows imported through the UI, bounded DOM and responsive filtering.
  const large = Array.from({ length: 2000 }, (_, i) => ({
    sha256: (i + 4096).toString(16).padStart(64, "0"),
    filename: `load-test-${i}.png`,
    category: "性能测试",
    width: 100,
    height: 100,
  }));
  await page.locator("#import-open").click();
  const start = Date.now();
  await uploadJSON("#manifest-input", { schemaVersion: 1, images: large });
  await waitFinished();
  assert.match(await page.locator("#import-report").textContent(), /新增 2000/);
  console.log(`2,000 manifest records imported in ${Date.now() - start}ms`);
  await page.locator("#import-close").click();
  assert.ok((await page.locator(".card").count()) <= 60);
  await page.locator("#search").fill("load-test-1999");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#search").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator(".image-button").first().click();
  await page
    .locator("#detail-form button[type=submit]")
    .scrollIntoViewIfNeeded();
  assert.ok(await page.locator("#detail-form button[type=submit]").isVisible());
  assert.ok(
    await page.evaluate(
      () => document.querySelector("#detail").scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "test-results/mobile-detail.png" });
  await page.locator("#detail-close").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS 2,000-record import, bounded grid, mobile detail and no JS errors",
  );
} finally {
  await browser.close();
}
