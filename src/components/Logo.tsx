import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} fill="none" aria-hidden>
      <defs>
        <linearGradient id="prism-spectrum" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <path d="M16 3 L29 26 H3 Z" stroke="url(#prism-spectrum)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M2 13 H12 M16 3 V1" stroke="#8b93a3" strokeWidth="1" opacity="0.7" />
      <path d="M20 14 L30 9 M22 19 L30 19 M20 24 L30 29" stroke="#ef4444" strokeWidth="1" opacity="0.8" />
      <circle cx="16" cy="19" r="1.6" fill="#f4f6f9" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[0.18em] text-graphite-50", className)}>
      <LogoMark />
      PRISM
    </span>
  );
}
