import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = path.join(import.meta.dirname, "shots") + "/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await sleep(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

// ---- public -------------------------------------------------------------
const pub = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const pp = await pub.newPage();
await pp.goto(BASE + "/", { waitUntil: "networkidle" });
await sleep(1500);
await shot(pp, "landing-1");
await sleep(2200);
await shot(pp, "landing-2");
await pp.goto(BASE + "/login", { waitUntil: "networkidle" });
await sleep(400);
await shot(pp, "login");
await pp.goto(BASE + "/install", { waitUntil: "networkidle" });
await sleep(300);
await shot(pp, "install");
await pp.goto(BASE + "/docs", { waitUntil: "networkidle" });
await sleep(300);
await shot(pp, "docs");
await pub.close();

// ---- authenticated ------------------------------------------------------
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(BASE + "/login", { waitUntil: "networkidle" });
const boot = await page.evaluate(async () => {
  const r = await fetch("/api/demo/bootstrap", { method: "POST" });
  return r.json();
});
await sleep(2500);
console.log("boot", boot);

await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
await sleep(700);
await shot(page, "dashboard");
await page.goto(BASE + "/repositories", { waitUntil: "networkidle" });
await sleep(400);
await shot(page, "repositories");
await page.goto(`${BASE}/repositories/${boot.repoId}`, { waitUntil: "networkidle" });
await sleep(500);
await shot(page, "repo-detail");
await page.goto(BASE + "/pull-requests", { waitUntil: "networkidle" });
await sleep(400);
await shot(page, "pull-requests");
await page.goto(`${BASE}/pull-requests/${boot.prId}`, { waitUntil: "networkidle" });
await sleep(400);
await shot(page, "pr-detail");

const j = await page.evaluate(async (prId) => {
  const r = await fetch(`/api/pull-requests/${prId}`);
  return r.json();
}, boot.prId);
const ridV = j.latestReviewId;
console.log("vulnerable review", ridV);

await page.goto(`${BASE}/reviews/${ridV}`, { waitUntil: "networkidle" });
await sleep(1000);
await shot(page, "review-findings");
await page.locator("button").filter({ hasText: /SQL query built|SQL injection/i }).first().click().catch(() => {});
await sleep(600);
await shot(page, "review-evidence");
await page.locator('[id^="finding-"]').first().screenshot({ path: `${OUT}evidence-card.png` }).catch(() => {});

await page.getByRole("button", { name: /Changed files/ }).first().click();
await sleep(600);
await shot(page, "review-files");
await page.getByRole("button", { name: /Summary/ }).first().click();
await sleep(600);
await shot(page, "review-summary");
await page.getByRole("button", { name: /Pipeline/ }).first().click();
await sleep(600);
await shot(page, "review-timeline");
await page.goto(`${BASE}/reviews/${ridV}`, { waitUntil: "networkidle" });
await sleep(500);

await page.keyboard.press("Control+k");
await sleep(500);
await page.keyboard.type("sql injection", { delay: 80 });
await sleep(700);
await shot(page, "command-palette");
await page.keyboard.press("Escape");
await sleep(200);
await page.keyboard.press("Control+j");
await sleep(500);
await shot(page, "copilot-open");
await page.keyboard.type("Why was the SQL injection flagged and what should I fix first?", { delay: 18 });
await page.keyboard.press("Enter");
await sleep(4000);
await shot(page, "copilot-answer");
await page.keyboard.press("Escape");

for (const [n, u] of [
  ["findings", "/findings"],
  ["findings-critical", "/findings?severity=CRITICAL"],
  ["agents", "/agents"],
  ["runs", "/runs"],
  ["analytics", "/analytics"],
  ["policies", "/policies"],
  ["integrations", "/integrations"],
  ["settings", "/settings"],
]) {
  await page.goto(BASE + u, { waitUntil: "networkidle" });
  await sleep(450);
  await shot(page, n);
}

fs.writeFileSync(path.join(import.meta.dirname, "boot.json"), JSON.stringify({ ...boot, ridV }, null, 2));
await ctx.close();
await browser.close();
console.log("capture done");
