"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2, ShieldAlert, Database, KeyRound, GitBranch, FileCode, Brain, Scale, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = [
  { icon: GitBranch, label: "PR snapshot @ b02f9e4", detail: "3 files · +91 −4" },
  { icon: Database, label: "Context engine", detail: "code graph · 8 files · auth hotspot" },
  { icon: FileCode, label: "Static analysis", detail: "rules · secret scan · advisory DB" },
  { icon: Brain, label: "Review mesh", detail: "7 agents in parallel" },
  { icon: Scale, label: "Adversarial critic", detail: "challenges HIGH/CRITICAL" },
  { icon: Gauge, label: "Risk + synthesis", detail: "evidence-backed review" },
];

const EVIDENCE = [
  { label: "Changed code", detail: "src/routes/members.ts:51 — query interpolates ${orgId}" },
  { label: "Related code", detail: "organizations.ts:24 — sibling routes use $1 bound parameters" },
  { label: "Static evidence", detail: "rules-engine/sql-injection: SQL keyword + taint marker" },
  { label: "Repository context", detail: "orgId assigned from req.params.orgId" },
  { label: "Critic verification", detail: "CONFIRMED — statement not parameterized, value request-derived" },
  { label: "Recommendation", detail: "db.query('...WHERE org_id = $1', [orgId])" },
];

export function LandingAnimation() {
  const [stage, setStage] = useState(0);
  const [evidenceStep, setEvidenceStep] = useState(0);
  const [started, setStarted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      setStage(STAGES.length);
      setEvidenceStep(EVIDENCE.length);
      setStarted(true);
      return;
    }
    setStarted(true);
    if (stage < STAGES.length) {
      timer.current = setTimeout(() => setStage((s) => s + 1), 620);
    } else if (evidenceStep < EVIDENCE.length) {
      timer.current = setTimeout(() => setEvidenceStep((s) => s + 1), 520);
    } else {
      timer.current = setTimeout(() => {
        setStage(0);
        setEvidenceStep(0);
      }, 4200);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [stage, evidenceStep, reduced]);

  return (
    <div className="panel relative overflow-hidden p-0 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-graphite-700 bg-graphite-900 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-graphite-300">
          <span className="h-2.5 w-2.5 rounded-full bg-graphite-600" />
          <span className="font-mono">PR #184 · Add organization member management API</span>
        </div>
        <span className="rounded border border-graphite-600 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-graphite-300">
          Demo run
        </span>
      </div>

      <div className="grid gap-0 md:grid-cols-[240px_1fr]">
        {/* Pipeline */}
        <div className="border-b border-graphite-700 p-4 md:border-b-0 md:border-r">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-graphite-400">Pipeline</div>
          <ol className="space-y-2.5">
            {STAGES.map((s, i) => {
              const done = i < stage;
              const active = i === stage;
              return (
                <li key={s.label} className="flex items-start gap-2.5 text-xs">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      done && "border-prism-green/60 bg-green-950/50 text-prism-green",
                      active && started && "border-prism-amber/70 text-prism-amber",
                      !done && !active && "border-graphite-600 text-graphite-500",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <s.icon className="h-3 w-3 opacity-60" />}
                  </span>
                  <span>
                    <span className={cn("block font-medium", done || active ? "text-graphite-100" : "text-graphite-400")}>{s.label}</span>
                    <span className="block text-[10px] text-graphite-400">{s.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Evidence reveal */}
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-prism-red" />
            <span className="text-xs font-semibold text-graphite-50">CRITICAL — SQL query built from interpolated input</span>
            <span className="ml-auto rounded border border-red-900/60 bg-red-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
              critic: confirmed
            </span>
          </div>

          <div className="mb-3 rounded-md border border-graphite-700 bg-graphite-950 p-3 font-mono text-[11px] leading-relaxed">
            <div className="text-graphite-500">{"// src/routes/members.ts:51"}</div>
            <div className="text-red-300">
              {`  SELECT id FROM members WHERE org_id = '`}
              <span className="rounded bg-red-950 underline decoration-red-500/60">{`${"{orgId}"}`}</span>
              {'\' '}
            </div>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wider text-graphite-400">Why did PRISM flag this?</div>
          <ol className="mt-2 space-y-2">
            {EVIDENCE.slice(0, evidenceStep).map((e, i) => (
              <li
                key={e.label}
                className="animate-fade-in rounded-md border border-graphite-700/80 bg-graphite-900 p-2.5 text-xs"
              >
                <div className="flex items-center gap-1.5 font-medium text-graphite-100">
                  <ChevronRight className="h-3 w-3 text-prism-red" />
                  {i + 1}. {e.label}
                </div>
                <div className="mt-0.5 pl-4 font-mono text-[10.5px] text-graphite-300">{e.detail}</div>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex items-center justify-between border-t border-graphite-700 pt-3 text-[11px] text-graphite-300">
            <span>
              Recommendation: <span className="font-semibold text-prism-amber">REQUEST CHANGES</span> · Risk 63/100
            </span>
            <KeyRound className="h-3.5 w-3.5 text-graphite-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
