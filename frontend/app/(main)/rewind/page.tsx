"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qlabApiPath } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useDetail, withDetail } from "../../../lib/dial";
import { setCommandContext } from "../../../components/CommandPalette";
import board from "../../../components/board/board.module.css";
import { Seg } from "../../../components/board/parts";
import { CountBars, Spark, TimeLine } from "./charts";
import {
  type Accuracy, apiError, type CompareJob, day, type Days, EXAMPLES, fid, type Machines, METRICS, type MetricKey, nearestDay, pct,
  type Replay, sentence, stamp, verdict, type Watch,
} from "./data";
import s from "./rewind.module.css";

/*
 * Rewind: run a circuit on a machine as it was calibrated on a past date (backend/app/rewind/).
 * Open to everyone; an account raises the shot limit and can keep a replay as a run. The address
 * carries the machine, date and tab (?machine=&date=&tab=), and ?run= prefills a Q-Lab run's
 * circuit. Every number here is a simulation from IBM-published calibration, and says so.
 */

type Tab = "replay" | "watch";
type RunState = { s: "idle" } | { s: "working" } | { s: "ok"; r: Replay; name: string } | { s: "error"; msg: string };
type Project = { slug: string; name: string };

function readParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { machine: p.get("machine"), date: p.get("date"), run: p.get("run"), tab: p.get("tab") === "watch" ? "watch" as Tab : "replay" as Tab };
  } catch {
    return { machine: null, date: null, run: null, tab: "replay" as Tab };
  }
}
function writeParams(ch: Record<string, string | null>) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(ch)) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); }
  window.history.replaceState(window.history.state, "", u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "") + u.hash);
}

