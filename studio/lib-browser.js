// Shared Playwright launch helpers for the PRISM video studio.
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "node_modules", "playwright"));

const BASE = "http://localhost:3000";

async function demoContext(browser, { width = 1920, height = 1080 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    recordVideo: undefined,
  });
  const page = await context.newPage();
  // Real demo bootstrap — same endpoint the landing "Live demo" button calls.
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  const boot = await page.evaluate(async () => {
    const r = await fetch("/api/demo/bootstrap", { method: "POST" });
    return r.json();
  });
  await page.waitForTimeout(1800); // let the worker finish the review (~50ms pipeline)
  return { context, page, boot };
}

async function freshBrowser() {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-font-subpixel-rendering", "--force-color-profile=srgb"],
  });
}

module.exports = { BASE, demoContext, freshBrowser };
