import Link from "next/link";
import {
  ArrowRight,
  GitPullRequest,
  Network,
  Scale,
  FileSearch,
  ShieldCheck,
  Gauge,
  FlaskConical,
  Brain,
  Boxes,
  Eye,
  MessageSquareQuote,
  RotateCcw,
  Lock,
  Cpu,
} from "lucide-react";
import { DemoButton } from "@/components/DemoButton";
import { LandingAnimation } from "@/components/landing/LandingAnimation";
import { LogoMark } from "@/components/Logo";

const DIFFERENTIATORS = [
  { icon: Eye, title: "Repository-aware, not diff-blind", body: "A context engine builds a code relationship graph — callers, callees, tests, middleware — and selects a bounded, relevant bundle for every change." },
  { icon: Boxes, title: "Multi-agent review mesh", body: "Security, correctness, performance, maintainability, tests, API contracts and dependencies are reviewed by specialized agents, then merged without duplicates." },
  { icon: FileSearch, title: "Deterministic first", body: "Secret scanning, advisory matching and a Semgrep-style rules engine run before any model call. Every finding is tagged DET, AI or DET+AI." },
  { icon: Scale, title: "Adversarial critic", body: "Every HIGH/CRITICAL finding is challenged: could it be wrong, intentional, or disproved by surrounding code? Weak and false findings are suppressed." },
  { icon: ShieldCheck, title: "Evidence-backed", body: "Each finding carries a chain: changed code, related code, context, static evidence, agent analysis and critic verification." },
  { icon: Gauge, title: "Explainable risk", body: "A 0–100 score across security, correctness, performance, testing, dependencies and scope — with the reason for every point." },
  { icon: FlaskConical, title: "Test-gap detection", body: "Changed routes and functions with no linked tests get concrete regression scenarios and generated, never-auto-applied scaffolds." },
  { icon: RotateCcw, title: "Regression-aware", body: "A new commit invalidates the prior review; PRISM re-reviews and reports fixed, persistent and new findings per fingerprint." },
  { icon: Brain, title: "Repository memory", body: "Dismissals and accepted patterns become structured repository knowledge and configurable rules — never silent model training." },
];

