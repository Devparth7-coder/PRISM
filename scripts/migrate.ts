/** CLI: open the database (schema applies automatically) and seed catalogs. */
import { db } from "../src/lib/db/client";
import { ensureAgentCatalog } from "../src/lib/orchestrator";
import { ensureGlobalPolicy } from "../src/lib/db/repo/governance";

db();
ensureAgentCatalog();
ensureGlobalPolicy();
console.log("Database migrated and catalogs seeded.");
