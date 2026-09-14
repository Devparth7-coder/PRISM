"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2, Check, Brain } from "lucide-react";
import { Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { RepoPolicyBundle } from "@/app/(app)/policies/page";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
const ACTIONS = ["BLOCK", "REQUEST_CHANGES", "COMMENT", "INFORMATIONAL"] as const;
const AGENTS = [
  "security_reviewer",
  "bug_hunter",
  "performance_reviewer",
  "maintainability_reviewer",
  "test_reviewer",
  "api_contract_reviewer",
  "dependency_reviewer",
];

export function PolicyEditor({ bundles }: { bundles: RepoPolicyBundle[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const bundle = bundles[selected]!;
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const p = bundle.policy;
  const [minSeverity, setMinSeverity] = useState(p.min_severity_comment);
  const [map, setMap] = useState<Record<string, string>>(JSON.parse(p.severity_map_json));
  const [flags, setFlags] = useState({
    requireTests: p.require_tests === 1,
    securityBlocking: p.security_blocking === 1,
    dependencyBlocking: p.dependency_blocking === 1,
  });
  const [maxComplexity, setMaxComplexity] = useState<string>(p.max_complexity?.toString() ?? "");
  const [pathReviewers, setPathReviewers] = useState<{ glob: string; agents: string[] }[]>(
    JSON.parse(p.path_reviewers_json || "[]"),
  );
  const [ruleForm, setRuleForm] = useState({ kind: "custom", pattern: "", description: "", pathGlob: "" });
  const [memoryForm, setMemoryForm] = useState({ kind: "architecture_decision", content: "" });

  const isGlobal = bundle.repoId === null;

  async function savePolicy() {
    setBusy(true);
    const res = await fetch("/api/policies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: bundle.repoId,
        minSeverityComment: minSeverity,
        severityMap: map,
        requireTests: flags.requireTests,
        securityBlocking: flags.securityBlocking,
        dependencyBlocking: flags.dependencyBlocking,
        maxComplexity: maxComplexity ? Number(maxComplexity) : null,
        pathReviewers,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    }
  }

  async function addRule() {
    if (ruleForm.pattern.length < 2 || ruleForm.description.length < 4) return;
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryId: bundle.repoId, ...ruleForm }),
    });
    router.refresh();
  }

  async function toggleRule(ruleId: string, enabled: boolean) {
    await fetch("/api/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleId, enabled }),
    });
    router.refresh();
  }

  async function addMemory() {
    if (memoryForm.content.length < 4) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryId: bundle.repoId, ...memoryForm }),
    });
    setMemoryForm({ kind: "architecture_decision", content: "" });
    router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <Card className="h-fit p-2">
        {bundles.map((b, i) => (
          <button
            key={b.fullName}
            onClick={() => setSelected(i)}
            className={cn(
              "block w-full truncate rounded px-2.5 py-2 text-left text-xs",
              i === selected ? "bg-graphite-800 text-graphite-50" : "text-graphite-400 hover:bg-graphite-800/50",
            )}
          >
            {b.fullName}
          </button>
        ))}
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Severity → publication mapping</h3>
            <button onClick={savePolicy} disabled={busy} className="btn-primary h-8 text-xs">
              {busy ? <Spinner className="h-3.5 w-3.5" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {saved ? "Saved" : "Save policy"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-graphite-500">
            Controls what the publisher posts to GitHub. BLOCK maps to a changes-requested review / failing check.
          </p>
          <div className="mt-3 space-y-2">
            {SEVERITIES.map((sev) => (
              <div key={sev} className="flex items-center gap-3 text-xs">
                <span className="w-20 font-semibold">{sev}</span>
                <div className="flex gap-1">
                  {ACTIONS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setMap({ ...map, [sev]: a })}
                      className={cn(
                        "rounded border px-2 py-1 text-[10px]",
                        map[sev] === a ? "border-prism-red text-prism-red" : "border-graphite-700 text-graphite-400 hover:text-graphite-200",
                      )}
                    >
                      {a.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-md border border-graphite-700 px-3 py-2 text-xs">
              Minimum severity to comment
              <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)} className="input h-7 w-28 text-xs">
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between rounded-md border border-graphite-700 px-3 py-2 text-xs">
              Max cyclomatic complexity
              <input value={maxComplexity} onChange={(e) => setMaxComplexity(e.target.value)} inputMode="numeric" placeholder="off" className="input h-7 w-28 text-xs" />
            </label>
            <Toggle label="Require test coverage for changed behavior" checked={flags.requireTests} onChange={(v) => setFlags({ ...flags, requireTests: v })} />
            <Toggle label="Security findings are merge-blocking" checked={flags.securityBlocking} onChange={(v) => setFlags({ ...flags, securityBlocking: v })} />
            <Toggle label="Vulnerable dependencies are merge-blocking" checked={flags.dependencyBlocking} onChange={(v) => setFlags({ ...flags, dependencyBlocking: v })} />
          </div>

          <div className="mt-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-graphite-400">Path reviewers</h4>
            <p className="mb-2 text-[11px] text-graphite-500">
              Files matching a glob always include the selected agents in the review, even in fast mode.
            </p>
            {pathReviewers.map((prv, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-graphite-700 p-2">
                <input
                  value={prv.glob}
                  onChange={(e) => setPathReviewers(pathReviewers.map((x, j) => (j === i ? { ...x, glob: e.target.value } : x)))}
                  placeholder="src/auth/**"
                  className="input h-7 w-40 font-mono text-xs"
                />
                <div className="flex flex-wrap gap-1">
                  {AGENTS.map((a) => (
                    <button
                      key={a}
                      onClick={() =>
                        setPathReviewers(
                          pathReviewers.map((x, j) =>
                            j === i ? { ...x, agents: x.agents.includes(a) ? x.agents.filter((y) => y !== a) : [...x.agents, a] } : x,
                          ),
                        )
                      }
                      className={cn("rounded-full border px-2 py-0.5 text-[10px]", prv.agents.includes(a) ? "border-prism-red text-prism-red" : "border-graphite-700 text-graphite-400")}
                    >
                      {a.replace(/_reviewer|_/g, " ")}
                    </button>
                  ))}
                </div>
                <button onClick={() => setPathReviewers(pathReviewers.filter((_, j) => j !== i))} className="ml-auto text-graphite-500 hover:text-prism-red">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button onClick={() => setPathReviewers([...pathReviewers, { glob: "", agents: ["security_reviewer"] }])} className="btn-secondary h-7 text-[11px]">
              <Plus className="h-3 w-3" /> Add path rule
            </button>
          </div>
        </Card>

        {!isGlobal && (
          <>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Custom repository rules</h3>
              <div className="mb-3 grid gap-2 sm:grid-cols-[120px_1fr_1fr_1fr_auto]">
                <select value={ruleForm.kind} onChange={(e) => setRuleForm({ ...ruleForm, kind: e.target.value })} className="input h-8 text-xs">
                  {["block", "require", "allow", "custom"].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input value={ruleForm.pathGlob} onChange={(e) => setRuleForm({ ...ruleForm, pathGlob: e.target.value })} placeholder="glob e.g. src/auth/**" className="input h-8 font-mono text-xs" />
                <input value={ruleForm.pattern} onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })} placeholder="pattern / regex" className="input h-8 font-mono text-xs" />
                <input value={ruleForm.description} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} placeholder="description" className="input h-8 text-xs" />
                <button onClick={addRule} className="btn-secondary h-8 px-3 text-xs"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-1.5">
                {bundle.rules.map((r) => (
                  <div key={r.id} className={cn("flex items-center justify-between rounded border border-graphite-700 px-3 py-1.5 text-[11px]", r.enabled === 0 && "opacity-40")}>
                    <span>
                      <span className="font-mono text-graphite-300">{r.path_glob ?? "*"}</span>{" "}
                      <span className="uppercase text-graphite-500">{r.kind}</span>{" "}
                      <span className="font-mono text-graphite-400">{r.pattern}</span> — <span className="text-graphite-300">{r.description}</span>
                    </span>
                    <button onClick={() => toggleRule(r.id, r.enabled === 0)} className="text-[10px] uppercase tracking-wider text-graphite-400 hover:text-graphite-200">
                      {r.enabled ? "disable" : "enable"}
                    </button>
                  </div>
                ))}
                {bundle.rules.length === 0 && <p className="text-[11px] text-graphite-500">No custom rules yet.</p>}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Brain className="h-4 w-4 text-graphite-400" /> Repository memory</h3>
              <p className="mb-3 text-[11px] text-graphite-500">
                Teach PRISM durable context (architecture decisions, accepted patterns, exceptions). Agents read it before reviewing.
              </p>
              <div className="mb-3 grid gap-2 sm:grid-cols-[200px_1fr_auto]">
                <select value={memoryForm.kind} onChange={(e) => setMemoryForm({ ...memoryForm, kind: e.target.value })} className="input h-8 text-xs">
                  {["architecture_decision", "accepted_pattern", "rejected_pattern", "exception", "feedback"].map((k) => (
                    <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <input value={memoryForm.content} onChange={(e) => setMemoryForm({ ...memoryForm, content: e.target.value })} placeholder="e.g. Auth tokens are short-lived JWTs validated in middleware/auth.ts" className="input h-8 text-xs" />
                <button onClick={addMemory} className="btn-secondary h-8 px-3 text-xs"><Plus className="h-3.5 w-3.5" /> Add</button>
              </div>
              <div className="space-y-1.5">
                {bundle.memory.map((m) => (
                  <div key={m.id} className="rounded border border-graphite-700 px-3 py-1.5 text-[11px]">
                    <span className="mr-2 uppercase tracking-wider text-graphite-500">{m.kind.replace(/_/g, " ")}</span>
                    <span className="text-graphite-300">{m.content}</span>
                  </div>
                ))}
                {bundle.memory.length === 0 && <p className="text-[11px] text-graphite-500">Memory also accrues automatically from finding triage.</p>}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-graphite-700 px-3 py-2 text-xs">
      <span className="pr-2 text-graphite-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-prism-red" : "bg-graphite-700")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}
