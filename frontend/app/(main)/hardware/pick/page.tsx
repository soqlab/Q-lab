"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { qlabApiPath } from "../../../../lib/api";
import { useDetail, withDetail, type Detail } from "../../../../lib/dial";
import { setCommandContext } from "../../../../components/CommandPalette";
import styles from "../../../../components/board/board.module.css";
import { Head } from "../../../../components/board/parts";

/*
 * Pick the machine before you run. Paste or drop an OpenQASM circuit (or take one of your runs')
 * and the answer comes back as a sentence: where to run it and what will hurt it most, estimated
 * from the calibration the hardware board reads (backend/app/machine_pick.py). Editing the circuit
 * re-estimates after a pause, so the ranking follows the circuit as you change it. The chosen run is
 * in the address (?run=), so "where should I run this next?" is a link.
 */

type Weak = { kind: string; text: string; detail: string; qubits: number[]; share_of_loss: number | null };
type Row = {
  backend: string; num_qubits: number; esp: number | null; method: "transpiled" | "analytic" | null; reason?: string;
  calibrated_at: string | null; read_at: string | null; simulated: boolean; pending_jobs: number | null;
  factors?: { two_qubit: number; one_qubit: number; readout: number; idle: number };
  dominant?: { source: string; label: string; share_of_loss: number } | null;
  weak_point?: Weak | null;
  transpiled?: { depth: number; two_qubit_gates: number; operations: number; duration_us: number; physical_qubits: number[] } | null;
  missing_errors?: string[];
};
type Pick = {
  available: boolean; level: Detail; sentence: string; basis: string | null; todo?: string; simulated: boolean;
  ranked: Row[]; unavailable: Row[]; problems: string[];
  circuit?: { num_qubits: number; operations: number; two_qubit_gates: number; measured: number; depth: number };
  from_run?: { run_id: string; circuit_name: string | null; backend: string | null; source: string } | null;
  limits?: { qubits: number; operations: number; two_qubit_gates: number; seconds: number };
};
type RunRef = { run_id: string; circuit_name: string | null; backend: string | null; created_at: string; qasm: string | null };
type State =
  | { s: "idle" } | { s: "working"; prev?: Pick } | { s: "ok"; d: Pick }
  | { s: "error"; msg: string; signin?: boolean; prev?: Pick };

const EXAMPLE = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;\n';
const EDIT_PAUSE_MS = 1800;

const fx = (x: number) => (x < 0.005 ? "<0.01" : x.toFixed(2));
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const stamp = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "—");

function readRun(): string | null {
  try { return new URLSearchParams(window.location.search).get("run"); } catch { return null; }
}
function writeRun(id: string | null) {
  const u = new URL(window.location.href);
  if (id) u.searchParams.set("run", id); else u.searchParams.delete("run");
  window.history.replaceState(window.history.state, "", u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash);
}

