/** CLI: standalone review worker for production-style deployments. */
import { startWorker } from "../src/lib/queue/worker";

startWorker();
setInterval(() => {
  /* keep alive */
}, 1_000_000);
