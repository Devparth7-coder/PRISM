"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold text-graphite-50">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-graphite-300">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const variantCls =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
        ? "btn bg-prism-crimson text-white hover:bg-red-700"
        : variant === "ghost"
          ? "btn-ghost"
          : "btn-secondary";
  return (
    <button className={cn(variantCls, size === "sm" && "px-2.5 py-1 text-xs", className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", className)}>
      {children}
    </span>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-graphite-700", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-prism-red to-amber-500 transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-graphite-300", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-graphite-600 bg-graphite-900/50 px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-graphite-400">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-graphite-100">{title}</h3>
      {body ? <p className="mt-1 max-w-md text-xs leading-relaxed text-graphite-300">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "danger" | "warn" | "ok" }) {
  const toneCls = tone === "danger" ? "text-prism-red" : tone === "warn" ? "text-prism-amber" : tone === "ok" ? "text-prism-green" : "text-graphite-50";
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-graphite-300">{label}</div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-graphite-400">{hint}</div> : null}
    </Card>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-tight text-graphite-50">{children}</h2>
      {hint ? <p className="mt-0.5 text-xs text-graphite-400">{hint}</p> : null}
    </div>
  );
}