/** One row per machine: the estimate as a number and a bar of the same length, then what costs most. */
function Ranking({ d, detail }: { d: Pick; detail: Detail }) {
  const best = d.ranked[0]?.esp ?? 1;
  return (
    <div className="table-wrap">
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Machine</th><th className="r">Expected</th><th aria-hidden="true" style={{ width: "22%" }} />
            <th>Weak point</th><th className={`r ${styles.hideNarrow}`}>2-qubit gates</th>
            <th className={`r ${styles.hideNarrow}`}>Duration</th><th className={`r ${styles.hideNarrow}`}>Queue</th>
            <th className={styles.hideNarrow}>Calibrated</th>
          </tr>
        </thead>
        <tbody>
          {d.ranked.map((r, i) => (
            <tr key={r.backend} className={i === 0 ? styles.selected : undefined}>
              <td><Link href={withDetail(`/hardware/${encodeURIComponent(r.backend)}`, detail)} className="mono">{r.backend}</Link></td>
              <td className="r num mono">{"≈"}{fx(r.esp!)}</td>
              <td aria-hidden="true">
                <span style={{ display: "block", height: 6, background: i === 0 ? "var(--c-board)" : "var(--muted)", opacity: i === 0 ? 1 : 0.55,
                  width: `${Math.max(2, Math.round(((r.esp ?? 0) / Math.max(best, 1e-9)) * 100))}%` }} />
              </td>
              <td style={{ whiteSpace: "normal" }}>
                {r.weak_point ? <>{r.weak_point.text}<span className={`d-expert ${styles.muted} ${styles.small}`}> ({r.weak_point.detail})</span></> : <span className={styles.muted}>—</span>}
                {r.dominant && <div className={`${styles.muted} ${styles.small} d-standard`}>mostly {r.dominant.label} ({pct(r.dominant.share_of_loss)} of the loss)</div>}
                {r.factors && (
                  <div className={`${styles.muted} ${styles.small} mono d-expert`}>
                    2q {r.factors.two_qubit.toFixed(3)} · 1q {r.factors.one_qubit.toFixed(3)} · readout {r.factors.readout.toFixed(3)} · idle {r.factors.idle.toFixed(3)}
                    {r.transpiled ? ` · qubits ${r.transpiled.physical_qubits.join(",")}` : ""}
                  </div>
                )}
              </td>
              <td className={`r num ${styles.hideNarrow}`}>{r.transpiled?.two_qubit_gates ?? "—"}</td>
              <td className={`r num ${styles.hideNarrow}`}>{r.transpiled ? `${r.transpiled.duration_us.toFixed(2)} µs` : "—"}</td>
              <td className={`r num ${styles.hideNarrow}`}>{r.pending_jobs ?? "—"}</td>
              <td className={`${styles.hideNarrow} num`}>{stamp(r.calibrated_at ?? r.read_at)}</td>
            </tr>
          ))}
          {d.unavailable.map((r) => (
            <tr key={r.backend}>
              <td className="mono">{r.backend}</td>
              <td className="r num">—</td><td />
              <td colSpan={5} className={styles.muted} style={{ whiteSpace: "normal" }}>Not estimated: {r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PickMachinePage() {
  const [detail] = useDetail();
  const [text, setText] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRef[] | null>(null);
  const [st, setSt] = useState<State>({ s: "idle" });
  const seq = useRef(0);
  const editTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const ask = useCallback(async (body: { qasm?: string; run_id?: string }) => {
    const my = ++seq.current;
    setSt((p) => ({ s: "working", prev: p.s === "ok" ? p.d : p.s === "working" || p.s === "error" ? p.prev : undefined }));
    try {
      const r = await fetch(qlabApiPath("/api/v1/machine-pick"), {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, level: detail }),
      });
      if (my !== seq.current) return;
      if (r.ok) { setSt({ s: "ok", d: (await r.json()) as Pick }); return; }
      const err = (await r.json().catch(() => ({}))) as { detail?: unknown };
      const msg = typeof err.detail === "string" ? err.detail : `The server answered ${r.status}.`;
      setSt((p) => ({
        s: "error", signin: r.status === 401,
        msg: r.status === 401 ? "Sign in to estimate: it compiles your circuit for every machine, so it is limited to accounts."
          : r.status === 429 ? "That's a lot of estimates in a minute; this one will go through if you try again shortly." : msg,
        prev: p.s === "ok" ? p.d : p.s === "working" ? p.prev : undefined,
      }));
    } catch {
      if (my === seq.current) setSt({ s: "error", msg: "The server couldn't be reached." });
    }
  }, [detail]);

  // A run named in the address is estimated at once.
  useEffect(() => {
    const id = readRun();
    let on = true;
    // After the first render (the address is only readable in the browser).
    void Promise.resolve().then(() => { if (on && id) { setRunId(id); void ask({ run_id: id }); } });
    fetch(qlabApiPath("/api/v1/runs?limit=40"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rs: RunRef[]) => setRuns(rs.filter((x) => x.qasm)))
      .catch(() => setRuns([]));
    return () => { on = false; };
    // ask changes with the dial; the run in the address is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The dial re-asks for the same input: the wording is the server's.
  const lastDetail = useRef(detail);
  useEffect(() => {
    if (lastDetail.current === detail) return;
    lastDetail.current = detail;
    const again: { run_id?: string; qasm?: string } | null = runId ? { run_id: runId } : text.trim() ? { qasm: text } : null;
    if (again) void Promise.resolve().then(() => ask(again));
  }, [detail, ask, runId, text]);

  useEffect(() => {
    setCommandContext([
      { id: "here:example", kind: "here", title: "Estimate an example circuit (GHZ, 3 qubits)", hint: "Fills the circuit box", run: () => { setRunId(null); writeRun(null); setText(EXAMPLE); void ask({ qasm: EXAMPLE }); } },
      { id: "here:board", kind: "here", title: "The hardware board", hint: "Live status and benchmark history", href: "/hardware" },
    ]);
    return () => setCommandContext([]);
  }, [ask]);

  const onEdit = (v: string) => {
    setText(v);
    if (runId) { setRunId(null); writeRun(null); }
    if (editTimer.current) window.clearTimeout(editTimer.current);
    if (v.trim()) editTimer.current = window.setTimeout(() => void ask({ qasm: v }), EDIT_PAUSE_MS);
  };
  const now = (v: string) => {
    if (editTimer.current) window.clearTimeout(editTimer.current);
    setRunId(null); writeRun(null); setText(v);
    if (v.trim()) void ask({ qasm: v });
  };
  const pickRun = (id: string) => {
    if (editTimer.current) window.clearTimeout(editTimer.current);
    if (!id) return;
    setRunId(id); writeRun(id);
    const r = runs?.find((x) => x.run_id === id);
    setText(r?.qasm ?? "");
    void ask({ run_id: id });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 64_000) { setSt({ s: "error", msg: "That file is over 64 kB; the estimate takes smaller circuits." }); return; }
    now(await f.text());
  };

  const shown = st.s === "ok" ? st.d : st.s === "working" || st.s === "error" ? st.prev : undefined;
  const summary =
    st.s === "idle" ? "Paste a circuit, drop a .qasm file or pick one of your runs, and this says which machine to run it on and what will hurt it most."
      : st.s === "working" && !shown ? "Compiling the circuit for every machine…"
        : st.s === "error" && !shown ? st.msg
          : shown!.sentence;

  return (
    <main className={styles.page}>
      <Head title="Pick the machine" sub="before you run" summary={summary} simulated={!!shown?.simulated} />
      {shown?.basis && <p className={`${styles.small} ${styles.muted} mono`} style={{ margin: 0 }} role="note">{shown.basis}</p>}
      {st.s === "working" && shown && <p className={`${styles.small} ${styles.muted}`} style={{ margin: 0 }} aria-live="polite">Re-estimating for the changed circuit…</p>}
      {st.s === "error" && shown && <div className="alert alert-warn" role="status">{st.msg}</div>}
      {st.s === "error" && st.signin && <p style={{ margin: 0 }}><Link href="/login?next=/hardware/pick" style={{ textDecoration: "underline" }}>Sign in</Link></p>}

      {shown && !shown.available && (
        <section className="frame">
          <div className="frame-head"><h2>No calibration to estimate from</h2><span className="inst-label">Not connected</span></div>
          <div className="empty-state"><p style={{ margin: 0 }}>{shown.todo}</p></div>
        </section>
      )}

      {shown?.available && (shown.ranked.length > 0 || shown.unavailable.length > 0) && (
        <section className="frame" aria-busy={st.s === "working"}>
          <div className="frame-head">
            <h2>{shown.ranked.length} machine{shown.ranked.length === 1 ? "" : "s"}, best first</h2>
            <span className="inst-label">estimated success probability</span>
          </div>
          <Ranking d={shown} detail={detail} />
          {shown.problems.length > 0 && <p className={`${styles.small} ${styles.muted}`} style={{ margin: 0, padding: "8px 14px" }}>Left out: {shown.problems.join("; ")}.</p>}
        </section>
      )}

      <section className="frame">
        <div className="frame-head">
          <h2>The circuit</h2>
          <span className="inst-label">
            {shown?.circuit ? `${shown.circuit.num_qubits} qubits · ${shown.circuit.two_qubit_gates} two-qubit gates · depth ${shown.circuit.depth}` : "OpenQASM 2 or 3"}
          </span>
        </div>
        <div className="frame-body" style={{ display: "grid", gap: 10 }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}>
          {shown?.from_run && (
            <p className={styles.small} style={{ margin: 0 }}>
              From run <Link href={withDetail(`/runs/${encodeURIComponent(shown.from_run.run_id)}`, detail)} className="mono">{shown.from_run.circuit_name || shown.from_run.run_id.slice(0, 12)}</Link>
              {shown.from_run.backend ? ` (ran on ${shown.from_run.backend})` : ""}: {shown.from_run.source}.
            </p>
          )}
          <label className="sr-only" htmlFor="pick-qasm">OpenQASM circuit</label>
          <textarea id="pick-qasm" className="input mono" spellCheck={false} rows={10} value={text} placeholder={EXAMPLE}
            onChange={(e) => onEdit(e.target.value)}
            onPaste={(e) => { const v = e.clipboardData.getData("text"); if (v && !text.trim()) { e.preventDefault(); now(v); } }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); now(text); } }}
            style={{ width: "100%", height: "auto", minHeight: 180, fontSize: 12.5, lineHeight: 1.5, resize: "vertical", padding: 10 }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="button" type="button" disabled={!text.trim() || st.s === "working"} onClick={() => now(text)}>Estimate now</button>
            <button className="button secondary" type="button" onClick={() => fileInput.current?.click()}>Open a .qasm file</button>
            <input ref={fileInput} type="file" accept=".qasm,.qasm3,.txt,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            {runs && runs.length > 0 && (
              <>
                <label className="inst-label" htmlFor="pick-run">or one of your runs</label>
                <select id="pick-run" className="input" value={runId ?? ""} onChange={(e) => pickRun(e.target.value)} style={{ maxWidth: 320 }}>
                  <option value="">Choose a run…</option>
                  {runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>{(r.circuit_name || r.run_id.slice(0, 12))} · {r.backend ?? "no backend"} · {r.created_at.slice(0, 10)}</option>
                  ))}
                </select>
              </>
            )}
            <span className={`${styles.small} ${styles.muted} d-standard`}>Ctrl+Enter estimates; edits re-estimate after a pause.</span>
          </div>
          <p className={`${styles.small} ${styles.muted} d-expert`} style={{ margin: 0 }}>
            Model: compiled with Qiskit&apos;s preset pass manager (optimization level 1, seed 7) against each machine&apos;s calibrated target, then
            ESP = ∏(1 − gate error) × ∏(1 − readout error) × ∏ exp(−idle time / min(T2, 2·T1)), idle time from an as-soon-as-possible
            schedule of the calibrated durations. Crosstalk, leakage, coherent errors and drift since the calibration are not modelled.
            {shown?.limits ? ` Limits: ${shown.limits.qubits} qubits, ${shown.limits.operations} operations, ${shown.limits.two_qubit_gates} two-qubit gates, ${shown.limits.seconds} s per request.` : ""}
          </p>
        </div>
      </section>
    </main>
  );
}