const AGENTS = [
  ["Bug Hunter", "logic, races, null handling"],
  ["Security Reviewer", "authz, injection, secrets, crypto"],
  ["Performance Reviewer", "N+1, unbounded fetches"],
  ["Maintainability", "duplication, architecture"],
  ["Test Reviewer", "coverage & regression cases"],
  ["API / Contract", "validation, pagination, compat"],
  ["Dependency Reviewer", "advisory-matched CVEs"],
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-graphite-950">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-graphite-800/80 bg-graphite-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-sm font-semibold tracking-[0.2em] text-graphite-50">PRISM</span>
            <span className="ml-2 hidden rounded border border-graphite-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-graphite-300 sm:inline">
              Pull Request Intelligence &amp; Review Mesh
            </span>
          </div>
          <nav className="flex items-center gap-1 text-sm text-graphite-200">
            <Link href="/docs" className="btn-ghost px-3 py-1.5 text-xs">Docs</Link>
            <Link href="/install" className="btn-ghost px-3 py-1.5 text-xs">Install</Link>
            <Link href="/login" className="btn-ghost px-3 py-1.5 text-xs">Sign in</Link>
            <Link href="/install" className="btn-primary px-3.5 py-1.5 text-xs">
              Install on GitHub
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden grid-bg">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-prism-red/60 to-transparent" />
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1.2fr] lg:py-24">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-graphite-700 bg-graphite-900 px-3 py-1 text-[11px] text-graphite-300">
              <span className="h-1.5 w-1.5 rounded-full bg-prism-red" />
              Beyond the diff — understand the change
            </div>
            <h1 className="text-5xl font-bold tracking-tight text-graphite-50 lg:text-6xl">
              PRISM
            </h1>
            <p className="mt-4 max-w-xl text-xl font-medium text-graphite-100">
              AI code review that <span className="text-white">understands your repository.</span>
            </p>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-graphite-300">
              Go beyond the diff. PRISM analyzes changes in context, challenges its own findings through
              an adversarial critic, and gives every important review comment an evidence trail — with an
              explainable answer to <span className="text-graphite-100">“Should this PR be merged?”</span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/install" className="btn-primary">
                Install on GitHub <ArrowRight className="h-4 w-4" />
              </Link>
              <DemoButton label="View Demo" />
            </div>
            <p className="mt-4 text-[11px] text-graphite-400">
              Demo runs the real pipeline against a seeded repository with a known SQL injection,
              missing authorization, tautological validation, N+1 query, test gap and vulnerable dependency.
            </p>
          </div>
          <div className="lg:pt-2">
            <LandingAnimation />
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section className="border-t border-graphite-800 bg-graphite-900/40 py-16">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-graphite-400">The review pipeline</h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-y-4 text-center text-[11px]">
            {[
              ["GitHub", GitPullRequest],
              ["Verified webhook", ShieldCheck],
              ["PR snapshot", FileSearch],
              ["Context + code graph", Network],
              ["Static analysis", Cpu],
              ["Agent mesh", Brain],
              ["Adversarial critic", Scale],
              ["Evidence + risk", Gauge],
              ["GitHub review", MessageSquareQuote],
            ].map(([label, Icon], i, arr) => (
              <div key={label as string} className="flex items-center">
                <div className="flex w-28 flex-col items-center gap-1.5 px-2">
                  {/* @ts-expect-error icon tuple */}
                  <Icon className="h-4 w-4 text-prism-red/80" />
                  <span className="text-graphite-200">{label as string}</span>
                </div>
                {i < arr.length - 1 ? <ArrowRight className="h-3 w-3 text-graphite-600" /> : null}
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-graphite-400">
            Webhooks verify HMAC signatures, persist events and enqueue jobs in milliseconds. Reviews run
            asynchronously with retries, exponential backoff, dead-letter handling and idempotent commit pins.
          </p>
        </div>
      </section>

      {/* Signature experience */}
      <section className="border-t border-graphite-800 py-20">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-graphite-50">
            The hero feature isn’t “AI found 37 issues.”
          </h2>
          <p className="mt-3 text-lg text-graphite-200">It’s —</p>
          <p className="mt-2 text-2xl font-semibold text-white">“Why did PRISM flag this?”</p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-2 text-left">
            {[
              ["Finding", "Severity, category and confidence — verified or refuted by a critic"],
              ["Changed code", "The exact added line at the reviewed commit SHA"],
              ["Related code", "Callers, middleware conventions and sibling handlers"],
              ["Repository context", "Bounded graph-selected files, tests and configuration"],
              ["Deterministic evidence", "Rule matches, secret scans and advisory catalog hits"],
              ["Agent analysis", "Specialized reasoning, validated against a strict schema"],
              ["Critic verification", "A second pass that tries to disprove the claim"],
              ["Recommendation", "Fix, suggested patch, and the policy that gates merge"],
            ].map(([step, body], i) => (
              <div key={step} className="flex items-start gap-3 rounded-md border border-graphite-700/70 bg-graphite-900 px-4 py-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-prism-red/60 bg-red-950/60 text-[10px] font-bold text-prism-red">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-graphite-50">{step}</div>
                  <div className="text-xs text-graphite-400">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section className="border-t border-graphite-800 bg-graphite-900/40 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-2xl font-bold tracking-tight text-graphite-50">Built for trust, not throughput of nitpicks</h2>
          <p className="mt-2 max-w-2xl text-sm text-graphite-400">
            Two accurate findings beat twenty-seven speculative ones. PRISM suppresses vague suggestions,
            duplicates and ungrounded claims by construction.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-graphite-700 bg-graphite-700 md:grid-cols-2 lg:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="bg-graphite-900 p-5">
                <d.icon className="h-5 w-5 text-prism-red" />
                <h3 className="mt-3 text-sm font-semibold text-graphite-50">{d.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-graphite-400">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agents */}
      <section className="border-t border-graphite-800 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-graphite-50">A review mesh, not a single prompt</h2>
            <p className="mt-3 text-sm leading-relaxed text-graphite-400">
              Each agent owns a discipline, streams a decision summary, tool calls and token use, and returns
              strictly-validated findings. The synthesizer merges overlapping reports — Security and Bug Hunter
              flagging the same missing auth becomes one hybrid finding with combined evidence.
            </p>
            <div className="mt-6 rounded-lg border border-graphite-700 bg-graphite-900 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-graphite-200">
                <Lock className="h-3.5 w-3.5 text-prism-green" />
                Honest by design
              </div>
              <ul className="space-y-1.5 text-xs text-graphite-400">
                <li>• No API keys? Agents run deterministic-only and say so.</li>
                <li>• No GitHub App? Everything is labeled DEMO, never faked.</li>
                <li>• PR code is untrusted: tooling runs sandboxed with scrubbed env.</li>
                <li>• Chain-of-thought is never stored; only decision summaries.</li>
              </ul>
            </div>
          </div>
          <div className="panel divide-y divide-graphite-700/70 p-0">
            {AGENTS.map(([name, scope]) => (
              <div key={name} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm font-medium text-graphite-100">{name}</span>
                <span className="text-right font-mono text-[11px] text-graphite-400">{scope}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-graphite-800 bg-graphite-900/40 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-graphite-50">Review with evidence.</h2>
          <p className="mt-2 text-sm text-graphite-400">
            Connect the GitHub App, select repositories, open a PR — first review in under five minutes.
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <Link href="/install" className="btn-primary">Install on GitHub</Link>
            <DemoButton label="Run the flagship demo" variant="primary" />
          </div>
        </div>
      </section>

      <footer className="border-t border-graphite-800 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 text-[11px] text-graphite-500">
          <span className="flex items-center gap-2">
            <LogoMark className="h-4 w-4" /> PRISM — Pull Request Intelligence &amp; Review Mesh
          </span>
          <span>Beyond the diff. Understand the change. Verify the risk.</span>
        </div>
      </footer>
    </div>
  );
}
