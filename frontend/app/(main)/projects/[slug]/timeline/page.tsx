"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qlabApiPath } from "../../../../../lib/api";
import { useDetail, withDetail } from "../../../../../lib/dial";
import { setCommandContext } from "../../../../../components/CommandPalette";
import { useAnswer } from "../../../../../components/RunAnswer";
import { DriftLine } from "../../../../../components/DriftAlarm";
import { ReproductionLine } from "../../../../../components/ReproduceRun";

/*
 * A project as time. The strip is every run of the project in order; dragging along it (or the
 * arrow keys on the slider) moves through them. The view below shows the run under the cursor:
 * its one-sentence answer, and what differs from the run before it, highlighted. The selected run
 * is in the address (?run=), so any moment of the history is a link.
 */

type TRun = {
  run_id: string; circuit_name: string | null; circuit_hash: string | null; backend: string | null; status: string;
  created_at: string | null; num_qubits: number | null; depth: number | null;
  measure: { kind: "ideal_share" | "top_share"; value: number } | null;
  // Same circuit, same backend as an earlier run in this list: did the result move beyond shot noise?
  drift?: { previous_run_id: string; tvd: number; p_value: number; drifted: boolean } | null;
  // Tagged as a reproduction of an earlier run (in this list when the state is known): did it agree?
  reproduction?: { reproduction_of: string; state: string; tvd?: number | null } | null;
};
type Timeline = { slug: string; name: string; total: number; shown: number; truncated: boolean; runs: TRun[] };

function readRunParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("run"); } catch { return null; }
}

