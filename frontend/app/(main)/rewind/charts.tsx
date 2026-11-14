"use client";

import { useState } from "react";
import { day, pct } from "./data";
import s from "./rewind.module.css";

/*
 * Rewind's three small charts. One series each, so one hue (the Rewind channel colour) and no
 * legend; the numbers are always printed beside the marks, so nothing is read from colour alone.
 */

/** Counts as a table with a bar in each row: the top outcomes, then everything else as "other". */
export function CountBars({ counts, shots, ideal, top = 12 }: {
  counts: Record<string, number>; shots: number; ideal?: [string, number][]; top?: number;
}) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, top);
  const rest = sorted.slice(top);
  const other = rest.reduce((n, [, v]) => n + v, 0);
  const idealOf = new Map((ideal ?? []).map(([k, p]) => [k.replace(/ /g, ""), p]));
  const max = Math.max(...shown.map(([, v]) => v / shots), other / shots, ...[...idealOf.values()], 1e-9);
  const rows: { key: string; label: string; n: number; ideal: number | null; other?: boolean }[] = shown.map(([k, v]) => ({
    key: k, label: k, n: v, ideal: idealOf.size ? idealOf.get(k.replace(/ /g, "")) ?? 0 : null,
  }));
  if (other) rows.push({ key: "__other", label: `other (${rest.length} outcome${rest.length === 1 ? "" : "s"})`, n: other, ideal: null, other: true });
  return (
    <table className={s.bars}>
      <caption className={s.sr}>Counts per outcome, most frequent first{idealOf.size ? ", with the noiseless probability" : ""}</caption>
      <thead>
        <tr><th scope="col">Outcome</th><th scope="col" className={s.r}>Shots</th><th scope="col" className={s.r}>Share</th>
          <th scope="col" className={s.barCol}><span className={s.sr}>Bar</span>{idealOf.size ? <span className={s.legendTick} aria-hidden="true">┆ noiseless</span> : null}</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} title={`${r.label}: ${r.n} of ${shots} shots (${pct(r.n / shots)})${r.ideal != null ? `; noiseless ${pct(r.ideal)}` : ""}`}>
            <th scope="row" className={r.other ? s.otherLabel : "mono"}>{r.label}</th>
            <td className={`${s.r} num`}>{r.n.toLocaleString("en-US")}</td>
            <td className={`${s.r} num`}>{pct(r.n / shots)}</td>
            <td className={s.barCol} aria-hidden="true">
              <span className={s.track}>
                <span className={r.other ? s.barOther : s.bar} style={{ width: `${Math.max(0.6, (r.n / shots / max) * 100)}%` }} />
                {r.ideal != null && r.ideal > 0 && <span className={s.idealTick} style={{ left: `${(r.ideal / max) * 100}%` }} />}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One metric over the monthly replays, with a hover readout per point. */
export function TimeLine({ points, label }: { points: { date: string; v: number | null; sha?: string }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, L = 44, R = 14, T = 12, B = 28;
  const vals = points.map((p) => p.v).filter((v): v is number => v != null);
  if (!points.length) return null;
  const lo = vals.length ? Math.max(0, Math.floor((Math.min(...vals) - 0.02) * 20) / 20) : 0;
  const hi = vals.length ? Math.min(1, Math.ceil((Math.max(...vals) + 0.005) * 20) / 20) : 1;
  const span = Math.max(hi - lo, 0.05);
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const ticks = [lo, lo + span / 2, lo + span].map((v) => Math.round(v * 1000) / 1000);
  const path = points.map((p, i) => (p.v == null ? null : `${x(i)},${y(p.v)}`)).filter(Boolean).join(" ");
  const h = hover != null ? points[hover] : null;
  return (
    <figure className={s.chart} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} by calibration month: ${points.map((p) => `${day(p.date)} ${p.v == null ? "no result" : p.v.toFixed(3)}`).join("; ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={s.grid} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className={s.tick}>{t.toFixed(2)}</text>
          </g>
        ))}
        {points.map((p, i) => (i === 0 || i === points.length - 1 || points.length <= 6 || i % 2 === 0) && (
          <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" className={s.tick}>{day(p.date).replace(/^\d+ /, "")}</text>
        ))}
        {path && <polyline points={path} className={s.line} />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className={s.cross} />}
        {points.map((p, i) => p.v != null && (
          <circle key={p.date} cx={x(i)} cy={y(p.v)} r={hover === i ? 5 : 4} className={s.dot} />
        ))}
        {points.map((p, i) => (
          <rect key={`h${p.date}`} x={x(i) - (W - L - R) / Math.max(2, points.length) / 2} y={T} width={(W - L - R) / Math.max(2, points.length)}
            height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className={s.tip} style={{ left: `${(x(hover!) / W) * 100}%`, top: `${((h.v == null ? T : y(h.v)) / H) * 100}%` }}>
          <b className="num">{h.v == null ? "—" : h.v.toFixed(3)}</b>
          <small>{day(h.date)}{h.sha ? ` · ${h.sha.slice(0, 10)}` : ""}</small>
        </div>
      )}
    </figure>
  );
}

/** A sparkline: the stored days of one median, today's value marked. */
export function Spark({ values, dates, label, fmt, better }: {
  values: (number | null)[]; dates: string[]; label: string; fmt: (v: number) => string; better: "low" | "high";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 160, H = 36, P = 3;
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className={s.sparkNone}>not enough history</span>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (hi === lo ? 0.5 : (v - lo) / (hi - lo))) * (H - 2 * P);
  const last = pts[pts.length - 1];
  const h = hover != null ? values[hover] : null;
  return (
    <span className={s.spark} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${label} over ${values.length} days, from ${fmt(pts[0].v)} to ${fmt(last.v)}; range ${fmt(lo)} to ${fmt(hi)} (${better} is better)`}>
        <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} className={s.sparkLine} />
        <circle cx={x(last.i)} cy={y(last.v)} r={2.6} className={s.dot} />
        {hover != null && values[hover] != null && <circle cx={x(hover)} cy={y(values[hover]!)} r={2.6} className={s.hoverDot} />}
        {values.map((_, i) => (
          <rect key={i} x={x(i) - (W - 2 * P) / values.length / 2} y={0} width={(W - 2 * P) / values.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <span className={s.sparkRead} aria-hidden="true">
        {hover != null ? <>{h == null ? "—" : fmt(h)} <small>{day(dates[hover])}</small></> : <><small>{fmt(lo)}–{fmt(hi)}</small></>}
      </span>
    </span>
  );
}
