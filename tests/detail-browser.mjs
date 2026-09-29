import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);
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
const user = (hash) =>
  page.evaluate(async (hash) => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    try {
      return await db.get("users", hash);
    } finally {
      db.close();
    }
  }, hash);
try {
  await page.goto("http://localhost:4173");
  await page.waitForFunction(
    () => document.querySelector("#total").textContent === "295",
  );
  const firstHash = await page
    .locator(".card")
    .first()
    .getAttribute("data-hash");
  await page.locator(".image-button").first().click();
  assert.equal(await page.locator("#detail-position").textContent(), "1 / 295");
  assert.ok(await page.locator("#detail-previous").isDisabled());
  await page.locator("#edit-note").fill("unsaved draft");
  await page.locator("#detail-next").click();
  await page.locator("#unsaved-dialog").waitFor();
  await page.locator("#unsaved-stay").click();
  assert.equal(await page.locator("#edit-note").inputValue(), "unsaved draft");
  await page.locator("#edit-note").press("ArrowRight");
  assert.equal(
    await page.locator("#detail-position").textContent(),
    "1 / 295",
    "arrow keys in text fields do not change images",
  );
  await page.locator("#detail-close").click();
  await page.locator("#unsaved-discard").click();
  await page.locator("#detail").waitFor({ state: "hidden" });
  assert.equal(
    await user(firstHash),
    undefined,
    "discard does not write user data",
  );
  await page.locator(".image-button").first().click();
  await page.locator("#edit-note").fill("saved through navigation");
  await page.locator("#detail-next").click();
  await page.locator("#unsaved-save").click();
  await page.waitForFunction(
    () => document.querySelector("#detail-position").textContent === "2 / 295",
  );
  assert.equal((await user(firstHash)).note, "saved through navigation");
  await page.locator("#detail-previous").click();
  assert.equal(
    await page.locator("#edit-note").inputValue(),
    "saved through navigation",
  );
  // Unchanged draft fields must not overwrite data edited in another tab.
  await page.evaluate(async (hash) => {
    const { openStore } = await import("/src/store.js");
    const db = await openStore();
    await db.updateUsers([hash], { favorite: true, tags: ["other-tab"] });
    db.close();
  }, firstHash);
  await page.locator("#edit-note").fill("note-only patch");
  await page.locator("#detail-form button[type=submit]").click();
  await page.locator("#save-hint").filter({ hasText: "已保存" }).waitFor();
  const kept = await user(firstHash);
  assert.equal(kept.favorite, true);
  assert.deepEqual(kept.tags, ["other-tab"]);
  // Invalid edits block save-and-leave, with the draft left intact.
  await page.locator("#edit-tags").fill("x".repeat(201));
  await page.locator("#detail-next").click();
  await page.locator("#unsaved-save").click();
  await page.waitForFunction(() =>
    document.querySelector("#unsaved-message").textContent.includes("保存失败"),
  );
  assert.equal(await page.locator("#detail-position").textContent(), "1 / 295");
  await page.locator("#unsaved-stay").click();
  assert.equal((await page.locator("#edit-tags").inputValue()).length, 201);
  await page.locator("#detail-close").click();
  await page.locator("#unsaved-discard").click();
  await page.locator("#detail").waitFor({ state: "hidden" });
  await page.locator(".image-button").nth(59).click();
  assert.equal(
    await page.locator("#detail-position").textContent(),
    "60 / 295",
  );
  await page.locator("#detail-next").click();
  assert.equal(
    await page.locator("#detail-position").textContent(),
    "61 / 295",
  );
  await page.locator("#detail-close").click();
  await page.waitForFunction(
    () => document.querySelector("#page-label").textContent === "2 / 5",
  );
  console.log(
    "PASS detail: navigation, draft guard, save failure, concurrent field preservation and return to page",
  );
  // Import a high-resolution generated test image, then reconnect it after reload.
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1400;
      c.height = 1000;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#315d47";
      ctx.fillRect(0, 0, 1400, 1000);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const hash = createHash("sha256").update(png).digest("hex");
  await page.locator("#import-open").click();
  await page.locator("#files-input").setInputFiles({
    name: "daily-original.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#cancel-import").hidden &&
      document.querySelector("#import-report").textContent.includes("已处理 1"),
  );
  await page.locator("#import-close").click();
  await page.reload();
  await page.locator(".card").first().waitFor();
  await page.locator("#search").fill("daily-original");
  await page.locator(".image-button").click();
  await page.waitForFunction(
    () => document.querySelector("#detail-image").naturalWidth === 512,
  );
  await page.locator("#detail-file-input").setInputFiles({
    name: "wrong.png",
    mimeType: "image/png",
    buffer: Buffer.from("not the original"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#preview-hint")
      .textContent.includes("SHA-256 不匹配"),
  );
  assert.equal(
    await page.locator("#detail-image").evaluate((img) => img.naturalWidth),
    512,
  );
  await page.locator("#detail-file-input").setInputFiles({
    name: "renamed-original.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#preview-hint").textContent === "本地原图" &&
      document.querySelector("#detail-image").naturalWidth === 1400,
  );
  await page.locator("#detail-zoom").click();
  assert.equal(
    await page.locator("#detail-zoom").getAttribute("aria-pressed"),
    "true",
  );
  assert.ok(
    await page
      .locator("#preview-viewport")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  );
  await page.locator("#detail-zoom").click();
  assert.equal(
    await page.locator("#detail-zoom").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#edit-note").fill("mobile draft");
  await page.locator("#edit-note").press("Escape");
  await page.locator("#unsaved-dialog").waitFor();
  await page.locator("#unsaved-stay").click();
  assert.equal(await page.locator("#edit-note").inputValue(), "mobile draft");
  await page.locator("#detail-form button[type=submit]").click();
  await page.locator("#save-hint").filter({ hasText: "已保存" }).waitFor();
  assert.equal((await user(hash)).note, "mobile draft");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/detail-desktop.png" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator("#sources").scrollIntoViewIfNeeded();
  assert.ok(await page.locator("#detail-close").isVisible());
  assert.ok(
    await page.evaluate(
      () => document.querySelector("#detail").scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "test-results/detail-mobile.png" });
  await page.locator("#detail-close").click();
  // Test the built program in a clean context: there is no bundled private gallery.
  const built = await browser.newContext(),
    preview = await built.newPage();
  preview.setDefaultTimeout(15000);
  await preview.goto("http://localhost:4173/dist/");
  await preview.locator("#empty").waitFor();
  await preview.locator("#import-open").click();
  await preview.locator("#manifest-input").setInputFiles({
    name: "manifest.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          filename: "built-image.png",
          sha256: hash,
          width: 1400,
          height: 1000,
        },
      ]),
    ),
  });
  await preview.waitForFunction(
    () => document.querySelector("#total").textContent === "1",
  );
  await preview.locator("#import-close").click();
  await preview.locator(".image-button").click();
  assert.equal(
    await preview.locator("#detail-name").textContent(),
    "built-image.png",
  );
  await built.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS detail: original SHA validation, reconnect, zoom, Escape, mobile sticky controls and built application",
  );
} finally {
  await browser.close();
}