async function getJson<T>(path: string, init?: RequestInit): Promise<{ ok: true; d: T } | { ok: false; msg: string; status: number }> {
  try {
    const r = await fetch(qlabApiPath(path), { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    if (r.ok) return { ok: true, d: (await r.json()) as T };
    const e = (await r.json().catch(() => ({}))) as { detail?: unknown };
    return { ok: false, msg: apiError(r.status, e.detail), status: r.status };
  } catch {
    return { ok: false, msg: "The server couldn't be reached. Check your connection and try again.", status: 0 };
  }
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={s.copy} aria-label={label}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>
      {done ? "copied" : "copy"}
    </button>
  );
}

/** What the page does, said when there is nothing to show yet. Nothing is made up to fill it. */
function EmptyState({ m }: { m: Machines }) {
  return (
    <section className="frame">
      <div className="frame-head"><h2>{m.collecting ? "Nothing stored yet" : "Collection hasn't started on this server"}</h2><span className="inst-label">No data</span></div>
      <div className="empty-state" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>
          {m.collecting
            ? `This server is collecting IBM's calibration (every ${m.every_hours} hours) but hasn't stored any yet. The first machines appear here after the first harvest.`
            : "This server has no IBM Quantum key, so it collects no calibration and Rewind has nothing to replay. Nothing on this page is invented to fill the gap: no sample machines, no example numbers."}
        </p>
        <p style={{ margin: 0 }}><strong>What this page will do</strong> once calibrations are stored:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Run your circuit (OpenQASM 2/3 or QPY) on a simulator with the noise of a chosen IBM machine as it was calibrated on a chosen past day, and say how it came out.</li>
          <li>Compare across time: the same circuit on one calibration per month, up to 12 months, as a line.</li>
          <li>QPU Watch: each machine&apos;s condition today (median T1, T2, two-qubit and readout error) against its own history.</li>
        </ul>
        {!m.collecting && m.reason && <p className="mono" style={{ margin: 0, fontSize: 12 }}>Server: {m.reason}</p>}
        <p style={{ margin: 0, fontSize: 12.5 }}>{m.note}</p>
      </div>
    </section>
  );
}

export default function RewindPage() {
  const [detail] = useDetail();
  const { token } = useAuth();
  const signedIn = !!token;
  const [tab, setTab] = useState<Tab>("replay");
  const [machines, setMachines] = useState<Machines | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [machine, setMachine] = useState<string>("");
  const [days, setDays] = useState<Days | null>(null);
  const [idx, setIdx] = useState(-1);
  const [text, setText] = useState<string>(EXAMPLES[0].qasm);
  const [name, setName] = useState<string>("your Bell circuit");
  const [example, setExample] = useState<string | null>("bell");
  const [shots, setShots] = useState(1024);
  const [seed, setSeed] = useState("");
  const [run, setRun] = useState<RunState>({ s: "idle" });
  const [fromRun, setFromRun] = useState<{ id: string; name: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const want = useRef<{ machine: string | null; date: string | null }>({ machine: null, date: null });
  const fileInput = useRef<HTMLInputElement>(null);

  // Machines, and whatever the address asks for.
  useEffect(() => {
    const p = readParams();
    want.current = { machine: p.machine, date: p.date };
    let on = true;
    void Promise.resolve().then(() => { if (on) setTab(p.tab); });
    void getJson<Machines>("/api/v1/rewind/machines").then((r) => {
      if (!on) return;
      if (!r.ok) { setLoadErr(r.msg); return; }
      setMachines(r.d);
      const names = r.d.machines.map((m) => m.machine);
      setMachine(p.machine && names.includes(p.machine) ? p.machine : names[0] ?? "");
    });
    if (p.run && localStorage.getItem("qlab_token")) {
      void getJson<{ run_id: string; qasm: string | null; circuit_name: string | null }>(`/api/v1/runs/${encodeURIComponent(p.run)}`).then((r) => {
        if (!on || !r.ok || !r.d.qasm) return;
        setText(r.d.qasm); setExample(null);
        setName(r.d.circuit_name ? `your circuit ${r.d.circuit_name}` : "your run's circuit");
        setFromRun({ id: r.d.run_id, name: r.d.circuit_name });
      });
    }
    return () => { on = false; };
  }, []);

  // The days stored for the chosen machine; the slider moves over exactly these.
  useEffect(() => {
    if (!machine) return;
    let on = true;
    void getJson<Days>(`/api/v1/rewind/machines/${encodeURIComponent(machine)}/days`).then((r) => {
      if (!on || !r.ok) return;
      setDays(r.d);
      const i = nearestDay(r.d.days, want.current.machine === machine ? want.current.date : null);
      setIdx(i);
    });
    return () => { on = false; };
  }, [machine]);

  const chosen = days && idx >= 0 ? days.days[idx] : null;
  const shotCap = run.s === "ok" && run.r.limits ? run.r.limits.shots : signedIn ? 8192 : 4096;

  const go = useCallback(async () => {
    if (!machine || !chosen || !text.trim()) return;
    setRun({ s: "working" });
    const body: Record<string, unknown> = { machine, date: chosen.date, circuit: text, shots };
    if (seed.trim()) body.seed = Number(seed);
    const r = await getJson<Replay>("/api/v1/rewind/run", { method: "POST", body: JSON.stringify(body) });
    setRun(r.ok ? { s: "ok", r: r.d, name } : { s: "error", msg: r.msg });
  }, [machine, chosen, text, shots, seed, name]);

  const pickMachine = (m: string) => {
    want.current = { machine: m, date: chosen?.date ?? null };
    setMachine(m); writeParams({ machine: m });
  };
  const pickIdx = (i: number) => {
    setIdx(i);
    if (days?.days[i]) { writeParams({ date: days.days[i].date }); want.current = { machine, date: days.days[i].date }; }
  };
  const pickExample = (id: string) => {
    const e = EXAMPLES.find((x) => x.id === id)!;
    setText(e.qasm); setExample(id); setName(`your ${e.name} circuit`); setFromRun(null);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 400_000) { setRun({ s: "error", msg: "That file is over 400 kB; Rewind takes smaller circuits." }); return; }
    const raw = await f.text();
    setText(raw); setExample(null); setFromRun(null); setName(`your circuit ${f.name.replace(/\.[^.]+$/, "")}`);
  };
  const switchTab = (t: Tab) => { setTab(t); writeParams({ tab: t === "watch" ? "watch" : null }); };

  useEffect(() => {
    setCommandContext([
      { id: "here:rewind-run", kind: "here", title: "Run this replay", hint: "Ctrl+Enter in the circuit box", run: () => void go() },
      { id: "here:rewind-watch", kind: "here", title: "QPU Watch: each machine today", hint: "Medians and their trend", run: () => switchTab("watch") },
      ...EXAMPLES.map((e) => ({ id: `here:rewind-${e.id}`, kind: "here" as const, title: `Rewind an example: ${e.name}`, hint: "Fills the circuit box", run: () => { switchTab("replay"); pickExample(e.id); } })),
      { id: "here:board", kind: "here", title: "The hardware board", hint: "Live status and benchmark history", href: "/hardware" },
    ]);
    return () => setCommandContext([]);
  }, [go]);

  const empty = machines && machines.machines.length === 0;
  const plain = detail === "plain";
  const summary = loadErr ? `Rewind couldn't load: ${loadErr}`
    : !machines ? "Loading the machines this server has calibration for…"
      : empty ? (machines.collecting ? "No calibration is stored on this server yet, so there is nothing to replay. Nothing below is invented."
        : "Collection hasn't started on this server: it has no IBM Quantum key, so there is no calibration to replay. Nothing below is invented.")
        : tab === "watch" ? "Each machine's condition today and how it compares with its own stored history."
          : run.s === "ok" ? sentence(run.r, run.name, plain)
            : run.s === "working" ? `Replaying on ${machine} as calibrated on ${chosen ? day(chosen.date) : "…"}…`
              : run.s === "error" ? run.msg
                : `Pick a machine and a past date, give a circuit, and Rewind runs it on a simulator with that machine's noise as it was calibrated that day. ${machines.machines.length} machine${machines.machines.length === 1 ? "" : "s"} stored.`;

  return (
    <main className={board.page}>
      <header className={board.head}>
        <span className={`inst-label ${s.channel}`}><i aria-hidden />Rewind</span>
        <h1 className={board.title}>Rewind<small>a machine as it was on a past date</small></h1>
        <p className="summary-line" aria-live="polite">{summary}</p>
        {machines?.simulated && (
          <div className={board.simBanner} role="note">
            SIMULATED PREVIEW: these calibrations come from IBM&apos;s fake backends with a made-up history, on a local server
            (QLAB_HARDWARE_BOARD_SIMULATE=1). They are not IBM&apos;s published calibration.
          </div>
        )}
      </header>

      {machines && empty && <EmptyState m={machines} />}

      {machines && !empty && (
        <>
          <div className={s.tabs} role="tablist" aria-label="Rewind">
            <button type="button" role="tab" aria-selected={tab === "replay"} onClick={() => switchTab("replay")}>Replay a circuit</button>
            <button type="button" role="tab" aria-selected={tab === "watch"} onClick={() => switchTab("watch")}>QPU Watch</button>
          </div>

          {tab === "watch" ? <WatchTab /> : (
            <>
              <section className="frame">
                <div className="frame-head"><h2>Machine and date</h2><span className="inst-label">{days ? `${days.days.length} days stored` : ""}</span></div>
                <div className="frame-body">
                  <div className={s.controls}>
                    <div className={s.field}>
                      <label className="inst-label" htmlFor="rw-machine">Machine</label>
                      <select id="rw-machine" className="input" value={machine} onChange={(e) => pickMachine(e.target.value)}>
                        {machines.machines.map((m) => <option key={m.machine} value={m.machine}>{m.machine} · {m.snapshots} calibrations</option>)}
                      </select>
                    </div>
                    <div className={s.field}>
                      <label className="inst-label" htmlFor="rw-date">
                        Date{chosen ? <>: <span style={{ color: "var(--text)", letterSpacing: 0, textTransform: "none" }}>{day(chosen.date)}</span></> : null}
                      </label>
                      <input id="rw-date" className={s.slider} type="range" min={0} max={Math.max(0, (days?.days.length ?? 1) - 1)} step={1}
                        value={Math.max(0, idx)} disabled={!days || !days.days.length} onChange={(e) => pickIdx(Number(e.target.value))}
                        aria-valuetext={chosen ? day(chosen.date) : "no dates"} />
                      <span className={s.used}>
                        {days?.days.length ? <>{day(days.days[0].date)} … {day(days.days[days.days.length - 1].date)}</> : "…"}
                        {chosen ? <> · uses the calibration of {stamp(chosen.calibrated_at)}</> : null}
                      </span>
                    </div>
                    <div className={s.field}>
                      <label className="inst-label" htmlFor="rw-shots">Shots (up to {shotCap.toLocaleString("en-US")})</label>
                      <input id="rw-shots" className="input num" type="number" min={1} max={shotCap} value={shots}
                        onChange={(e) => setShots(Math.max(1, Math.min(shotCap, Math.round(Number(e.target.value) || 1))))} style={{ maxWidth: 130 }} />
                    </div>
                  </div>
                  {!signedIn && <p className={s.note} style={{ marginTop: 10 }}>No account needed. <Link href="/login?next=/rewind" style={{ textDecoration: "underline" }}>Signed in</Link>, you get up to 8,192 shots and can keep a replay as a run.</p>}
                </div>
              </section>

              <section className="frame">
                <div className="frame-head"><h2>The circuit</h2><span className="inst-label">OpenQASM 2 or 3, or base64 QPY</span></div>
                <div className={`frame-body ${dragging ? s.drop : ""}`} style={{ display: "grid", gap: 10 }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); void onFile(e.dataTransfer.files?.[0]); }}>
                  <div className={s.examples} role="group" aria-label="Example circuits">
                    <span className="inst-label">Examples</span>
                    {EXAMPLES.map((e) => <button key={e.id} type="button" className={s.chip} aria-pressed={example === e.id} onClick={() => pickExample(e.id)}>{e.name}</button>)}
                    {fromRun && <span className={s.note}>From run <Link href={withDetail(`/runs/${encodeURIComponent(fromRun.id)}`, detail)} className="mono">{fromRun.name || fromRun.id.slice(0, 12)}</Link></span>}
                  </div>
                  <label className="sr-only" htmlFor="rw-circuit">Circuit</label>
                  <textarea id="rw-circuit" className="input mono" spellCheck={false} rows={9} value={text}
                    onChange={(e) => { setText(e.target.value); setExample(null); setFromRun(null); setName("your circuit"); }}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void go(); } }}
                    style={{ width: "100%", height: "auto", minHeight: 160, fontSize: 12.5, lineHeight: 1.5, resize: "vertical", padding: 10 }} />
                  <div className={s.row}>
                    <button className="button" type="button" disabled={!text.trim() || !chosen || run.s === "working"} onClick={() => void go()}
                      aria-keyshortcuts="Control+Enter">{run.s === "working" ? "Replaying…" : "Run"}</button>
                    <button className="button secondary" type="button" onClick={() => fileInput.current?.click()}>Open a .qasm file</button>
                    <input ref={fileInput} type="file" accept=".qasm,.qasm3,.qpy,.txt,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
                    <span className={`${s.note} d-standard`}>Ctrl+Enter runs. Drop a file on this box.</span>
                    <span className="d-expert" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <label className="inst-label" htmlFor="rw-seed">Seed</label>
                      <input id="rw-seed" className="input num" inputMode="numeric" placeholder="20261114" value={seed}
                        onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} style={{ width: 110 }} />
                    </span>
                  </div>
                </div>
              </section>

              {run.s === "error" && <div className="alert alert-warn" role="alert">{run.msg}</div>}
              {run.s === "ok" && <Result r={run.r} signedIn={signedIn} text={text} name={run.name} seed={seed} />}
              {chosen && days && days.monthly.length >= 2 && (
                <CompareAcross key={machine} machine={machine} text={text} shots={Math.min(shots, shotCap)} seed={seed} months={days.monthly.length} />
              )}
            </>
          )}
        </>
      )}
      {machines && !empty && <p className={s.note}>{machines.note}</p>}
    </main>
  );
}

