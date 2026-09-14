// Re-records s04 copilot (answer actually submitted) and s07 fix cycle,
// suppressing the Next.js dev-only error indicator portal.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const REC = path.join(import.meta.dirname, "rec");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

async function freshContext(browser) {
  const dir = path.join(REC, `fx-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
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
async function dbReset(page) {
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 20000 });
  const boot = await page.evaluate(async () => (await fetch("/api/demo/bootstrap", { method: "POST" })).json());
  await sleep(2200);
  return boot;
}
async function caption(page, text, tag) {
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
async function captionOff(page) {
  await page.evaluate(() => { const el = document.getElementById("prism-cap"); if (el) el.style.opacity = "0"; });
  await sleep(350);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--force-color-profile=srgb", "--mute-audio", "--disable-dev-shm-usage", "--disable-software-rasterizer", "--js-flags=--max-old-space-size=256"] });

// ---- s04 copilot ----
{
  const c = await freshContext(browser);
  const boot = await dbReset(c.page);
  const j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
  await sleep(2500);
  await caption(c.page, "Ask about the actual review — answers cite real findings", "Copilot  ·  Control J");
  await sleep(4000);
  await captionOff(c.page);
  await c.page.keyboard.press("Control+j");
  await sleep(1400);
  await c.page.getByLabel("Ask Copilot").click();
  await c.page.keyboard.type("Which finding should I fix first, and why?", { delay: 45 });
  await sleep(600);
  await c.page.locator("form button[type=submit]").click();
  await sleep(11000);
  // second question on the critical finding
  await c.page.getByLabel("Ask Copilot").click();
  await c.page.keyboard.type("Show me the strongest evidence", { delay: 45 });
  await sleep(400);
  await c.page.locator("form button[type=submit]").click();
  await sleep(9000);
  await finish(c, "s04-copilot.webm");
}

// ---- s07 fix cycle ----
{
  const c = await freshContext(browser);
  const boot = await dbReset(c.page);
  let j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
  await sleep(3000);
  await caption(c.page, "The author pushes a fix — same pull request", "Re-review");
  await sleep(3500);
  await c.page.getByRole("button", { name: /Simulate author fix/i }).click();
  await sleep(2500);
  await captionOff(c.page);
  for (let i = 0; i < 30; i++) {
    const jj = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
    if (jj.latestReviewId && jj.latestReviewId !== j.latestReviewId) {
      await c.page.goto(`${BASE}/reviews/${jj.latestReviewId}`, { waitUntil: "load", timeout: 20000 });
      j = jj; break;
    }
    await sleep(800);
  }
  await sleep(3500);
  await caption(c.page, "Thirteen findings fixed — risk 3, APPROVE", "Regression tracking");
  await sleep(7000);
  await captionOff(c.page);
  await c.page.mouse.wheel(0, 200);
  await sleep(4000);
  await finish(c, "s07-fix-cycle.webm");
}
await browser.close();
console.log("fix re-records complete");
