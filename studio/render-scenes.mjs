import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "rec");
fs.mkdirSync(OUT, { recursive: true });

const scenes = [
  ["terminal", "scenes.html", 38, 1920, 1080],
  ["title", "scenes.html", 9, 1920, 1080],
  ["problem", "scenes.html", 26, 1920, 1080],
  ["pipeline", "scenes.html", 40, 1920, 1080],
  ["webhook", "scenes.html", 25, 1920, 1080],
  ["context", "scenes.html", 42, 1920, 1080],
  ["static", "scenes.html", 24, 1920, 1080],
  ["mesh", "scenes.html", 40, 1920, 1080],
  ["critic", "scenes.html", 36, 1920, 1080],
  ["chain", "scenes.html", 18, 1920, 1080],
  ["risk", "scenes.html", 22, 1920, 1080],
  ["github", "github.html", 28, 1920, 1080],
  ["regression", "scenes.html", 26, 1920, 1080],
  ["final", "scenes.html", 20, 1920, 1080],
  ["v-pipe", "scenes.html", 5.5, 1080, 1920],
  ["v-hook", "scenes.html", 3.4, 1080, 1920],
  ["v-diff", "scenes.html", 5.6, 1080, 1920],
  ["v-title", "scenes.html", 4.6, 1080, 1920],
  ["v-mesh", "scenes.html", 6.8, 1080, 1920],
  ["v-critic", "scenes.html", 6.8, 1080, 1920],
  ["v-chain", "scenes.html", 5.6, 1080, 1920],
  ["v-risk", "scenes.html", 4.8, 1080, 1920],
  ["v-fix", "scenes.html", 7.2, 1080, 1920],
  ["v-final", "scenes.html", 7.6, 1080, 1920],
];

const only = process.argv[2];
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

for (const [name, file, dur, w, h] of scenes) {
  if (only && name !== only) continue;
  const dir = path.join(OUT, `scn-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    recordVideo: { dir, size: { width: w, height: h } },
  });
  const page = await ctx.newPage();
  const vertical = w < h;
  const url = file === "github.html"
    ? `${pathToFileURL(path.join(__dirname, "scenes", file)).href}?dur=${dur}`
    : `${pathToFileURL(path.join(__dirname, "scenes", file)).href}?scene=${name}&dur=${dur}${vertical ? "&v=1" : ""}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout((dur + 1.6) * 1000);
  await ctx.close();
  const vid = fs.readdirSync(dir).find(f => f.endsWith(".webm"));
  const dest = path.join(OUT, `${name}.webm`);
  fs.rmSync(dest, { force: true });
  fs.renameSync(path.join(dir, vid), dest);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("saved", name);
}
await browser.close();
console.log("scenes complete");
