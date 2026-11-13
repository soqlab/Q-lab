"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./board.module.css";

export type Point = { t: number; v: number; href: string; label: string; detail?: string; fresh?: boolean };
export type Series = { key: string; name: string; color: string; segments: Point[][] };

// Results over time, one line per series, on a fixed 0-to-1 axis with the noise-free ideal at 1.
// A series is split into segments where the benchmark set changed version, and segments are
// never joined. Every point is a link to the run it came from. Arrow keys step through points.
export default function TrendChart({ title, series, simulated }: { title: string; series: Series[]; simulated?: boolean }) {
  const all = useMemo(() => series.flatMap((s) => s.segments.flat().map((p) => ({ ...p, s }))).sort((a, b) => a.t - b.t), [series]);
  // Drawn at the figure's real width, so text and marks keep their size on a phone and a wide screen.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [all.length]);
  const H = W < 480 ? 200 : 240, L = 40, R = 16, T = 16, B = 28;
  const ref = useRef<SVGSVGElement>(null);
  const id = useId();
  const [i, setI] = useState<number | null>(null);

  const lo = all.length ? all[0].t : 0;
  const hi = all.length ? all[all.length - 1].t : 1;
  const pad = Math.max((hi - lo) * 0.04, 6 * 3600e3);
  const from = lo - pad, to = hi + pad;
  const vmin = Math.min(0.5, ...all.map((p) => p.v));
  const floor = vmin < 0.5 ? 0 : 0.5; // zoom to 0.5-1 when every value is above a half
  const x = (t: number) => L + ((t - from) / (to - from)) * (W - L - R);
  const y = (v: number) => T + ((1 - v) / (1 - floor)) * (H - T - B);

  const ticks = useMemo(() => {
    const n = W < 480 ? 2 : 4, out: number[] = [];
    for (let k = 0; k <= n; k++) out.push(from + ((to - from) * k) / n);
    return out;
  }, [from, to, W]);
  const grid = floor === 0 ? [0, 0.25, 0.5, 0.75, 1] : [0.5, 0.625, 0.75, 0.875, 1];

  const near = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el || !all.length) return;
    const box = el.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W, py = ((clientY - box.top) / box.height) * H;
    let best = 0, bd = Infinity;
    all.forEach((p, k) => { const d = (x(p.t) - px) ** 2 + ((y(p.v) - py) * 0.5) ** 2; if (d < bd) { bd = d; best = k; } });
    setI(best);
  };
  const key = (e: React.KeyboardEvent) => {
    if (!all.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setI((c) => (c === null ? (d > 0 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, c + d))));
    } else if (e.key === "Escape") setI(null);
    else if (e.key === "Enter" && i !== null) window.location.assign(all[i].href);
  };
  const cur = i !== null ? all[i] : null;

  if (!all.length) return null;

  return (
    <figure className={styles.chart} ref={box}>
      {simulated && <div className={styles.simBadge}>SIMULATED: local preview, not real hardware</div>}
      <svg
        ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
        aria-label={`${title}: ${all.length} result${all.length === 1 ? "" : "s"}. Left and right arrow keys read each point; Enter opens its run.`}
        aria-describedby={`${id}-live`}
        onPointerMove={(e) => near(e.clientX, e.clientY)} onPointerLeave={() => setI(null)} onKeyDown={key} onBlur={() => setI(null)}
      >
        {grid.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 1 ? styles.ideal : styles.gridline} />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" className={styles.tick}>{v}</text>
          </g>
        ))}
        <text x={W - R} y={y(1) - 5} textAnchor="end" className={styles.tick}>1 = noise-free ideal</text>
        {ticks.map((t, k) => (
          <text key={k} x={x(t)} y={H - 9} textAnchor={k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"} className={styles.tick}>
            {new Date(t).toISOString().slice(5, 10)}
          </text>
        ))}
        {series.map((s) => s.segments.map((seg, k) => seg.length > 1 && (
          <path key={`${s.key}-${k}`} d={seg.map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
            fill="none" stroke={s.color} strokeWidth={1.6} />
        )))}
        {all.map((p, k) => (
          <a key={k} href={p.href} aria-label={`${p.s.name}, ${p.label}: ${p.v.toFixed(3)}`}>
            <circle cx={x(p.t)} cy={y(p.v)} r={k === i ? 5 : 3.4} fill={p.s.color}
              className={p.fresh ? styles.freshDot : undefined} stroke="var(--panel)" strokeWidth={1} />
          </a>
        ))}
        {cur && <line x1={x(cur.t)} x2={x(cur.t)} y1={T} y2={H - B} className={styles.cross} />}
      </svg>
      {cur && (
        <div className={styles.tip} style={{ left: `${(x(cur.t) / W) * 100}%`, top: `${(y(cur.v) / H) * 100}%` }} aria-hidden>
          <b className="num">{cur.v.toFixed(3)}</b> <span>{cur.s.name}</span>
          <small>{cur.label}{cur.detail ? ` · ${cur.detail}` : ""}</small>
        </div>
      )}
      <figcaption className={styles.legend}>
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} aria-hidden />{s.name}</span>
        ))}
      </figcaption>
      <p id={`${id}-live`} className={styles.sr} aria-live="polite">
        {cur ? `${cur.s.name}, ${cur.label}: ${cur.v.toFixed(3)}. ${cur.detail ?? ""}` : ""}
      </p>
    </figure>
  );
}