function writeRunParam(id: string) {
  const u = new URL(window.location.href);
  u.searchParams.set("run", id);
  window.history.replaceState(window.history.state, "", u.pathname + "?" + u.searchParams.toString() + u.hash);
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The strip: one mark per run, height = its measure. Drawn at the measured width. */
function Strip({ runs, index, onPick }: { runs: TRun[]; index: number; onPick: (i: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const dragging = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 96, pad = 10;
  const n = runs.length;
  const x = (i: number) => pad + (n <= 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (n - 1));
  // The vertical scale runs from just below the lowest result to 100%, so small changes show.
  const vals = runs.flatMap((r) => (r.measure ? [r.measure.value] : []));
  const lo = vals.length ? Math.max(0, Math.floor((Math.min(...vals) - 0.02) * 20) / 20) : 0;
  const y = (v: number) => H - 14 - ((v - lo) / Math.max(0.01, 1 - lo)) * (H - 28);
  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const t = (clientX - r.left - pad) / Math.max(1, r.width - 2 * pad);
    onPick(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  // Points with a measure, joined only while the circuit stays the same.
  const segs: string[] = [];
  let cur = "";
  runs.forEach((r, i) => {
    if (!r.measure) {
      if (cur) segs.push(cur);
      cur = "";
      return;
    }
    const prev = runs[i - 1];
    const continues = !!cur && !!prev?.measure && prev.circuit_hash === r.circuit_hash && prev.measure.kind === r.measure.kind;
    if (!continues && cur) { segs.push(cur); cur = ""; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(r.measure.value).toFixed(1)} `;
  });
  if (cur) segs.push(cur);

  return (
    <div ref={box} style={{ position: "relative", touchAction: "none", cursor: "ew-resize", userSelect: "none" }}
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) pick(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}>
      <svg width={w} height={H} role="img" aria-label={`${n} runs in time order; the selected one is number ${index + 1}`} style={{ display: "block" }}>
        <line x1={pad} x2={w - pad} y1={y(lo)} y2={y(lo)} stroke="var(--line)" />
        <text x={w - pad} y={y(lo) - 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{Math.round(lo * 100)}%</text>
        <line x1={pad} x2={w - pad} y1={y(1)} y2={y(1)} stroke="var(--line)" strokeDasharray="2 4" />
        <text x={w - pad} y={y(1) - 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">100%</text>
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--c-runs)" strokeWidth={1.2} opacity={0.6} />)}
        {runs.map((r, i) => (
          r.measure
            ? <circle key={r.run_id} cx={x(i)} cy={y(r.measure.value)} r={i === index ? 4.5 : 2.4}
                fill={r.status === "failed" ? "var(--danger)" : i === index ? "var(--text)" : "var(--c-runs)"} />
            : <line key={r.run_id} x1={x(i)} x2={x(i)} y1={y(lo) - 5} y2={y(lo) + 2} stroke={r.status === "failed" ? "var(--danger)" : "var(--muted)"} />
        ))}
        {/* Drift: the result moved from the previous run of the same circuit on the same machine. */}
        {runs.map((r, i) => (r.drift?.drifted && r.measure ? (
          <g key={`d-${r.run_id}`}>
            <circle cx={x(i)} cy={y(r.measure.value)} r={7} fill="none" stroke="var(--warn)" strokeWidth={1.4} />
            <line x1={x(i)} x2={x(i)} y1={2} y2={8} stroke="var(--warn)" strokeWidth={2} />
            <title>{`Drift: TVD ${r.drift.tvd.toFixed(3)} from run ${r.drift.previous_run_id.slice(0, 8)} (p = ${r.drift.p_value.toPrecision(2)})`}</title>
          </g>
        ) : null))}
        {/* Reproductions: a square around the run, green when it agreed with its original, amber when it didn't. */}
        {runs.map((r, i) => (r.reproduction && r.measure && (r.reproduction.state === "reproduced" || r.reproduction.state === "not_reproduced") ? (
          <g key={`r-${r.run_id}`}>
            <rect x={x(i) - 6} y={y(r.measure.value) - 6} width={12} height={12} fill="none" strokeWidth={1.3}
              stroke={r.reproduction.state === "reproduced" ? "var(--ok)" : "var(--warn)"} />
            <title>{`${r.reproduction.state === "reproduced" ? "Reproduced" : "Didn't reproduce"} run ${r.reproduction.reproduction_of.slice(0, 8)}${r.reproduction.tvd != null ? ` (TVD ${r.reproduction.tvd.toFixed(3)})` : ""}`}</title>
          </g>
        ) : null))}
        <line x1={x(index)} x2={x(index)} y1={4} y2={H - 4} stroke="var(--accent)" strokeWidth={1} />
      </svg>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--muted)", padding: "2px 10px 0" }}>
        <span>{day(runs[0]?.created_at ?? null)}</span><span>{day(runs[n - 1]?.created_at ?? null)}</span>
      </div>
    </div>
  );
}

type Change = { label: string; before: string; after: string };

function changes(prev: TRun | undefined, cur: TRun): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  const f = (label: string, a: unknown, b: unknown) => {
    const sa = a == null ? "—" : String(a), sb = b == null ? "—" : String(b);
    if (sa !== sb) out.push({ label, before: sa, after: sb });
  };
  f("Circuit", prev.circuit_name, cur.circuit_name);
  if (prev.circuit_name === cur.circuit_name && prev.circuit_hash !== cur.circuit_hash) f("Circuit version (hash)", prev.circuit_hash?.slice(0, 12), cur.circuit_hash?.slice(0, 12));
  f("Backend", prev.backend, cur.backend);
  f("Qubits", prev.num_qubits, cur.num_qubits);
  f("Depth", prev.depth, cur.depth);
  f("Status", prev.status, cur.status);
  if (prev.measure && cur.measure && prev.measure.kind === cur.measure.kind && Math.abs(prev.measure.value - cur.measure.value) >= 0.0005) {
    f(cur.measure.kind === "ideal_share" ? "On expected outcomes" : "Top outcome share", pct(prev.measure.value), pct(cur.measure.value));
  }
  return out;
}

function Moment({ run, prev, slug }: { run: TRun; prev?: TRun; slug: string }) {
  const a = useAnswer(run.run_id);
  const [detail] = useDetail();
  const diff = changes(prev, run);
  return (
    <section className="frame" style={{ borderLeft: "3px solid var(--c-runs)" }} aria-live="polite">
      <div className="frame-head">
        <h2 className="inst-label">
          <Link href={withDetail(`/runs/${run.run_id}`, detail)} style={{ textDecoration: "underline" }}>{run.circuit_name || run.run_id.slice(0, 12)}</Link>
          {" · "}{run.backend ?? "no backend"} · {run.created_at ? run.created_at.replace("T", " ").slice(0, 16) + " UTC" : "—"}
        </h2>
        <span className="mono d-standard" style={{ fontSize: 11, color: "var(--muted)" }}>{run.run_id.slice(0, 12)}</span>
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 12 }}>
        <p className="summary-line" style={{ fontSize: 16 }}>
          {a.state === "loading" ? "Working out what this run shows…" : a.state === "error" ? "This run's answer couldn't be worked out." : a.data!.sentence}
        </p>
        {run.drift && <DriftLine runId={run.run_id} />}
        {run.reproduction && <ReproductionLine runId={run.run_id} />}
        {prev ? (
          diff.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Changed since the run before</th><th>Before</th><th>This run</th></tr></thead>
                <tbody>
                  {diff.map((c) => (
                    <tr key={c.label}>
                      <td>{c.label}</td>
                      <td className="mono" style={{ color: "var(--muted)" }}>{c.before}</td>
                      <td className="mono" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--text)" }}>{c.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Nothing recorded here changed since the run before ({prev.run_id.slice(0, 8)}).</p>
        ) : <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>The first run of the project.</p>}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          {prev && <Link href={withDetail(`/compare?a=${encodeURIComponent(prev.run_id)}&b=${encodeURIComponent(run.run_id)}`, detail)} style={{ textDecoration: "underline" }}>Compare in full with the run before</Link>}
          <Link href={withDetail(`/runs/${run.run_id}`, detail)} style={{ textDecoration: "underline" }}>Open this run</Link>
          <Link href={withDetail(`/runs?project=${encodeURIComponent(slug)}`, detail)} style={{ textDecoration: "underline" }}>All runs of the project as a list</Link>
        </div>
      </div>
    </section>
  );
}

export default function TimelinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [tl, setTl] = useState<{ slug: string; state: "ok" | "error" | "missing"; data?: Timeline } | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/projects/${encodeURIComponent(slug)}/timeline`), { cache: "no-store" })
      .then(async (r) => {
        if (!on) return;
        if (r.status === 404) return setTl({ slug, state: "missing" });
        if (!r.ok) return setTl({ slug, state: "error" });
        const d = (await r.json()) as Timeline;
        const want = readRunParam();
        const i = want ? d.runs.findIndex((x) => x.run_id === want) : -1;
        setIndex(i >= 0 ? i : d.runs.length - 1);
        setTl({ slug, state: "ok", data: d });
      })
      .catch(() => { if (on) setTl({ slug, state: "error" }); });
    return () => { on = false; };
  }, [slug]);

  const runs = useMemo(() => (tl?.state === "ok" && tl.data ? tl.data.runs : []), [tl]);
  const pick = useCallback((i: number) => {
    setIndex(i);
    const r = runs[i];
    if (r) writeRunParam(r.run_id);
  }, [runs]);

  // Back/forward move through the history the same way.
  useEffect(() => {
    const onPop = () => {
      const want = readRunParam();
      const i = want ? runs.findIndex((x) => x.run_id === want) : -1;
      if (i >= 0) setIndex(i);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [runs]);

  const cur = index !== null ? runs[index] : undefined;
  useEffect(() => {
    if (!cur) return;
    setCommandContext([
      { id: "here:run", kind: "here", title: `Open run ${cur.circuit_name || cur.run_id.slice(0, 8)}`, hint: "The selected run", href: `/runs/${cur.run_id}` },
      { id: "here:list", kind: "here", title: `List the runs of ${slug}`, hint: "As a table", href: `/runs?project=${encodeURIComponent(slug)}` },
    ]);
    return () => setCommandContext([]);
  }, [cur, slug]);

  if (!tl || tl.slug !== slug) return <main className="page"><p className="summary-line">Loading the project&apos;s history…</p></main>;
  if (tl.state === "missing") return <main className="page"><p className="summary-line">There is no project called “{slug}” among the runs you can see.</p></main>;
  if (tl.state === "error" || !tl.data) return <main className="page"><p className="summary-line">The project&apos;s history couldn&apos;t be loaded right now.</p></main>;
  const d = tl.data;
  if (!runs.length || index === null || !cur) {
    return <main className="page"><p className="summary-line">{d.name} has no runs yet. Runs appear here when a script records them with <span className="mono">project=&quot;{slug}&quot;</span>.</p></main>;
  }

  const measured = runs.filter((r) => r.measure);
  const drifted = runs.filter((r) => r.drift?.drifted).length;
  const reproAgreed = runs.filter((r) => r.reproduction?.state === "reproduced").length;
  const reproFailed = runs.filter((r) => r.reproduction?.state === "not_reproduced").length;
  const reproText = reproAgreed + reproFailed
    ? ` ${reproAgreed + reproFailed} ${reproAgreed + reproFailed === 1 ? "is a reproduction" : "are reproductions"} of an earlier run: ${reproAgreed} agreed${reproFailed ? `, ${reproFailed} didn't` : ""} (boxed).`
    : "";
  const circuits = new Set(runs.map((r) => r.circuit_hash ?? r.circuit_name)).size;
  const summary = `${d.name}: ${d.total} run${d.total === 1 ? "" : "s"} of ${circuits} circuit${circuits === 1 ? "" : "s"} from ${day(runs[0].created_at)} to ${day(runs[runs.length - 1].created_at)}`
    + `${d.truncated ? ` (the latest ${d.shown} are shown)` : ""}. ${measured.length === runs.length ? "Every run has a result." : `${measured.length} have a result to score.`} ${drifted ? ` ${drifted} moved beyond shot noise from the run before it of the same circuit on the same machine (ringed in amber).` : ""}${reproText} Drag along the strip to move through them.`;

  return (
    <main className="page">
      <p className="summary-line">{summary}</p>
      <section className="frame">
        <div className="frame-head">
          <h2 className="inst-label">Run {index + 1} of {runs.length}</h2>
          <span className="mono d-standard" style={{ fontSize: 11, color: "var(--muted)" }}>
            height = share of shots on the expected outcomes (or the top outcome when there is no ideal); lines join runs of the same circuit
          </span>
        </div>
        <div className="frame-body" style={{ display: "grid", gap: 8 }}>
          <Strip runs={runs} index={index} onPick={pick} />
          <label className="sr-only" htmlFor="tl-slider">Run in the project&apos;s history</label>
          <input id="tl-slider" type="range" min={0} max={runs.length - 1} step={1} value={index}
            onChange={(e) => pick(Number(e.target.value))} style={{ width: "100%" }}
            aria-valuetext={`${cur.circuit_name || cur.run_id}, ${cur.created_at ?? ""}`} />
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button className="button secondary" type="button" disabled={index === 0} onClick={() => pick(index - 1)}>← Earlier</button>
            <button className="button secondary" type="button" disabled={index === runs.length - 1} onClick={() => pick(index + 1)}>Later →</button>
          </div>
        </div>
      </section>
      <Moment run={cur} prev={runs[index - 1]} slug={slug} />
    </main>
  );
}
