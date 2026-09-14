import { cn } from "@/lib/utils";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#b91c1c",
  HIGH: "#ef4444",
  MEDIUM: "#f59e0b",
  LOW: "#3b82f6",
  INFO: "#5a6170",
};

export function SeverityDonut({ data, size = 140 }: { data: { severity: string; c: number }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.c, 0);
  const radius = size / 2 - 12;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  if (total === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-xs text-graphite-500">No open findings</div>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#23272f" strokeWidth={14} />
      {data.map((d) => {
        const len = (d.c / total) * circ;
        const seg = (
          <circle
            key={d.severity}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={SEV_COLOR[d.severity] ?? "#5a6170"}
            strokeWidth={14}
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}

export function CategoryBars({ data }: { data: { category: string; c: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.c));
  if (!data.length) return <div className="py-8 text-center text-xs text-graphite-500">No findings yet</div>;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.category} className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 truncate text-graphite-300">{d.category.replace(/_/g, " ").toLowerCase()}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-graphite-800">
            <div
              className="h-full rounded bg-gradient-to-r from-prism-crimson to-prism-amber"
              style={{ width: `${(d.c / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right tabular-nums text-graphite-200">{d.c}</span>
        </div>
      ))}
    </div>
  );
}

export function LineSpark({ data, height = 64 }: { data: { label: string; value: number }[]; height?: number }) {
  if (data.length < 2) {
    return <div className="py-6 text-center text-xs text-graphite-500">Needs at least two data points</div>;
  }
  const w = 320;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = w / (data.length - 1);
  const pts = data.map((d, i) => `${i * step},${height - (d.value / max) * (height - 8) - 4}`);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full">
      <polyline points={pts.join(" ")} fill="none" stroke="#ef4444" strokeWidth={1.6} />
      {data.map((d, i) => (
        <circle key={i} cx={i * step} cy={height - (d.value / max) * (height - 8) - 4} r={2} fill="#f59e0b" />
      ))}
    </svg>
  );
}

export function RiskTrendChart({ data }: { data: { created_at: string; risk_score: number; repo: string; pr: number }[] }) {
  if (data.length < 2) return <div className="py-6 text-center text-xs text-graphite-500">Need at least two reviews to show a trend</div>;
  const points = [...data].reverse();
  const h = 90;
  const w = 360;
  const step = w / Math.max(1, points.length - 1);
  const y = (v: number) => h - 6 - (v / 100) * (h - 14);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {[25, 50, 75].map((g) => (
        <g key={g}>
          <line x1={0} x2={w} y1={y(g)} y2={y(g)} stroke="#23272f" strokeDasharray="3 3" />
          <text x={2} y={y(g) - 2} fill="#5a6170" fontSize="8">
            {g}
          </text>
        </g>
      ))}
      <polyline
        points={points.map((p, i) => `${i * step},${y(p.risk_score)}`).join(" ")}
        fill="none"
        stroke="#ef4444"
        strokeWidth={1.8}
      />
      {points.map((p, i) => (
        <circle key={i} cx={i * step} cy={y(p.risk_score)} r={3} fill={p.risk_score >= 60 ? "#ef4444" : p.risk_score >= 30 ? "#f59e0b" : "#22c55e"} />
      ))}
    </svg>
  );
}

export function ToneText({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn("text-graphite-500", className)}>—</span>;
  const tone = value >= 80 ? "text-red-300" : value >= 60 ? "text-red-400" : value >= 30 ? "text-amber-300" : "text-green-300";
  return <span className={cn(tone, "tabular-nums", className)}>{value}</span>;
}
