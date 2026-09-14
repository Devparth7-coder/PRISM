// Standalone s03 deep-review capture (vulnerable DB required).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const REC = path.join(import.meta.dirname, "rec");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--mute-audio",
    "--disable-dev-shm-usage", "--disable-software-rasterizer",
    "--js-flags=--max-old-space-size=256"],
});
const dir = path.join(REC, "s03-only");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  recordVideo: { dir, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript(() => {
  const kill = () => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
  setInterval(kill, 400);
});
const page = await ctx.newPage();
await page.goto(BASE + "/login", { waitUntil: "load", timeout: 20000 });
const boot = await page.evaluate(async () => (await fetch("/api/demo/bootstrap", { method: "POST" })).json());
await sleep(2200);
const j = await page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
await page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
await sleep(2500);
async function caption(text, tag) {
  await page.evaluate(({ text, tag }) => {
    let el = document.getElementById("prism-cap");
    if (!el) { el = document.createElement("div"); el.id = "prism-cap";
      el.style.cssText = "position:fixed;left:72px;bottom:60px;z-index:99999;max-width:1200px;font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s";
      document.body.appendChild(el); }
    el.innerHTML = (tag ? `<div style="font-size:14px;letter-spacing:4px;color:#ef4444;font-weight:700;margin-bottom:10px;text-transform:uppercase">${tag}</div>` : "")
      + `<div style="font-size:32px;line-height:1.25;font-weight:600;color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">${text}</div>`;
    requestAnimationFrame(() => (el.style.opacity = "1"));
  }, { text, tag });
}
async function captionOff() { await page.evaluate(() => { const e = document.getElementById("prism-cap"); if (e) e.style.opacity = "0"; }); await sleep(350); }
await caption("Changed code, marked right on the diff", "Evidence chain");
await page.locator("button").filter({ hasText: /SQL query built/i }).first().click();
await sleep(3500);
await page.locator("button").filter({ hasText: /members\.ts/ }).first().click();
await sleep(3500);
await captionOff();
await page.evaluate(() => {
  document.querySelector('[id^="finding-"]')?.scrollIntoView({ block: "start" });
  window.scrollBy(0, 30);
});
await sleep(1000);
for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 240); await sleep(850); }
await sleep(1500);
await caption("High-severity findings face an adversarial critic", "Critic verification");
await sleep(4500);
await captionOff();
await page.getByRole("button", { name: /Changed files/ }).first().click();
await sleep(2800);
await page.locator("button").filter({ hasText: /package\.json/ }).first().click();
await sleep(3000);
await page.locator("button").filter({ hasText: /members\.ts/ }).first().click();
await sleep(3500);
await page.getByRole("button", { name: /Summary/ }).first().click();
await sleep(4000);
await page.getByRole("button", { name: /Pipeline/ }).first().click();
await sleep(5000);
await ctx.close();
await sleep(2000);
const webm = fs.readdirSync(dir).find((f) => f.endsWith(".webm"));
fs.renameSync(path.join(dir, webm), path.join(REC, "s03-review-deep.webm"));
fs.rmSync(dir, { recursive: true, force: true });
await browser.close();
console.log("saved s03-review-deep.webm");
process.exit(0);
