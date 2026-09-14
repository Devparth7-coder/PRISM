// Standalone s07 fix-cycle capture (vulnerable DB required).
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
const dir = path.join(REC, "fx-s07");
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
let j = await page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
await page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
await sleep(3000);
await page.evaluate(() => {
  let el = document.getElementById("prism-cap");
  if (!el) { el = document.createElement("div"); el.id = "prism-cap";
    el.style.cssText = "position:fixed;left:72px;bottom:60px;z-index:99999;max-width:1200px;font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s";
    document.body.appendChild(el); }
  el.innerHTML = '<div style="font-size:14px;letter-spacing:4px;color:#ef4444;font-weight:700;margin-bottom:10px;text-transform:uppercase">Re-review</div>'
    + '<div style="font-size:32px;line-height:1.25;font-weight:600;color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">The author pushes a fix — same pull request</div>';
  requestAnimationFrame(() => (el.style.opacity = "1"));
});
await sleep(3500);
await page.getByRole("button", { name: /Simulate author fix/i }).click();
await sleep(2500);
await page.evaluate(() => { const el = document.getElementById("prism-cap"); if (el) el.style.opacity = "0"; });
for (let i = 0; i < 30; i++) {
  const jj = await page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  if (jj.latestReviewId && jj.latestReviewId !== j.latestReviewId) {
    await page.goto(`${BASE}/reviews/${jj.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
    j = jj; break;
  }
  await sleep(800);
}
await sleep(3500);
await page.evaluate(() => {
  let el = document.getElementById("prism-cap");
  if (!el) { el = document.createElement("div"); el.id = "prism-cap";
    el.style.cssText = "position:fixed;left:72px;bottom:60px;z-index:99999;max-width:1200px;font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s";
    document.body.appendChild(el); }
  el.innerHTML = '<div style="font-size:14px;letter-spacing:4px;color:#ef4444;font-weight:700;margin-bottom:10px;text-transform:uppercase">Regression tracking</div>'
    + '<div style="font-size:32px;line-height:1.25;font-weight:600;color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">Thirteen findings fixed — risk 3, APPROVE</div>';
  requestAnimationFrame(() => (el.style.opacity = "1"));
});
await sleep(7000);
await page.evaluate(() => { const el = document.getElementById("prism-cap"); if (el) el.style.opacity = "0"; });
await page.mouse.wheel(0, 200);
await sleep(4000);
await ctx.close();
await sleep(2000);
const webm = fs.readdirSync(dir).find((f) => f.endsWith(".webm"));
fs.renameSync(path.join(dir, webm), path.join(REC, "s07-fix-cycle.webm"));
fs.rmSync(dir, { recursive: true, force: true });
await browser.close();
console.log("saved s07-fix-cycle.webm");
process.exit(0);
