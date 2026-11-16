"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setCommandContext } from "../../../components/CommandPalette";
import board from "../../../components/board/board.module.css";
import { qlabApiPath } from "../../../lib/api";
import { useDetail, withDetail } from "../../../lib/dial";
import { EXAMPLES } from "../../../lib/sim/examples";
import { batchSize } from "../../../lib/sim/gpu";
import { rewindLink, storeHandoff } from "../../../lib/sim/handoff";
import { type EngineChoice, type Probe, type RunResult, SimClient } from "../../../lib/sim/protocol";
import { type Circuit, parseQasm, QasmError } from "../../../lib/sim/qasm";
import { bits, SHOT_LIMIT } from "../../../lib/sim/statevector";
import s from "./try.module.css";

/*
 * Try it in your browser: an exact state-vector simulator that runs on this device. WebGPU compute
 * shaders when the browser has them (up to 24 qubits), JavaScript in a background thread otherwise
 * (up to 20). Nothing is sent to the server to compute; the only request is a read of how many
 * machines Rewind has, for the "machine replica" link. Engine code: lib/sim/.
 */

type RunState =
  | { s: "idle" }
  | { s: "working"; done: number; total: number }
  | { s: "ok"; r: RunResult; c: Circuit; wallMs: number }
  | { s: "error"; msg: string };

const REWIND_MAX_QUBITS = 20;

const ms = (x: number) => (x < 1 ? `${x.toFixed(2)} ms` : x < 100 ? `${x.toFixed(1)} ms` : x < 10_000 ? `${Math.round(x)} ms` : `${(x / 1000).toFixed(1)} s`);
const pctOf = (x: number) => (x === 0 ? "0%" : x < 0.0001 ? "<0.01%" : `${(x * 100).toFixed(x >= 0.995 || x < 0.1 ? 2 : 1)}%`);
const prob = (x: number) => (x >= 0.001 ? x.toFixed(6) : x.toExponential(3));

function newSeed() {
  try { return crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000_000; } catch { return Math.floor(Math.random() * 1e9); }
}

function parse(text: string): { ok: true; c: Circuit } | { ok: false; msg: string; line: number } {
  try { return { ok: true, c: parseQasm(text) }; } catch (e) {
    return e instanceof QasmError ? { ok: false, msg: e.message, line: e.line } : { ok: false, msg: (e as Error).message, line: 0 };
  }
}

