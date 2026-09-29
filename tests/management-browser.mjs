import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto("http://localhost:4173");
  await page.waitForFunction(
    () => document.querySelector("#total").textContent === "295",
  );
  await page.locator("#select-mode").click();
  await page.locator(".select-check input").first().check();
  const hash = await page.locator(".card.selected").getAttribute("data-hash");
  const apply = async (button, value) => {
    await page.locator(button).click();
    await page.locator("#batch-value").fill(value);
    await page.locator("#batch-form button[type=submit]").click();
    await page.locator("#batch-dialog").waitFor({ state: "hidden" });
  };
  await apply("#batch-tags", "red, fox");
  await apply("#batch-category", "素材");
  await page.locator("#batch-favorite").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("已收藏"),
  );
  await page.locator("#clear-selection").click();
  await page.locator("#tag-filter").fill("red, fox");
  await page.locator("#category-filter").selectOption("素材");
  await page.locator("[data-filter=favorite]").click();
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#tag-filter").fill("red, missing");
  assert.equal(await page.locator(".card").count(), 0);
  await page.locator("#tag-mode").selectOption("any");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#select-mode").click();
  await page.locator(".select-check input").first().check();
  await apply("#batch-remove-tags", "red");
  assert.equal(await page.locator(".card").count(), 0);
  await page.locator("#clear-filters").click();
  await apply("#batch-replace-tags", "new");
  await apply("#batch-replace-tags", "");
  await page.reload();
  const user = await page.evaluate(async (hash) => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    try {
      return await db.get("users", hash);
    } finally {
      db.close();
    }
  }, hash);
  assert.deepEqual(user.tags, []);
  assert.equal(user.category, "素材");
  assert.equal(user.favorite, true);
  assert.equal("removeTags" in user, false);
  console.log(
    "PASS 2.0 tag combinations, bulk add/remove/replace/clear, category and reload",
  );
} finally {
  await browser.close();
}
