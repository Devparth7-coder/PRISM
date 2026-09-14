/**
 * CLI: seed the deterministic demo repository + flagship PR and enqueue a
 * review. Usage: npm run demo:seed [-- --now]
 *   --now   run the review synchronously after seeding (no worker needed)
 */
import { seedDemo } from "../src/lib/demo/seed";
import { runReview } from "../src/lib/orchestrator";

const runNow = process.argv.includes("--now");

const result = seedDemo({ enqueue: !runNow });
console.log("Demo seeded:", {
  repoId: result.repoId,
  prId: result.prId,
  snapshotId: result.snapshotId,
  alreadySeeded: result.alreadySeeded,
});
if (runNow) {
  runReview({ prId: result.prId, snapshotId: result.snapshotId })
    .then((reviewId) => console.log("Review complete:", reviewId))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.log("Review job enqueued (worker handles it via `npm run dev` or `npm run worker`).");
}
