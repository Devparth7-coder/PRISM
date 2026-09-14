"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Github, FlaskConical, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui";

function LoginForm({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<"demo" | "github" | null>(null);
  const [error, setError] = useState<string | null>(params.get("error"));
  const next = params.get("next") ?? "/dashboard";

  async function demo() {
    setBusy("demo");
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "demo" }),
    });
    if (!res.ok) {
      setError("Demo bootstrap failed");
      setBusy(null);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <LogoMark className="h-10 w-10" />
        <h1 className="text-xl font-semibold tracking-[0.2em] text-graphite-50">PRISM</h1>
        <p className="text-xs text-graphite-400">Pull Request Intelligence &amp; Review Mesh</p>
      </div>
      <div className="panel space-y-3 p-5">
        <Button onClick={demo} className="w-full" variant="primary" disabled={busy !== null}>
          {busy === "demo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          Continue with demo environment
        </Button>
        {githubEnabled ? (
          <Button className="w-full" disabled={busy !== null} onClick={() => (window.location.href = "/api/auth/github")}>
            <Github className="h-4 w-4" />
            Continue with GitHub
          </Button>
        ) : (
          <div className="rounded-md border border-graphite-700 bg-graphite-900 p-3 text-[11px] leading-relaxed text-graphite-400">
            GitHub OAuth is not configured. The demo environment runs the full, real review pipeline against a
            bundled repository — no external account needed.
          </div>
        )}
        {error ? <div className="rounded-md border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-300">{error}</div> : null}
      </div>
      <p className="mt-4 text-center text-[11px] text-graphite-500">
        Demo data is clearly labeled and never mixed with connected repositories.
      </p>
    </div>
  );
}

export default function LoginPage() {
  const [githubEnabled, setGithubEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setGithubEnabled(Boolean(d.githubAppConfigured)))
      .catch(() => undefined);
  }, []);
  return (
    <div className="grid-bg flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <LoginForm githubEnabled={githubEnabled} />
      </Suspense>
    </div>
  );
}
