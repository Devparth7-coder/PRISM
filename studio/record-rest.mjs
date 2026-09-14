// Standalone remaining real clips: observability tour (landscape) and agents (vertical).
// Run as its own short-lived process to avoid memory accumulation.
//   node studio/record-rest.mjs tour | agents
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const REC = path.join(import.meta.dirname, "rec");
const which = process.argv[2] || "tour";
const vertical = which === "agents";
const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--force-color-profile=srgb", "--mute-audio", "--disable-dev-shm-usage", "--disable-software-rasterizer", "--js-flags=--max-old-space-size=256"] });
const dir = path.join(REC, `rest-${which}`);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1,
  recordVideo: { dir, size: { width: W, height: H } },
});
await ctx.addInitScript(() => {
  const kill = () => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove());
  setInterval(kill, 400);
});
const page = await ctx.newPage();
await page.goto(BASE + "/login", { waitUntil: "load" });
await page.evaluate(async () => (await fetch("/api/demo/bootstrap", { method: "POST" })).json());
await sleep(2200);

async function caption(text, tag) {
  await page.evaluate(({ text, tag, vertical }) => {
    let el = document.getElementById("prism-cap");
    if (!el) { el = document.createElement("div"); el.id = "prism-cap";
      el.style.cssText = `position:fixed;left:${vertical?48:72}px;${vertical?"right:48px;":""}bottom:${vertical?90:60}px;z-index:99999;${vertical?"":"max-width:1200px;"}font-family:Inter,Arial,sans-serif;opacity:0;transition:opacity .35s`;
      document.body.appendChild(el); }
    el.innerHTML = (tag ? `<div style="font-size:${vertical?20:14}px;letter-spacing:4px;color:#ef4444;font-weight:700;margin-bottom:${vertical?14:10}px;text-transform:uppercase">${tag}</div>` : "")
      + `<div style="font-size:${vertical?46:32}px;line-height:1.25;font-weight:${vertical?700:600};color:#f5f5f6;text-shadow:0 2px 28px rgba(0,0,0,.95)">${text}</div>`;
    requestAnimationFrame(() => (el.style.opacity = "1"));
  }, { text, tag, vertical });
}
async function capOff() { await page.evaluate(() => { const e = document.getElementById("prism-cap"); if (e) e.style.opacity = "0"; }); await sleep(350); }

if (which === "tour") {
  const stops = [
    ["/findings", "Every finding keeps its evidence and verdict", "Findings"],
    ["/agents", "Deterministic engines first, then specialist agents", "Review mesh"],
    ["/runs", "Durable jobs with retries, backoff and a dead-letter queue", "Queue"],
    ["/analytics", "Analytics computed only from stored reviews", "Analytics"],
    ["/policies", "Policies, path reviewers and repository memory", "Governance"],
    ["/integrations", "Integration status — honestly labeled", "Integrations"],
  ];
  for (const [url, text, tag] of stops) {
    await page.goto(BASE + url, { waitUntil: "load", timeout: 25000 }).catch(() => {});
    await sleep(2200);
    await caption(text, tag);
    await sleep(4600);
    await capOff();
    await page.mouse.wheel(0, 220);
    await sleep(1200);
  }
} else {
  await page.goto(BASE + "/agents", { waitUntil: "load", timeout: 25000 }).catch(() => {});
  await sleep(3000);
  await caption("Seven specialized review agents, running in parallel", "Review mesh");
  await sleep(6000);
  await page.mouse.wheel(0, 300);
  await sleep(3500);
  await capOff();
  await sleep(2000);
}

await ctx.close();
await sleep(500);
const webm = fs.readdirSync(dir).find((f) => f.endsWith(".webm"));
const target = which === "tour" ? "s06-tour.webm" : "v2-agents.webm";
fs.renameSync(path.join(dir, webm), path.join(REC, target));
fs.rmSync(dir, { recursive: true, force: true });
await browser.close();
console.log("saved", target);
process.exit(0);