/** The outcomes table: most likely first; the bar is the sampled share, the dotted tick the exact probability. */
function Outcomes({ r, width, rows }: { r: RunResult; width: number; rows: number }) {
  const shots = new Map(r.counts);
  const shown = r.top.slice(0, rows);
  const shownKeys = new Set(shown.map(([i]) => i));
  const otherShots = r.counts.reduce((n, [i, k]) => (shownKeys.has(i) ? n : n + k), 0);
  const otherP = Math.max(0, 1 - shown.reduce((a, [, p]) => a + p, 0));
  const otherN = r.possible - shown.length;
  const max = Math.max(...shown.map(([i, p]) => Math.max(p, (shots.get(i) ?? 0) / r.shots)), otherN > 0 ? Math.max(otherP, otherShots / r.shots) : 0, 1e-12);
  return (
    <table className={s.bars}>
      <caption className={s.sr}>Outcomes, most likely first: exact probability, sampled shots and their share</caption>
      <thead>
        <tr>
          <th scope="col">Outcome</th><th scope="col" className={s.r}>Exact</th><th scope="col" className={s.r}>Shots</th>
          <th scope="col" className={`${s.r} d-standard`}>Share</th>
          <th scope="col" className={s.barCol}><span className={s.sr}>Bar</span><span className={s.legendTick} aria-hidden="true">▬ shots ┆ exact</span></th>
        </tr>
      </thead>
      <tbody>
        {shown.map(([i, p]) => {
          const n = shots.get(i) ?? 0;
          const key = bits(i, width);
          return (
            <tr key={i} title={`${key}: exact ${prob(p)}; ${n} of ${r.shots} shots (${pctOf(n / r.shots)})`}>
              <th scope="row" className="mono">{key}</th>
              <td className={`${s.r} num`}>{prob(p)}</td>
              <td className={`${s.r} num`}>{n.toLocaleString("en-US")}</td>
              <td className={`${s.r} num d-standard`}>{pctOf(n / r.shots)}</td>
              <td className={s.barCol} aria-hidden="true">
                <span className={s.track}>
                  <span className={s.bar} style={{ width: `${n ? Math.max(0.6, (n / r.shots / max) * 100) : 0}%` }} />
                  <span className={s.exactTick} style={{ left: `${(p / max) * 100}%` }} />
                </span>
              </td>
            </tr>
          );
        })}
        {otherN > 0 && (
          <tr>
            <th scope="row" className={s.otherLabel}>other ({otherN.toLocaleString("en-US")} outcome{otherN === 1 ? "" : "s"})</th>
            <td className={`${s.r} num`}>{prob(otherP)}</td>
            <td className={`${s.r} num`}>{otherShots.toLocaleString("en-US")}</td>
            <td className={`${s.r} num d-standard`}>{pctOf(otherShots / r.shots)}</td>
            <td className={s.barCol} aria-hidden="true">
              <span className={s.track}><span className={s.barOther} style={{ width: `${otherShots ? Math.max(0.6, (otherShots / r.shots / max) * 100) : 0}%` }} /></span>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function EngineCard({ probe, choice }: { probe: Probe | null; choice: EngineChoice }) {
  const g = probe?.gpu;
  return (
    <dl className={s.engines} aria-live="polite">
      <div className={s.engine}>
        <dt><span className={`dot ${!probe ? "" : g?.ok ? "ok" : "bad"}`} aria-hidden="true" />GPU · WebGPU</dt>
        <dd>
          {!probe ? "Looking for a GPU…"
            : g?.ok ? <><strong>{g.name}</strong>, up to {g.maxQubits} qubits, float32{g.fallbackAdapter ? " (a software adapter: slower than a real GPU)" : ""}.{choice !== "cpu" ? " Runs your circuits." : ""}</>
              : <>Not available: {g?.reason}</>}
        </dd>
      </div>
      <div className={s.engine}>
        <dt><span className="dot ok" aria-hidden="true" />CPU · JavaScript</dt>
        <dd>
          In a background thread, up to {probe?.cpuMaxQubits ?? 20} qubits, float64.
          {probe && (choice === "cpu" || !g?.ok) ? " Runs your circuits." : " Used when you pick it."}
        </dd>
      </div>
    </dl>
  );
}

export default function TryPage() {
  const [detail] = useDetail();
  const client = useRef<SimClient | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [choice, setChoice] = useState<EngineChoice>("auto");
  const [text, setText] = useState(EXAMPLES[0].qasm);
  const [example, setExample] = useState<string | null>(EXAMPLES[0].id);
  const [shots, setShots] = useState(1024);
  const [seed, setSeed] = useState("");
  const [run, setRun] = useState<RunState>({ s: "idle" });
  const [rows, setRows] = useState(16);
  const [dragging, setDragging] = useState(false);
  const [rewindMachines, setRewindMachines] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = new SimClient();
    client.current = c;
    void c.probe().then(setProbe);
    // Only to say whether Rewind has calibrations to replay on; the simulation itself never calls the server.
    let on = true;
    fetch(qlabApiPath("/api/v1/rewind/machines"), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { machines?: unknown[] } | null) => { if (on && d && Array.isArray(d.machines)) setRewindMachines(d.machines.length); })
      .catch(() => {});
    return () => { on = false; c.dispose(); client.current = null; };
  }, []);

  const parsed = useMemo(() => parse(text), [text]);
  const gpuOk = !!probe?.gpu.ok;
  const gpuMax = probe?.gpu.ok ? probe.gpu.maxQubits : 0;
  const cpuMax = probe?.cpuMaxQubits ?? 20;
  const willUse: "gpu" | "cpu" = choice === "cpu" || !gpuOk ? "cpu" : "gpu";
  const capacity = willUse === "gpu" ? gpuMax : cpuMax;
  const tooBig = parsed.ok && parsed.c.nQubits > capacity;
  const handoff = useMemo(() => (parsed.ok ? rewindLink(text) : null), [parsed, text]);

  const go = useCallback(async () => {
    const c = client.current;
    if (!c || !parsed.ok || run.s === "working") return;
    if (parsed.c.nQubits > capacity) return;
    const sd = seed.trim() ? Number(seed) : newSeed();
    setRun({ s: "working", done: 0, total: parsed.c.ops.length });
    const t0 = performance.now();
    try {
      const r = await c.run(parsed.c, choice, shots, sd, (done, total) => setRun({ s: "working", done, total }));
      setRun({ s: "ok", r, c: parsed.c, wallMs: performance.now() - t0 });
      setRows(16);
    } catch (e) {
      setRun({ s: "error", msg: (e as Error).message });
      // The worker may have been the problem: ask again what it can do.
      void c.probe().then(setProbe);
    }
  }, [parsed, run.s, capacity, seed, choice, shots]);

  const stop = () => { client.current?.cancel(); setRun({ s: "error", msg: "Stopped. Nothing was kept." }); void client.current?.probe().then(setProbe); };

  const pickExample = useCallback((id: string) => {
    const e = EXAMPLES.find((x) => x.id === id)!;
    setText(e.qasm); setExample(id);
  }, []);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200_000) { setRun({ s: "error", msg: "That file is over 200 kB; this page takes smaller circuits." }); return; }
    setText(await f.text()); setExample(null);
  };

  useEffect(() => {
    setCommandContext([
      { id: "here:try-run", kind: "here", title: "Run this circuit in the browser", hint: "Ctrl+Enter in the circuit box", run: () => void go() },
      ...EXAMPLES.map((e) => ({ id: `here:try-${e.id}`, kind: "here" as const, title: `Try an example: ${e.name}`, hint: e.what, run: () => pickExample(e.id) })),
      { id: "here:rewind", kind: "here", title: "Rewind: replay a circuit on a past calibration", hint: "Noise of a real machine, simulated", href: "/rewind" },
    ]);
    return () => setCommandContext([]);
  }, [go, pickExample]);

  const engineName = (r: RunResult) => (r.engine === "gpu" ? "WebGPU" : "the CPU (JavaScript)");
  const summary = run.s === "ok"
    ? `Ran on ${engineName(run.r)}: ${run.c.nQubits} qubit${run.c.nQubits === 1 ? "" : "s"}, ${run.c.ops.length.toLocaleString("en-US")} gate${run.c.ops.length === 1 ? "" : "s"} in ${ms(run.r.gateMs)}; ${run.r.shots.toLocaleString("en-US")} shots sampled from the exact probabilities. Top outcome ${bits(run.r.top[0]?.[0] ?? 0, run.c.nClbits)} at ${pctOf(run.r.top[0]?.[1] ?? 0)}.`
    : run.s === "working" ? `Running on ${willUse === "gpu" ? "WebGPU" : "the CPU"}… ${run.total ? `${run.done.toLocaleString("en-US")} of ${run.total.toLocaleString("en-US")} gates` : ""}`
      : run.s === "error" ? run.msg
        : "Write or pick a circuit and run it here, on this device: an exact state-vector simulation, nothing installed, no account, no server doing the work.";

  const ok = run.s === "ok" ? run : null;
  const drift = ok ? Math.abs(1 - ok.r.norm) : 0;

  return (
    <main className={board.page}>
      <header className={board.head}>
        <span className={`inst-label ${s.channel}`}><i aria-hidden />Try</span>
        <h1 className={board.title}>Try a circuit<small>in your browser, on your GPU</small></h1>
        <p className="summary-line" aria-live="polite">{summary}</p>
      </header>

      <section className="frame" aria-labelledby="try-engines">
        <div className="frame-head">
          <h2 id="try-engines">Engines on this device</h2>
          <div className={s.field} role="group" aria-label="Engine">
            <span className="inst-label">Use</span>
            <div className={s.seg}>
              {(["auto", "gpu", "cpu"] as EngineChoice[]).map((e) => (
                <button key={e} type="button" aria-pressed={choice === e} disabled={e === "gpu" && !gpuOk} onClick={() => setChoice(e)}>
                  {e === "auto" ? "Best available" : e === "gpu" ? "GPU" : "CPU"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="frame-body"><EngineCard probe={probe} choice={choice} /></div>
      </section>

      <section className="frame" aria-labelledby="try-circuit">
        <div className="frame-head"><h2 id="try-circuit">The circuit</h2><span className="inst-label">OpenQASM 2 or 3</span></div>
        <div className={`frame-body ${dragging ? s.drop : ""}`} style={{ display: "grid", gap: 10 }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void onFile(e.dataTransfer.files?.[0]); }}>
          <div className={s.examples} role="group" aria-label="Example circuits">
            <span className="inst-label">Examples</span>
            {EXAMPLES.map((e) => {
              const off = !!e.needsGpu && probe !== null && !gpuOk;
              return (
                <button key={e.id} type="button" className={s.chip} aria-pressed={example === e.id} disabled={off}
                  title={off ? `${e.what} This browser has no WebGPU.` : e.what} onClick={() => pickExample(e.id)}>{e.name}</button>
              );
            })}
          </div>
          <label className="sr-only" htmlFor="try-qasm">Circuit in OpenQASM</label>
          <textarea id="try-qasm" className={`input mono ${s.textarea}`} spellCheck={false} rows={12} value={text}
            aria-describedby="try-parse" aria-invalid={!parsed.ok || undefined}
            onChange={(e) => { setText(e.target.value); setExample(null); }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void go(); } }} />
          <p id="try-parse" className={s.parse} data-bad={!parsed.ok || tooBig} aria-live="polite">
            {!parsed.ok ? parsed.msg
              : tooBig ? `${parsed.c.nQubits} qubits is more than the ${willUse === "gpu" ? "GPU" : "CPU"} engine here takes (${capacity}).${willUse === "cpu" && !gpuOk ? " This browser has no WebGPU, which goes to 24." : ""}`
                : `${parsed.c.nQubits} qubit${parsed.c.nQubits === 1 ? "" : "s"} · ${parsed.c.ops.length.toLocaleString("en-US")} gate${parsed.c.ops.length === 1 ? "" : "s"} (${parsed.c.twoQubitGates} on two or more qubits) · reads ${parsed.c.nClbits} bit${parsed.c.nClbits === 1 ? "" : "s"}${parsed.c.implicitMeasure ? " (no measure: every qubit is read)" : ""}`}
          </p>
          <div className={s.row}>
            {run.s === "working"
              ? <button className="button" type="button" onClick={stop}>Stop</button>
              : <button className="button" type="button" disabled={!parsed.ok || tooBig || !probe} onClick={() => void go()} aria-keyshortcuts="Control+Enter">Run in this browser</button>}
            <span className={s.field}>
              <label className="inst-label" htmlFor="try-shots">Shots</label>
              <input id="try-shots" className="input num" type="number" min={1} max={SHOT_LIMIT} value={shots} style={{ width: 110 }}
                onChange={(e) => setShots(Math.max(1, Math.min(SHOT_LIMIT, Math.round(Number(e.target.value) || 1))))} />
            </span>
            <span className={`${s.field} d-expert`}>
              <label className="inst-label" htmlFor="try-seed">Seed</label>
              <input id="try-seed" className="input num" inputMode="numeric" placeholder="random" value={seed} style={{ width: 110 }}
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} />
            </span>
            <button className="button secondary" type="button" onClick={() => fileInput.current?.click()}>Open a .qasm file</button>
            <input ref={fileInput} type="file" accept=".qasm,.qasm3,.txt,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          {run.s === "working" && (
            <div className={s.progress} role="progressbar" aria-label="Gates applied" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done}>
              <span style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }} />
            </div>
          )}
          <p className={`${s.note} d-standard`}>
            Gates: the standard ones of qelib1.inc / stdgates.inc (h, x, y, z, s, t, sx, rx, ry, rz, p, u, cx, cz, cp, crz, swap, ccx, cswap and more), barrier and measure.
            Measurements go at the end; gate definitions, if, reset and loops are refused. Up to 20,000 gates. Ctrl+Enter runs; you can drop a file on this box.
          </p>
        </div>
      </section>

      {run.s === "error" && <div className="alert alert-warn" role="alert">{run.msg}</div>}

      {ok && (
        <section className="frame" aria-labelledby="try-result">
          <div className="frame-head">
            <h2 id="try-result">{ok.r.shots.toLocaleString("en-US")} shots, {ok.r.possible.toLocaleString("en-US")} possible outcome{ok.r.possible === 1 ? "" : "s"}</h2>
            <span className="inst-label">{ok.r.engine === "gpu" ? "WebGPU" : "CPU"} · exact simulation · no noise</span>
          </div>
          <div className="frame-body" style={{ display: "grid", gap: 12 }}>
            <div className="table-wrap"><Outcomes r={ok.r} width={ok.c.nClbits} rows={rows} /></div>
            {ok.r.top.length > 16 && (
              <button type="button" className={s.more} onClick={() => setRows(rows > 16 ? 16 : ok.r.top.length)}>
                {rows > 16 ? "Show the top 16" : `Show the top ${ok.r.top.length}`}
              </button>
            )}
            {ok.r.notes.map((n) => <p key={n} className="alert alert-warn" style={{ margin: 0 }}>{n}</p>)}
            {ok.c.implicitMeasure && <p className={s.note}>The circuit has no measure, so every qubit is read, qubit 0 on the right.</p>}
            {ok.c.measure.some((q) => q < 0) && <p className={s.note}>Some classical bits are never measured; they read 0.</p>}
            <dl className={s.facts}>
              <dt>Engine</dt>
              <dd>{ok.r.engine === "gpu" ? "WebGPU compute shaders" : "JavaScript in a background thread"} on <b>{ok.r.device}</b></dd>
              <dt>Time</dt>
              <dd className="num">
                gates {ms(ok.r.gateMs)}
                <span className="d-standard"> · {ok.r.engine === "gpu" ? "read back" : "probabilities"} {ms(ok.r.readMs)} · sampling {ms(ok.r.sampleMs)} · total {ms(ok.wallMs)}</span>
              </dd>
              <dt>Precision</dt>
              <dd>
                {ok.r.precision}; the probabilities add up to 1 within <span className="num">{drift < 1e-15 ? "1e-15" : drift.toExponential(1)}</span>
                <span className="d-standard">{ok.r.precision === "float32" ? " (GPU arithmetic is float32: expect differences of about 1e-7 from an exact float64 run)" : ""}</span>
              </dd>
              <dt className="d-standard">Circuit</dt>
              <dd className="d-standard">{ok.c.nQubits} qubits, {ok.c.ops.length.toLocaleString("en-US")} gates ({Object.entries(ok.c.gateCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")})</dd>
              <dt className="d-expert">Seed</dt>
              <dd className="d-expert num">{ok.r.seed} <span className={s.note}>(type it in the seed box to draw the same shots again)</span></dd>
              <dt className="d-expert">Dispatches</dt>
              <dd className="d-expert">{ok.r.engine === "gpu" ? `${ok.c.ops.length + 1} compute dispatches, ${batchSize(ok.c.nQubits)} gates per submit` : "none: CPU"}</dd>
            </dl>
          </div>
        </section>
      )}

      <section className="frame" aria-labelledby="try-replica">
        <div className="frame-head"><h2 id="try-replica">Run this on a real machine replica</h2><span className="inst-label">Rewind · simulated noise</span></div>
        <div className={`frame-body ${s.replica}`}>
          <p className={s.note} style={{ color: "var(--text)" }}>
            This page is noiseless. Rewind runs the same circuit on a simulator with the noise of an IBM machine as it was calibrated on a past date you pick,
            on this Q-Lab&apos;s server, with Rewind&apos;s own limits ({REWIND_MAX_QUBITS} qubits after compiling, 4,096 shots without an account).
          </p>
          {rewindMachines === 0 && (
            <p className={s.note}>This server has no IBM calibrations stored at the moment, so Rewind will open with an empty page that says so.</p>
          )}
          <div className={s.row}>
            {handoff && parsed.ok && parsed.c.nQubits <= REWIND_MAX_QUBITS ? (
              <Link className="button secondary" href={withDetail(handoff.href, detail)} onClick={() => { if (handoff.viaSession) storeHandoff(text); }}>
                Open this circuit in Rewind
              </Link>
            ) : (
              <button className="button secondary" type="button" disabled>Open this circuit in Rewind</button>
            )}
            <span className={s.note}>
              {!parsed.ok ? "Fix the circuit first." : parsed.c.nQubits > REWIND_MAX_QUBITS ? `Rewind takes up to ${REWIND_MAX_QUBITS} qubits.` : "The circuit goes in the address, nothing is saved."}
            </span>
          </div>
          <p className={s.label} role="note">No real quantum computer runs your circuit, from this page or from Rewind. Q-Lab is not affiliated with IBM.</p>
        </div>
      </section>

      <p className={`${s.note} d-standard`}>
        How it works: the state vector (2<sup>n</sup> complex amplitudes) stays on this device. On WebGPU each gate is one compute-shader dispatch over
        float32 amplitudes, 24 qubits at most (128 MiB); without WebGPU, the same arithmetic runs in float64 JavaScript in a background thread, 20 qubits at most.
        Shots are drawn from the exact probabilities. The engine is checked against Q-Lab&apos;s server-side Qiskit simulation in its tests.
      </p>
    </main>
  );
}
