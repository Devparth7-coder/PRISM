// Dev entrypoint: normal `next dev`. The review worker boots through
// src/instrumentation.ts; the demo repository can be seeded from the UI
// (View Demo) or with `npm run demo:seed`.
import { spawn } from "node:child_process";

const child = spawn("next", ["dev"], { stdio: "inherit", shell: process.platform === "win32" });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
