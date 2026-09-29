import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:4173");
  await page.waitForFunction(
    () => document.querySelector("#total").textContent === "295",
  );
  await page.waitForFunction(
    () => document.querySelector(".card img")?.naturalWidth > 0,
  );
  const image = await page.locator(".card img").first().elementHandle();
  const hash = await image.evaluate((img) => img.closest(".card").dataset.hash);
  await page.locator(`[data-hash="${hash}"] .heart`).click();
  await page.waitForFunction(
    (hash) =>
      document
        .querySelector(`[data-hash="${hash}"] .heart`)
        .getAttribute("aria-pressed") === "true",
    hash,
  );
  assert.equal(
    await image.evaluate((img) => img.isConnected),
    true,
    "favoriting keeps the decoded image node",
  );
  assert.ok(
    (await page.locator(".card img").count()) < 60,
    "offscreen thumbnails are not all read up front",
  );
  await page.locator("#layout").selectOption("masonry");
  assert.equal(
    await page.locator("#grid").getAttribute("data-layout"),
    "masonry",
  );
  await page.reload();
  await page.locator(".card").first().waitFor();
  assert.equal(await page.locator("#layout").inputValue(), "masonry");
  await page.locator("#next").click();
  assert.equal(await page.locator(".card").count(), 60);
  await page.locator("#previous").click();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/mvp-desktop.png" });
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.screenshot({ path: "test-results/mvp-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS MVP: retained card images, viewport thumbnail loading, layout persistence, pagination, 360/390px views",
  );
} finally {
  await browser.close();
}
