import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1366, height: 900 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4173");
  await page.waitForFunction(
    () => document.querySelector("#total").textContent === "295",
  );
  await page.evaluate(async () => {
    const { openStore } = await import("/src/store.js");
    const { normalizeRecord } = await import("/src/model.js");
    const db = await openStore();
    try {
      await db.putMany(
        "images",
        Array.from({ length: 10000 }, (_, n) => ({
          ...normalizeRecord({
            sha256: n.toString(16).padStart(64, "0"),
            filename: `scale-${n}.png`,
          }),
          importedAt: "2099-01-01",
        })),
      );
    } finally {
      db.close();
    }
  });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#total").textContent.replaceAll(",", "") ===
      "10295",
  );
  await page.locator("#search").fill("scale-");
  await page.locator("#layout").selectOption("virtual");
  assert.ok((await page.locator(".card").count()) < 80);
  await page.locator(".image-button").first().focus();
  await page
    .locator("#gallery-viewport")
    .evaluate((e) => e.dispatchEvent(new Event("scroll")));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(await page.locator(".image-button:focus").count(), 1);
  const first = await page.locator(".card").first().getAttribute("data-hash");
  await page.locator("#select-mode").click();
  await page.locator(".select-check input").first().check();
  await page
    .locator("#gallery-viewport")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.waitForFunction(() =>
    document.querySelector(".card-title")?.textContent.includes("scale-99"),
  );
  assert.ok((await page.locator(".card").count()) < 80);
  await page.locator(".select-check input").last().check();
  assert.equal(
    await page.locator("#selection-count").textContent(),
    "已选 2 张",
  );
  await page.locator("#batch-tags").click();
  await page.locator("#batch-value").fill("large");
  await page.locator("#batch-form button[type=submit]").click();
  await page.locator("#batch-dialog").waitFor({ state: "hidden" });
  await page.locator("#clear-selection").click();
  await page.locator("#tag-filter").fill("large");
  assert.equal(await page.locator(".card").count(), 2);
  await page.locator(".image-button").last().click();
  await page.locator("#detail-close").click();
  await page.locator("#detail").waitFor({ state: "hidden" });
  assert.ok(await page.locator(".image-button:focus").count());
  await page.locator("#clear-filters").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  assert.ok((await page.locator(".card").count()) < 30);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page
    .locator("#gallery-viewport")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .locator("#gallery-viewport")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
    true,
  );
  await page.screenshot({ path: "test-results/virtual-mobile.png" });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#layout").value === "virtual",
  );
  const user = await page.evaluate(async (hash) => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    try {
      return await db.get("users", hash);
    } finally {
      db.close();
    }
  }, first);
  assert.deepEqual(user.tags, ["large"]);
  await page.locator("#layout").selectOption("grid");
  assert.equal(await page.locator(".card").count(), 60);
  assert.equal(await page.locator(".pager").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS 10,000-image virtual window, cross-window selection, incremental tag search, detail return, mobile, persistence and pagination fallback",
  );
} finally {
  await browser.close();
}