/** The replay's answer: counts, label, accuracy, where it came from. */
function Result({ r, signedIn, text, name, seed }: { r: Replay; signedIn: boolean; text: string; name: string; seed: string }) {
  const sha = r.snapshot.sha256;
  return (
    <>
      <section className="frame">
        <div className="frame-head">
          <h2>{r.shots.toLocaleString("en-US")} shots on {r.machine}, {day(r.snapshot.calibrated_at)}</h2>
          <span className="inst-label">simulated · not hardware</span>
        </div>
        <div className="frame-body" style={{ display: "grid", gap: 12 }}>
          <div className="table-wrap"><CountBars counts={r.counts} shots={r.shots} ideal={r.ideal?.available ? r.ideal.top : undefined} /></div>
          <p className={s.label} role="note">{r.label}</p>
          <AccuracyLine a={r.accuracy} note={r.accuracy_note} />
          {r.snapshot.gap_days !== 0 && <p className={s.note}>{r.snapshot.note}</p>}
          {r.notes.map((n) => <p key={n} className={s.note}>{n}</p>)}
          <dl className={s.facts}>
            <dt>Calibration</dt>
            <dd><span className={s.sha} title={sha}>{sha.slice(0, 12)}<Copy text={sha} label="Copy the calibration's sha256" /></span> <span className={s.note}>{stamp(r.snapshot.calibrated_at)}</span></dd>
            {r.ideal && <><dt>Vs noiseless</dt><dd>{r.ideal.available
              ? <>Hellinger fidelity <b className="num">{fid(r.ideal.hellinger_fidelity)}</b>{r.ideal.share_on_ideal_outcomes != null && <span className="d-standard"> · {pct(r.ideal.share_on_ideal_outcomes)} of shots on outcomes the noiseless circuit gives</span>}</>
              : <span className={s.note}>{r.ideal.reason}</span>}</dd></>}
            <dt className="d-standard">Software</dt>
            <dd className="d-standard mono" style={{ fontSize: 12 }}>{Object.entries(r.software).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd>
            <dt className="d-standard">Not modelled</dt>
            <dd className="d-standard">{r.noise_model.not_modelled.join("; ")}.</dd>
            <dt className="d-expert">Noise model</dt>
            <dd className="d-expert">{r.noise_model.model} ({r.noise_model.method.replace("_", " ")}; channels {Object.entries(r.noise_model.channels).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}).</dd>
            <dt className="d-expert">Compiled</dt>
            <dd className="d-expert mono" style={{ fontSize: 12 }}>
              physical qubits {r.transpiled.physical_qubits.join(",")} · depth {r.transpiled.depth} · {r.transpiled.two_qubit_gates} two-qubit gates · opt level {r.transpiled.optimization_level} · seeds sim {r.seeds.simulator}, transpiler {r.seeds.transpiler} · {r.seconds.toFixed(2)} s
            </dd>
          </dl>
        </div>
      </section>
      {signedIn && <SaveRun r={r} text={text} name={name} seed={seed} />}
    </>
  );
}

/** How well replicas of this machine matched real runs, in the API's own words. */
function AccuracyLine({ a, note }: { a: Accuracy; note: string | null }) {
  return (
    <p className={s.note} role="note">
      <b>Accuracy against real hardware:</b> {a == null ? (note ? `${note.replace(/\.$/, "")}.` : "not measured yet.") : note}
      {a && <span className="d-expert mono"> (median {fid(a.median)}, worst {fid(a.worst)}, {a.n_circuits} circuits, measured {stamp(a.measured_at)}{a.simulated ? ", simulated preview" : ""})</span>}
    </p>
  );
}

/** Keep a replay as a Q-Lab run: replayed again on the server (same inputs, same counts) and marked simulated. */
function SaveRun({ r, text, name, seed }: { r: Replay; text: string; name: string; seed: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [project, setProject] = useState("");
  const [st, setSt] = useState<{ s: "idle" | "saving" } | { s: "saved"; id: string } | { s: "error"; msg: string }>({ s: "idle" });
  useEffect(() => {
    let on = true;
    void getJson<Project[]>("/api/v1/projects").then((x) => { if (on) setProjects(x.ok ? x.d : []); });
    return () => { on = false; };
  }, []);
  const save = async () => {
    setSt({ s: "saving" });
    const body: Record<string, unknown> = { machine: r.machine, date: r.requested_date, circuit: text, shots: r.shots, project: project || null,
      name: name.replace(/^your (circuit ?)?/, "").replace(/ circuit$/, "").replace(/^run.s$/, "") || null };
    if (seed.trim()) body.seed = Number(seed);
    const x = await getJson<{ run_id: string }>("/api/v1/rewind/save", { method: "POST", body: JSON.stringify(body) });
    setSt(x.ok ? { s: "saved", id: x.d.run_id } : { s: "error", msg: x.msg });
  };
  return (
    <section className="frame">
      <div className="frame-head"><h2>Save this to Q-Lab</h2><span className="inst-label">as a run marked simulated</span></div>
      <div className="frame-body" style={{ display: "grid", gap: 8 }}>
        <div className={s.row}>
          <label className="inst-label" htmlFor="rw-project">Project</label>
          <select id="rw-project" className="input" value={project} onChange={(e) => setProject(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">No project</option>
            {(projects ?? []).map((p) => <option key={p.slug} value={p.slug}>{p.name || p.slug}</option>)}
          </select>
          <button type="button" className="button secondary" disabled={st.s === "saving"} onClick={() => void save()}>{st.s === "saving" ? "Saving…" : "Save as a run"}</button>
          {st.s === "saved" && <Link href={`/runs/${encodeURIComponent(st.id)}`} style={{ textDecoration: "underline" }}>Saved: open the run</Link>}
          {st.s === "error" && <span className={board.err} role="alert">{st.msg}</span>}
        </div>
        <p className={s.note}>The run&apos;s backend is <span className="mono">rewind:{r.machine}</span>, tagged simulated, with the calibration&apos;s sha256, so it is never mistaken for a hardware run.</p>
      </div>
    </section>
  );
}

/** The same circuit on one calibration per month, run one after another on the server. */
function CompareAcross({ machine, text, shots, seed, months }: { machine: string; text: string; shots: number; seed: string; months: number }) {
  const [job, setJob] = useState<CompareJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<"hellinger" | "share">("hellinger");

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const start = async () => {
    setErr(null); setJob(null);
    const body: Record<string, unknown> = { machine, circuit: text, shots };
    if (seed.trim()) body.seed = Number(seed);
    const r = await getJson<CompareJob>("/api/v1/rewind/compare", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { setErr(r.msg); return; }
    setJob(r.d);
    // Poll until the server says it is done; each month is one replay, one after another.
    for (let status = r.d.status; status === "running" && alive.current;) {
      await new Promise((ok) => window.setTimeout(ok, 1500));
      if (!alive.current) return;
      const p = await getJson<CompareJob>(`/api/v1/rewind/compare/${r.d.job}`);
      if (!p.ok) { setErr(p.msg); return; }
      setJob(p.d);
      status = p.d.status;
    }
  };
  const running = job?.status === "running";
  const done = job?.results.filter((x) => x.status === "ok" || x.status === "error").length ?? 0;
  const points = useMemo(() => (job?.results ?? []).filter((x) => x.status === "ok").map((x) => ({
    date: x.date, v: (metric === "hellinger" ? x.hellinger_fidelity : x.share_on_ideal_outcomes) ?? null, sha: x.snapshot?.sha256,
  })), [job, metric]);
  const ok = points.filter((p) => p.v != null);
  let line = `Runs the circuit above on ${machine} as calibrated in each of the last ${months} months that have a calibration (the last stored day of each), one after another; ${shots.toLocaleString("en-US")} shots each.`;
  if (job && ok.length >= 2) {
    const best = ok.reduce((a, b) => (b.v! > a.v! ? b : a)), worst = ok.reduce((a, b) => (b.v! < a.v! ? b : a));
    const what = metric === "hellinger" ? "Hellinger fidelity" : "share on the noiseless outcomes";
    line = `${running ? "So far: " : ""}best with the calibration of ${day(best.date)} (${what} ${best.v!.toFixed(3)}), worst with that of ${day(worst.date)} (${worst.v!.toFixed(3)}).`;
  }
  return (
    <section className="frame" aria-busy={running}>
      <div className="frame-head"><h2>Compare across time</h2><span className="inst-label">{job ? `${done} of ${job.results.length} months` : `up to ${months} months`}</span></div>
      <div className="frame-body" style={{ display: "grid", gap: 10 }}>
        <p className="summary-line" style={{ fontSize: 14 }} aria-live="polite">{line}</p>
        <div className={s.row}>
          <button type="button" className="button secondary" disabled={running || !text.trim()} onClick={() => void start()}>{running ? "Comparing…" : job ? "Compare again" : "Compare across time"}</button>
          {job && <ol className={s.progress} aria-label="Months">{job.results.map((x) => <li key={x.date} data-s={x.status} title={`${day(x.date)}: ${x.status}${x.error ? ` (${x.error})` : ""}`} />)}</ol>}
          {job?.ideal.available && <Seg label="Metric" value={metric} onChange={setMetric} options={[{ id: "hellinger", title: "Hellinger fidelity" }, { id: "share", title: "On ideal outcomes" }]} />}
        </div>
        {err && <div className="alert alert-warn" role="alert">{err}</div>}
        {job?.ideal.available === false && <p className={s.note}>{job.ideal.reason} Each month&apos;s most common outcome is listed instead.</p>}
        {job && points.length > 0 && job.ideal.available && <TimeLine points={points} label={metric === "hellinger" ? "Hellinger fidelity" : "Share of shots on the noiseless outcomes"} />}
        {job && (
          <div className="table-wrap d-standard">
            <table className={`${board.table} ${s.ctable}`}>
              <thead><tr><th>Month</th><th className="r">Hellinger</th><th className="r">On ideal</th><th>Top outcome</th><th className={board.hideNarrow}>Calibration</th></tr></thead>
              <tbody>
                {job.results.map((x) => (
                  <tr key={x.date}>
                    <td className="num">{day(x.date)}</td>
                    {x.status === "ok" ? <>
                      <td className="r num">{fid(x.hellinger_fidelity)}</td>
                      <td className="r num">{x.share_on_ideal_outcomes == null ? "—" : pct(x.share_on_ideal_outcomes)}</td>
                      <td className={`mono ${s.top}`}>{x.top?.[0] ? <>{x.top[0][0]} <span>({pct(x.top[0][1])})</span></> : "—"}</td>
                      <td className={`mono ${board.hideNarrow}`}>{x.snapshot?.sha256.slice(0, 12)}</td>
                    </> : <td colSpan={4} className={board.muted} style={{ whiteSpace: "normal" }}>{x.status === "error" ? x.error : x.status === "running" ? "running…" : "waiting"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {job && <p className={s.note}>{job.label}</p>}
        {job && <AccuracyLine a={job.accuracy} note={job.accuracy_note} />}
      </div>
    </section>
  );
}

/** Each machine today and against its own stored history: medians only. */
function WatchTab() {
  const [windowDays, setWindowDays] = useState<"30" | "90" | "365">("30");
  const [w, setW] = useState<{ days: string; d: Watch } | { days: string; err: string } | null>(null);
  const [focus, setFocus] = useState<MetricKey>("two_qubit_error_median");
  useEffect(() => {
    let on = true;
    void getJson<Watch>(`/api/v1/rewind/watch?days=${windowDays}`).then((r) => { if (on) setW(r.ok ? { days: windowDays, d: r.d } : { days: windowDays, err: r.msg }); });
    return () => { on = false; };
  }, [windowDays]);
  const data = w && "d" in w ? w.d : null;
  const n = Number(windowDays);
  const lead = useMemo(() => {
    if (!data) return null;
    const vs = data.machines.map((m) => verdict(m, focus, n)).filter((v) => v.rank !== "none");
    return vs.find((v) => v.rank === "best") ?? vs.find((v) => v.rank === "worst") ?? vs[0] ?? null;
  }, [data, focus, n]);
  return (
    <section style={{ display: "grid", gap: 12 }} aria-busy={!w || w.days !== windowDays}>
      <p className="summary-line">{w && "err" in w ? w.err : lead ? lead.text : "Reading each machine's medians…"}</p>
      <div className={board.controls}>
        <Seg label="Window" value={windowDays} onChange={setWindowDays} options={[{ id: "30", title: "30 days" }, { id: "90", title: "90 days" }, { id: "365", title: "1 year" }]} />
        <Seg label="Lead with" value={focus} onChange={setFocus} options={METRICS.map((m) => ({ id: m.key, title: m.short }))} />
      </div>
      <div className={s.watch}>
        {data?.machines.map((m) => (
          <article key={m.machine} className={s.mcard}>
            <div className={s.mhead}>
              <h3>{m.machine}</h3>
              <span className="inst-label">{m.latest ? `calibrated ${stamp(m.latest.calibrated_at)}` : "no medians"} · {m.snapshots} stored since {day(m.first_date)}</span>
            </div>
            <p className={s.msent}>{verdict(m, focus, n).text}</p>
            <dl className={s.mgrid} style={{ margin: 0 }}>
              {METRICS.map((k) => {
                const v = m.latest?.[k.key];
                return (
                  <div key={k.key} className={s.mcell}>
                    <dt>{k.short} <span style={{ textTransform: "none", letterSpacing: 0 }}>({k.better === "low" ? "lower" : "higher"} is better)</span></dt>
                    <dd>{v == null ? "—" : k.fmt(v)}</dd>
                    <Spark values={m.series.map((p) => p[k.key])} dates={m.series.map((p) => p.date ?? p.calibrated_at)} label={`${m.machine} median ${k.label}`} fmt={k.fmt} better={k.better} />
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>
      {data && <p className={s.note}>One point per day (that day&apos;s last calibration), over the last {n} days stored. {data.note}</p>}
    </section>
  );
}
