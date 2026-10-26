// Dependency-free SVG charts, rendered on the server. Every chart scales with its
// container (viewBox), shows exact values in tooltips, and has an empty state.
import { BarChart3 } from "lucide-react";
import { formatMoney, type Cents } from "@/lib/money";

export const CHART_COLORS = {
  primary: "#1565d9",
  collections: "#1565d9",
  expenses: "#e19404",
  billed: "#a9c4ef",
  brand: "#859ba1",
  amber: "#e19404",
  green: "#0c9c5d",
  red: "#dc3e3b",
  slate: "#94a3b8",
  violet: "#7c3aed",
};

function compact(cents: Cents): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
      <BarChart3 className="size-6 text-slate-300" aria-hidden />
      {message}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value && <span className="font-medium text-slate-900 tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Grouped vertical bars (e.g. collections vs expenses per month). */
export function GroupedBarChart({
  categories,
  series,
  emptyMessage = "No data for this period yet.",
  title,
}: {
  categories: string[];
  series: { name: string; color: string; values: Cents[] }[];
  emptyMessage?: string;
  title: string;
}) {
  const all = series.flatMap((s) => s.values);
  if (all.every((v) => v === 0)) return <ChartEmpty message={emptyMessage} />;
  const W = 560, H = 230, L = 46, R = 8, T = 12, B = 28;
  const max = niceMax(Math.max(...all));
  const plotW = W - L - R, plotH = H - T - B;
  const groupW = plotW / categories.length;
  const barW = Math.min(26, (groupW * 0.62) / series.length);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  return (
    <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label={title}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeDasharray={f === 0 ? "" : "3 3"} />
          <text x={L - 6} y={y(max * f) + 3} textAnchor="end" fontSize="11" fill="#5b6f8c">
            {compact(max * f)}
          </text>
        </g>
      ))}
      {categories.map((c, ci) => {
        const gx = L + ci * groupW + (groupW - barW * series.length) / 2;
        return (
          <g key={c}>
            {series.map((s, si) => {
              const v = s.values[ci];
              const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
              return (
                <rect key={s.name} x={gx + si * barW} y={T + plotH - h} width={barW - 2} height={h} rx="3" fill={s.color}>
                  <title>{`${c} — ${s.name}: ${formatMoney(v)}`}</title>
                </rect>
              );
            })}
            <text x={L + ci * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#5b6f8c">
              {c}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/** Lines over the same categories (e.g. billed vs collected). */
export function LineChart({
  categories,
  series,
  title,
  emptyMessage = "No data for this period yet.",
  area = false,
}: {
  categories: string[];
  series: { name: string; color: string; values: Cents[] }[];
  title: string;
  emptyMessage?: string;
  /** Fill the area under the (first) line, as in the prototype's expenses chart. */
  area?: boolean;
}) {
  const all = series.flatMap((s) => s.values);
  if (all.every((v) => v === 0)) return <ChartEmpty message={emptyMessage} />;
  const W = 560, H = 230, L = 46, R = 14, T = 12, B = 28;
  const max = niceMax(Math.max(...all));
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i: number) => L + (categories.length === 1 ? plotW / 2 : (i / (categories.length - 1)) * plotW);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  return (
    <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label={title}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeDasharray={f === 0 ? "" : "3 3"} />
          <text x={L - 6} y={y(max * f) + 3} textAnchor="end" fontSize="11" fill="#5b6f8c">
            {compact(max * f)}
          </text>
        </g>
      ))}
      {categories.map((c, i) => (
        <text key={c} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#5b6f8c">
          {c}
        </text>
      ))}
      {area && series[0] && (
        <polygon
          points={[`${x(0)},${y(0)}`, ...series[0].values.map((v, i) => `${x(i)},${y(v)}`), `${x(series[0].values.length - 1)},${y(0)}`].join(" ")}
          fill={series[0].color}
          fillOpacity="0.12"
        />
      )}
      {series.map((s) => (
        <g key={s.name}>
          <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2">
              <title>{`${categories[i]} — ${s.name}: ${formatMoney(v)}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
    </div>
  );
}

/** Donut with a centre total (e.g. occupancy). */
export function DonutChart({ segments, centerLabel, title }: { segments: { label: string; value: number; color: string }[]; centerLabel: string; title: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <ChartEmpty message="No units yet." />;
  const R = 70, C = 2 * Math.PI * R;
  const visible = segments.filter((s) => s.value > 0);
  const lengths = visible.map((s) => (s.value / total) * C);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 200" className="size-40 shrink-0" role="img" aria-label={title}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="#f1f5f9" strokeWidth="26" />
        {visible.map((s, i) => (
          <circle key={s.label} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="26" strokeDasharray={`${lengths[i]} ${C - lengths[i]}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 100 100)">
            <title>{`${s.label}: ${s.value}`}</title>
          </circle>
        ))}
        <text x="100" y="98" textAnchor="middle" fontSize="30" fontWeight="600" fill="#0f2236">
          {total}
        </text>
        <text x="100" y="120" textAnchor="middle" fontSize="12" fill="#64748b">
          {centerLabel}
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="font-medium text-navy-900 tabular-nums">
              {s.value} <span className="text-xs font-normal text-slate-400">({Math.round((s.value / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Whole-number percentages that always add up to 100 (largest-remainder method), so
 * e.g. 1 occupied of 8 shows 13% + 88% = 101% never. All zero → all 0.
 */
export function sharePercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0, left = 100 - out.reduce((a, b) => a + b, 0); k < left; k++) out[order[k][1]] += 1;
  return out;
}

/** A ring with segments and a centre label; legends are rendered by the caller. Empty data shows a grey ring. */
export function RingChart({ segments, center, sub, title }: { segments: { label: string; value: number; color: string }[]; center: string; sub: string; title: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 70, C = 2 * Math.PI * R;
  const visible = segments.filter((s) => s.value > 0);
  const lengths = visible.map((s) => (s.value / total) * C);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <svg viewBox="0 0 200 200" className="size-36 shrink-0 sm:size-40" role="img" aria-label={title}>
      <circle cx="100" cy="100" r={R} fill="none" stroke="#e8edf3" strokeWidth="22" />
      {visible.map((s, i) => (
        <circle key={s.label} cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="22" strokeDasharray={`${lengths[i]} ${C - lengths[i]}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 100 100)">
          <title>{`${s.label}: ${s.value}`}</title>
        </circle>
      ))}
      <text x="100" y="100" textAnchor="middle" fontSize={center.length <= 5 ? 32 : center.length <= 9 ? 24 : center.length <= 12 ? 15.5 : 13} fontWeight="700" fill="#0a2c4c">
        {center}
      </text>
      <text x="100" y="124" textAnchor="middle" fontSize="12.5" fill="#6b7f9c">
        {sub}
      </text>
    </svg>
  );
}

/** Horizontal bars with amounts (e.g. arrears ageing). */
export function HorizontalBars({ items, emptyMessage }: { items: { label: string; value: Cents; color: string; href?: string }[]; emptyMessage: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (max === 0) return <ChartEmpty message={emptyMessage} />;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-slate-600">{i.label}</span>
            <span className="font-medium text-navy-900 tabular-nums">{formatMoney(i.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div className="h-2.5 rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
