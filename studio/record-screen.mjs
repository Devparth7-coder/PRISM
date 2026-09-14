// Authentic product screen recordings for PRISM films.
// Each browser context gets its own output dir -> one webm renamed after close.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const REC = path.join(import.meta.dirname, "rec");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(REC, { recursive: true });

const launch = { headless: true, args: ["--no-sandbox", "--force-color-profile=srgb", "--mute-audio", "--disable-dev-shm-usage", "--disable-software-rasterizer", "--js-flags=--max-old-space-size=256"] };
let clipSeq = 0;

async function freshContext(browser, w = 1920, h = 1080) {
  const dir = path.join(REC, `tmp-${++clipSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: w, height: h } },
  });
  const page = await ctx.newPage();
  return { ctx, page, dir };
}

async function finish({ ctx, dir }, target) {
  await ctx.close();
  await sleep(400);
  const webm = fs.readdirSync(dir).find((f) => f.endsWith(".webm"));
  if (webm) {
    fs.renameSync(path.join(dir, webm), path.join(REC, target));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("saved", target);
}

async function caption(page, text, tag) {
  await page.evaluate(
    ({ text, tag }) => {
      let el = document.getElementById("prism-cap");
      if (!el) {
        el = document.createElement("div");
        el.id = "prism-cap";
        el.style.cssText =
          "position:fixed;left:72px;bottom:60px;z-index:99999;max-width:1200px;font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s";
        document.body.appendChild(el);
      }
      el.innerHTML =
        (tag ? `<div style="font-size:14px;letter-spacing:4px;color:#ef4444;font-weight:700;margin-bottom:10px;text-transform:uppercase">${tag}</div>` : "") +
        `<div style="font-size:32px;line-height:1.25;font-weight:600;color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">${text}</div>`;
      requestAnimationFrame(() => (el.style.opacity = "1"));
    },
    { text, tag },
  );
}
async function captionOff(page) {
  await page.evaluate(() => {
    const el = document.getElementById("prism-cap");
    if (el) el.style.opacity = "0";
  });
  await sleep(350);
}

const browser = await chromium.launch(launch);
const dbReset = async (page) => {
  await page.goto(BASE + "/login", { waitUntil: "load" });
  const boot = await page.evaluate(async () => (await fetch("/api/demo/bootstrap", { method: "POST" })).json());
  await sleep(2200);
  return boot;
};

// 1. landing -------------------------------------------------------------
{
  const c = await freshContext(browser);
  await c.page.goto(BASE + "/", { waitUntil: "commit" });
  await sleep(17000);
  await finish(c, "s01-landing.webm");
}

// 2. login -> dashboard ---------------------------------------------------
let boot;
{
  const c = await freshContext(browser);
  await c.page.goto(BASE + "/login", { waitUntil: "load" });
  await sleep(2500);
  await caption(c.page, "One click into a complete, labeled demo", "DEMO MODE");
  await sleep(2500);
  await c.page.getByRole("button", { name: /continue with demo/i }).click();
  await sleep(5000); // routes to /dashboard
  await captionOff(c.page);
  await sleep(2500);
  await finish(c, "s02-login.webm");
}

// 3. PR -> review ----------------------------------------------------------
{
  const c = await freshContext(browser);
  boot = await dbReset(c.page);
  await c.page.goto(`${BASE}/pull-requests/${boot.prId}`, { waitUntil: "load" });
  await sleep(3000);
  await caption(c.page, "Review tied to an exact commit", "Commit SHA");
  await sleep(4000);
  await c.page.getByRole("link", { name: /latest review/i }).first().click();
  await sleep(4000);
  await caption(c.page, "Thirteen grounded findings — risk 63 of 100", "PRISM review");
  await sleep(4500);
  await captionOff(c.page);
  await sleep(1500);
  await finish(c, "s02-open-review.webm");
}

// 3. deep review interaction ---------------------------------------------
{
  const c = await freshContext(browser);
  await dbReset(c.page);
  const j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load" });
  await sleep(2500);
  await caption(c.page, "Changed code, marked right on the diff", "Evidence chain");
  await c.page.locator("button").filter({ hasText: /SQL query built/i }).first().click();
  await sleep(3500);
  await c.page.locator("button").filter({ hasText: /members\.ts/ }).first().click();
  await sleep(3500);
  await captionOff(c.page);
  await c.page.evaluate(() => {
    document.querySelector('[id^="finding-"]')?.scrollIntoView({ block: "start" });
    window.scrollBy(0, 30);
  });
  await sleep(1000);
  for (let i = 0; i < 7; i++) {
    await c.page.mouse.wheel(0, 240);
    await sleep(850);
  }
  await sleep(1500);
  await caption(c.page, "High-severity findings face an adversarial critic", "Critic verification");
  await sleep(4500);
  await captionOff(c.page);
  await c.page.getByRole("button", { name: /Changed files/ }).first().click();
  await sleep(2800);
  await c.page.locator("button").filter({ hasText: /package\.json/ }).first().click();
  await sleep(3000);
  await c.page.locator("button").filter({ hasText: /members\.ts/ }).first().click();
  await sleep(3500);
  await c.page.getByRole("button", { name: /Summary/ }).first().click();
  await sleep(4000);
  await c.page.getByRole("button", { name: /Pipeline/ }).first().click();
  await sleep(5000);
  await finish(c, "s03-review-deep.webm");
}

// 4. copilot --------------------------------------------------------------
{
  const c = await freshContext(browser);
  await dbReset(c.page);
  const j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load" });
  await sleep(2500);
  await caption(c.page, "Ask about the actual review — answers cite real findings", "Copilot  ·  Control J");
  await sleep(3500);
  await captionOff(c.page);
  await c.page.keyboard.press("Control+j");
  await sleep(1200);
  await c.page.keyboard.type("Which finding should I fix first, and why?", { delay: 50 });
  await sleep(700);
  await c.page.keyboard.press("Enter");
  await sleep(8500);
  await finish(c, "s04-copilot.webm");
}

// 5. command palette ------------------------------------------------------
{
  const c = await freshContext(browser);
  await dbReset(c.page);
  await c.page.goto(BASE + "/dashboard", { waitUntil: "load" });
  await sleep(2000);
  await caption(c.page, "Every finding, PR and agent — one command away", "Command palette  ·  Control K");
  await sleep(3000);
  await c.page.keyboard.press("Control+k");
  await sleep(1000);
  await c.page.keyboard.type("sql injection", { delay: 120 });
  await sleep(4000);
  await captionOff(c.page);
  await sleep(1500);
  await finish(c, "s05-palette.webm");
}

if (process.env.STOP === "s05") { await browser.close(); console.log("stopped after s05"); process.exit(0); }

// 6. observability tour ---------------------------------------------------
{
  const c = await freshContext(browser);
  await dbReset(c.page);
  const stops = [
    ["/findings", "Every finding keeps its evidence and verdict", "Findings"],
    ["/agents", "Deterministic engines first, then specialist agents", "Review mesh"],
    ["/runs", "Durable jobs with retries, backoff and a dead-letter queue", "Queue"],
    ["/analytics", "Analytics computed only from stored reviews", "Analytics"],
    ["/policies", "Policies, path reviewers and repository memory", "Governance"],
    ["/integrations", "Integration status — honestly labeled", "Integrations"],
  ];
  for (const [url, text, tag] of stops) {
    await c.page.goto(BASE + url, { waitUntil: "load", timeout: 30000 }).catch(()=>{});
    await sleep(1600);
    await sleep(1800);
    await caption(c.page, text, tag);
    await sleep(4800);
    await captionOff(c.page);
    await c.page.mouse.wheel(0, 220);
    await sleep(1400);
  }
  await finish(c, "s06-tour.webm");
}

// 7. fix cycle ------------------------------------------------------------
{
  const c = await freshContext(browser);
  await dbReset(c.page);
  const j = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${j.latestReviewId}`, { waitUntil: "load" });
  await sleep(3000);
  await caption(c.page, "The author pushes a fix — same pull request", "Re-review");
  await sleep(3500);
  await c.page.getByRole("button", { name: /Simulate author fix/i }).click();
  await sleep(2500);
  await captionOff(c.page);
  for (let i = 0; i < 30; i++) {
    const jj = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
    if (jj.latestReviewId && jj.latestReviewId !== j.latestReviewId) {
      await c.page.goto(`${BASE}/reviews/${jj.latestReviewId}`, { waitUntil: "load" });
      break;
    }
    await sleep(800);
  }
  await sleep(3500);
  await caption(c.page, "Thirteen findings fixed — risk 3, APPROVE", "Regression tracking");
  await sleep(6000);
  await captionOff(c.page);
  await c.page.mouse.wheel(0, 200);
  await sleep(4000);
  await finish(c, "s07-fix-cycle.webm");
}

