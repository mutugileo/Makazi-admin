// Small helpers shared by the Reports charts (src/components/reports).

/** Chart colours, validated with the dataviz palette checks (light surface). */
export const CHART = {
  /** Slot 1: Makazi green. Collected, M-Pesa, occupied, single-series bars. */
  series1: '#1C7A55',
  /** Slot 2: blue. Bank. */
  series2: '#2a78d6',
  /** What was billed, drawn behind what was collected. */
  ghost: '#DDE5E0',
  /** Arrears ageing, not yet due → 60+ days overdue (one hue, light → dark). */
  ageing: ['#E39A7B', '#D77753', '#C04A26', '#9A3A1C', '#6B2812'],
  grid: '#EEF1EC',
  axis: '#DCE0D7',
} as const;

/**
 * A clean top for the y-axis and its ticks (0, step, 2·step…): the step is a
 * 1 / 2 / 2.5 / 5 × 10ⁿ value, and of the steps that give 3 to 5 intervals the
 * one with the least empty space above the data wins.
 */
export function niceScale(max: number): { max: number; ticks: number[] } {
  // Nothing to plot: just the baseline, no made-up tick values.
  if (max <= 0) return { max: 1, ticks: [0] };
  const exp = Math.floor(Math.log10(max));
  let best: { step: number; count: number } | null = null;
  for (const e of [exp - 2, exp - 1, exp]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** e;
      const count = Math.max(1, Math.ceil(max / step - 1e-9));
      if (count < 3 || count > 5) continue;
      if (!best || step * count < best.step * best.count) best = { step, count };
    }
  }
  const { step, count } = best ?? { step: 10 ** exp, count: Math.ceil(max / 10 ** exp) };
  const ticks = Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
  return { max: ticks[ticks.length - 1], ticks };
}

/** KES 1.2M, KES 450K, KES 900: axis ticks and tight labels. */
export function compactKes(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}KES ${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}KES ${trim(abs / 1_000)}K`;
  return `${sign}KES ${abs}`;
}

const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

export interface TipRow {
  label: string;
  value: string;
  /** Series colour for the line key; omitted for plain rows. */
  color?: string;
}

/** The tooltip payload a mark carries (rendered with textContent, never as HTML). */
export function tip(title: string, rows: TipRow[]): string {
  return JSON.stringify({ title, rows });
}
