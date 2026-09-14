/**
 * DEPENDENCY REVIEWER — deterministic advisory match (npm/pip) plus, when an
 * LLM is configured, a review of newly added packages (scope, maintenance,
 * duplication). It never invents advisories: vulnerability claims come ONLY
 * from the embedded advisory catalog or a configured OSV feed.
 */
import type { FindingInput } from "../types";
import { type AgentDef, type AgentInput, emptyOutcome, llmAnalyze } from "./common";
import { auditDependencies } from "../analysis/advisories";

export const dependencyAgent: AgentDef = {
  key: "dependency_reviewer",
  name: "Dependency Reviewer",
  category: "supply-chain",
  stage: 36,
  async run(input, provider) {
    // Deterministic first: the advisory DB is the only source of CVE claims.
    const advisoryFindings: FindingInput[] = auditDependencies(
      input.changedFiles,
      input.baseTree,
      input.headTree,
    ).map((f) => ({ ...f, agent: "dependency_reviewer" }));

    // Summarize dependency footprint changes from the manifest diff.
    const manifestFiles = input.changedFiles.filter((f) => /package\.json$|requirements.*\.txt$|pyproject\.toml$/.test(f.path));
    const added: string[] = [];
    const removed: string[] = [];
    for (const m of manifestFiles) {
      for (const h of m.hunks) {
        for (const l of h.lines) {
          if (l.type === "add") {
            const dep = /^\s*["']?([@\w/.\-]+)["']?\s*:?\s*["'~^[\d]/.exec(l.text);
            if (dep && !/dependencies|devDependencies|name|version/.test(dep[1]!)) added.push(dep[1]!);
          }
          if (l.type === "del") {
            const dep = /^\s*["']?([@\w/.\-]+)["']?\s*:?\s*["'~^[\d]/.exec(l.text);
            if (dep && !/dependencies|devDependencies|name|version/.test(dep[1]!)) removed.push(dep[1]!);
          }
        }
      }
    }

    const llm = await llmAnalyze(
      provider,
      "dependency_reviewer",
      "Focus ONLY: risky newly added dependencies — unusual scope (e.g. heavyweight packages for trivial tasks), abandoned/duplicated functionality already present, and runtime packages mistakenly added to devDependencies (or vice versa). NEVER claim a CVE without an advisory id; vulnerability claims are handled deterministically. At most 2 findings.",
      input,
      {
        categories: ["DEPENDENCIES"],
        maxFindings: 2,
        extraContext: `Manifest changes detected — added: ${added.join(", ") || "none"}; removed: ${removed.join(", ") || "none"}`,
      },
    );

    if (llm.localOnly) {
      return {
        ...emptyOutcome(
          `Dependency audit complete: ${advisoryFindings.length} known-vulnerable version(s) matched the advisory catalog; ${added.length} package(s) added, ${removed.length} removed.`,
          true,
        ),
        findings: advisoryFindings,
        toolCalls: ["advisory-catalog", "manifest-diff"],
      };
    }
    return { ...llm, findings: [...advisoryFindings, ...llm.findings] };
  },
};
