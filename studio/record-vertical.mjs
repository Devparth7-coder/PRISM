// Vertical real-footage re-records: v1 vulnerable review, v3 approved re-review.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const REC = path.join(import.meta.dirname, "rec");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

async function freshContext(browser) {
  const dir = path.join(REC, `vt-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: 1080, height: 1920 } },
  });
  // remove next dev overlay/portals (dev-only chrome, not product UI)
  await ctx.addInitScript(() => {
    const kill = () => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
    setInterval(kill, 400);
    document.addEventListener("DOMContentLoaded", kill);
  });
  const page = await ctx.newPage();
  return { ctx, page, dir };
}
async function finish(c, target) {
  await c.ctx.close();
  await sleep(1500);
  const webm = fs.readdirSync(c.dir).find((f) => f.endsWith(".webm"));
  fs.renameSync(path.join(c.dir, webm), path.join(REC, target));
  fs.rmSync(c.dir, { recursive: true, force: true });
  console.log("saved", target);
}
async function boot(page) {
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 20000 });
  return await page.evaluate(async () => (await fetch("/api/demo/bootstrap", { method: "POST" })).json());
}
async function caption(page, text, tag) {
  await page.evaluate(({ text, tag }) => {
    let el = document.getElementById("prism-cap");
    if (!el) { el = document.createElement("div"); el.id = "prism-cap";
      el.style.cssText = "position:fixed;left:48px;right:48px;bottom:90px;z-index:99999;font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s";
      document.body.appendChild(el); }
    el.innerHTML = (tag ? `<div style="font-size:20px;letter-spacing:5px;color:#ef4444;font-weight:700;margin-bottom:14px;text-transform:uppercase">${tag}</div>` : "")
      + `<div style="font-size:46px;line-height:1.25;font-weight:700;color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">${text}</div>`;
    requestAnimationFrame(() => (el.style.opacity = "1"));
  }, { text, tag });
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--force-color-profile=srgb", "--mute-audio", "--disable-dev-shm-usage", "--disable-software-rasterizer", "--js-flags=--max-old-space-size=256"] });

// ---- v1: vulnerable PR -> review -> CRITICAL evidence ----
{
  const c = await freshContext(browser);
  const b = await boot(c.page);
  await c.page.goto(`${BASE}/pull-requests/${b.prId}`, { waitUntil: "load", timeout: 20000 });
  await sleep(3000);
  await caption(c.page, "One pull request, reviewed in full", "PR #184");
  await sleep(4200);
  await c.page.locator("a[href^='/reviews/']").last().click();
  await sleep(5000);
  await caption(c.page, "Critical finding — with an evidence chain", "Risk 63 · request changes");
  await sleep(2000);
  await c.page.locator("button").filter({ hasText: /SQL query built/i }).first().click();
  await sleep(5000);
  await c.page.evaluate(() => { document.querySelector('[id^="finding-"]')?.scrollIntoView({ block: "start" }); window.scrollBy(0, 60); });
  await sleep(6500);
  await finish(c, "v1-review.webm");
}

// ---- fix, then v3 approve ----
{
  const c = await freshContext(browser);
  const b = await boot(c.page);
  let j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), b.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
  await sleep(3500);
  await caption(c.page, "Author pushes a fix commit", "Re-review");
  await sleep(3000);
  await c.page.getByRole("button", { name: /Simulate author fix/i }).click();
  await sleep(3000);
  for (let i = 0; i < 30; i++) {
    const jj = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), b.prId);
    if (jj.latestReviewId && jj.latestReviewId !== j.latestReviewId) {
      await c.page.goto(`${BASE}/reviews/${jj.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
      j = jj; break;
    }
    await sleep(800);
  }
  await sleep(4500);
  await caption(c.page, "13 fixed · risk 3 · approve", "Regression tracked");
  await sleep(5000);
  await c.page.mouse.wheel(0, 120);
  await sleep(3500);
  await finish(c, "v3-approve.webm");
}
await browser.close();
console.log("vertical re-records complete");
