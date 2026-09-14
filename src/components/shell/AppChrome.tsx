"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderGit2,
  GitPullRequest,
  AlertTriangle,
  Bot,
  Activity,
  BarChart3,
  ShieldCheck,
  PlugIcon,
  Settings,
  Search,
  Sparkles,
  LogOut,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";
import { CommandPalette } from "./CommandPalette";
import { Copilot } from "./Copilot";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/pull-requests", label: "Pull Requests", icon: GitPullRequest },
  { href: "/findings", label: "Findings", icon: AlertTriangle },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/policies", label: "Policies", icon: ShieldCheck },
  { href: "/integrations", label: "Integrations", icon: PlugIcon },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppChrome({
  user,
  mode,
  children,
}: {
  user: { login: string; name: string | null; isDemo: boolean };
  mode: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [copilot, setCopilot] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setCopilot((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-graphite-800 bg-graphite-900 md:flex">
        <Link href="/dashboard" className="flex h-14 items-center gap-2 border-b border-graphite-800 px-4">
          <LogoMark />
          <span className="text-sm font-semibold tracking-[0.18em]">PRISM</span>
        </Link>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors focus-ring",
                  active ? "bg-graphite-750 text-graphite-50" : "text-graphite-300 hover:bg-graphite-800 hover:text-graphite-100",
                )}
              >
                <n.icon className={cn("h-4 w-4", active ? "text-prism-red" : "text-graphite-400")} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-graphite-800 p-3">
          <Link href="/docs" className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-graphite-400 hover:text-graphite-200">
            <BookOpen className="h-4 w-4" /> Docs
          </Link>
          <div className="flex items-center gap-2 rounded-md bg-graphite-850 px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-graphite-600 to-graphite-800 text-[11px] font-semibold uppercase text-graphite-100">
              {user.login.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-graphite-100">{user.name ?? user.login}</div>
              <div className="truncate text-[10px] text-graphite-400">{user.login}</div>
            </div>
            <button onClick={logout} className="text-graphite-400 hover:text-graphite-100" aria-label="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-graphite-800 bg-graphite-950/85 px-4 backdrop-blur md:px-6">
          <button
            onClick={() => setPalette(true)}
            className="flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-graphite-700 bg-graphite-900 px-3 text-xs text-graphite-400 transition-colors hover:border-graphite-500"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search reviews, findings, repositories…</span>
            <span className="kbd">⌘K</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            {mode === "demo" ? (
              <span className="rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                Demo mode
              </span>
            ) : (
              <span className="rounded border border-green-900/60 bg-green-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-300">
                Live
              </span>
            )}
            <button onClick={() => setCopilot(true)} className="btn-secondary h-8 px-3 text-xs" aria-label="Open Copilot (Ctrl+J)">
              <Sparkles className="h-3.5 w-3.5 text-prism-red" />
              Copilot
              <span className="kbd hidden sm:inline">⌃J</span>
            </button>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-graphite-800 bg-graphite-900 px-2 py-1.5 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs", pathname.startsWith(n.href) ? "bg-graphite-750 text-graphite-50" : "text-graphite-300")}>
              <n.icon className="h-3.5 w-3.5" /> {n.label}
            </Link>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Copilot open={copilot} onClose={() => setCopilot(false)} />
    </div>
  );
}