// 8. vertical takes (1080x1920) ------------------------------------------
{
  const c = await freshContext(browser, 1080, 1920);
  await dbReset(c.page);
  await c.page.goto(`${BASE}/pull-requests/${boot.prId}`, { waitUntil: "load" });
  await sleep(2500);
  await c.page.locator("a[href^='/reviews/']").last().click().catch(() => {});
  await sleep(4000);
  await c.page.mouse.wheel(0, 300);
  await sleep(1500);
  await c.page.locator("button").filter({ hasText: /SQL query built/i }).first().click().catch(() => {});
  await sleep(4000);
  for (let i = 0; i < 6; i++) {
    await c.page.mouse.wheel(0, 320);
    await sleep(900);
  }
  await sleep(2000);
  await finish(c, "v1-review.webm");
}
{
  const c = await freshContext(browser, 1080, 1920);
  await dbReset(c.page);
  await c.page.goto(BASE + "/agents", { waitUntil: "load" });
  await sleep(2000);
  for (let i = 0; i < 8; i++) {
    await c.page.mouse.wheel(0, 420);
    await sleep(800);
  }
  await sleep(2000);
  await finish(c, "v2-agents.webm");
}
{
  const c = await freshContext(browser, 1080, 1920);
  await c.page.goto(BASE + "/login", { waitUntil: "commit" });
  const jj = await c.page.evaluate(async (prId) => (await fetch(`/api/pull-requests/${prId}`)).json(), boot.prId);
  await c.page.goto(`${BASE}/reviews/${jj.latestReviewId}`, { waitUntil: "load" });
  await sleep(3000);
  await c.page.mouse.wheel(0, 200);
  await sleep(3500);
  await finish(c, "v3-approve.webm");
}

await browser.close();
console.log("screen recordings complete");
