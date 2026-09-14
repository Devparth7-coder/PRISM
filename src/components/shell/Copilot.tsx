"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { useReviewContext } from "./ReviewContext";
import type { CopilotAnswer } from "@/lib/copilot-types";

interface Msg {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  "Why is this PR this risk level?",
  "Which finding should I fix first?",
  "Show me the strongest evidence",
  "What test cases are missing?",
  "What recurring issues should the team care about?",
];

export function Copilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useReviewContext();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(SUGGESTIONS);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "", pending: true }]);
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, reviewId: ctx.reviewId, repoId: ctx.repoId, findingId: ctx.findingId }),
      });
      const data = (await res.json()) as CopilotAnswer & { error?: string };
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "assistant", text: data.error ? `Could not answer: ${data.error}` : data.answer },
      ]);
      if (data.suggestions?.length) setSuggestions(data.suggestions);
    } catch (err) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", text: err instanceof Error ? err.message : "Request failed" }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-graphite-700 bg-graphite-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="PRISM Copilot"
      >
        <header className="flex items-center gap-2 border-b border-graphite-700 px-4 py-3">
          <Sparkles className="h-4 w-4 text-prism-red" />
          <div>
            <div className="text-sm font-semibold text-graphite-50">PRISM Copilot</div>
            <div className="text-[10px] text-graphite-400">
              {ctx.reviewId ? "grounded in this review" : ctx.repoId ? "grounded in this repository" : "grounded in your workspace data"}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost ml-auto p-1.5" aria-label="Close copilot">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-graphite-300">
                Ask about risk, evidence, fix priority or trends. Answers are computed from stored reviews — PRISM never
                fabricates findings or shows private reasoning.
              </p>
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} className="block w-full rounded-md border border-graphite-700 bg-graphite-850 px-3 py-2 text-left text-xs text-graphite-200 hover:border-graphite-500">
                  {s}
                </button>
              ))}
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "inline-block rounded-lg bg-prism-red/90 px-3 py-2 text-xs text-white"
                      : "rounded-lg border border-graphite-700 bg-graphite-850 px-3 py-2.5 text-xs leading-relaxed text-graphite-100"
                  }
                >
                  {m.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MarkdownLite text={m.text} />}
                </div>
              </div>
            ))
          )}
        </div>

        <form
          className="border-t border-graphite-700 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <div className="flex items-center gap-2">
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this review…"
              aria-label="Ask Copilot"
            />
            <button className="btn-primary px-2.5 py-2" type="submit" disabled={busy}>
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

/** Minimal markdown: bold, inline code, bullets — enough for grounded answers. */
function MarkdownLite({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 whitespace-pre-wrap">
      {text.split("\n").map((line, i) => {
        const isListItem = /^\d+\.|^-/.test(line.trim());
        const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
        return (
          <div key={i} className={isListItem ? "pl-1" : undefined}>
            {parts.map((p, j) =>
              p.startsWith("**") ? (
                <strong key={j} className="font-semibold text-graphite-50">
                  {p.slice(2, -2)}
                </strong>
              ) : p.startsWith("`") && p.endsWith("`") ? (
                <code key={j} className="rounded bg-graphite-800 px-1 font-mono text-[11px] text-red-200">
                  {p.slice(1, -1)}
                </code>
              ) : (
                <span key={j}>{p}</span>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
