"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qlabApiPath } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useDetail, withDetail } from "../../../lib/dial";
import { setCommandContext } from "../../../components/CommandPalette";
import board from "../../../components/board/board.module.css";
import { Seg } from "../../../components/board/parts";
import { CountBars } from "../rewind/charts";
import {
  apiError, buildReported, type Comparison, day, distributionText, EXAMPLE, fmt3, type Kind, type Paper, pct, readShare,
  type ReportedInput, type RunResult, shareUrl, type Status,
} from "./data";
import s from "./papers.module.css";

/*
 * Reproduce a paper (backend/app/routers/papers.py). Paste an arXiv link or id; Q-Lab reads the
 * paper's source files (and a GitHub repository its abstract links) for OpenQASM, runs a circuit
 * on a replica of an IBM machine as calibrated on a day (Rewind), or on the ideal simulator when
 * no calibration is stored, and puts the result next to the numbers the paper reports, which the
 * user types in. Open to everyone. The address carries the paper, the circuit, where it ran and
 * the reported numbers, so a comparison can be shared as a link.
 */

type FindState = { s: "idle" } | { s: "working"; id: string } | { s: "ok"; p: Paper } | { s: "error"; msg: string };
type RunState = { s: "idle" } | { s: "working" } | { s: "ok"; r: RunResult } | { s: "error"; msg: string };
type Project = { slug: string; name: string };
const PASTE = "__paste";
const KINDS: { id: Kind; title: string }[] = [
  { id: "probability", title: "Success probability" }, { id: "fidelity", title: "Fidelity" }, { id: "distribution", title: "Distribution" },
];
const EMPTY_REPORTED: ReportedInput = { kind: "probability", value: "", outcomes: "", distribution: "", extracted: false };

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

export default function PapersPage() {
  const [detail] = useDetail();
  const { token } = useAuth();
  const signedIn = !!token;
  const [status, setStatus] = useState<Status | null>(null);
  const [input, setInput] = useState("");
  const [find, setFind] = useState<FindState>({ s: "idle" });
  const [pick, setPick] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [machine, setMachine] = useState("");
  const [date, setDate] = useState("");
  const [shots, setShots] = useState(1024);
  const [rep, setRep] = useState<ReportedInput>(EMPTY_REPORTED);
  const [run, setRun] = useState<RunState>({ s: "idle" });
  const [cmp, setCmp] = useState<{ c: Comparison | null; err: string | null }>({ c: null, err: null });
  const [copied, setCopied] = useState(false);
  const autorun = useRef<{ circuit: string | null } | null>(null);

  const paper = find.s === "ok" ? find.p : null;
  const chosen = paper?.circuits.find((c) => c.id === pick) ?? null;
  const qasm = pick === PASTE ? pasted : chosen?.qasm ?? "";
  const canRun = !!qasm.trim() && (pick === PASTE || !!chosen?.ok) && run.s !== "working";
  const shotCap = status?.limits.shots ?? (signedIn ? 8192 : 4096);
  const built = buildReported(rep);
  const repError = built && !built.ok ? built.msg : null;
  const mInfo = status?.machines.find((m) => m.machine === machine) ?? null;

  const lookUp = useCallback(async (text: string, wantCircuit: string | null = null) => {
    if (!text.trim()) return;
    setFind({ s: "working", id: text.trim() });
    setRun({ s: "idle" }); setCmp({ c: null, err: null });
    const r = await getJson<Paper>("/api/v1/papers/find", { method: "POST", body: JSON.stringify({ paper: text.trim() }) });
    if (!r.ok) { setFind({ s: "error", msg: r.msg }); return; }
    setFind({ s: "ok", p: r.d });
    const want = wantCircuit && r.d.circuits.find((c) => c.id === wantCircuit && c.ok);
    const first = r.d.circuits.find((c) => c.ok);
    setPick(want ? want.id : first ? first.id : PASTE);
    const u = new URL(window.location.href);
    if (u.searchParams.get("paper") !== r.d.arxiv_id) {
      u.search = ""; u.searchParams.set("paper", r.d.arxiv_id);
      window.history.replaceState(window.history.state, "", u.pathname + `?${u.searchParams}`);
    }
  }, []);

  // What this server can run on, and whatever a shared link asks for.
  useEffect(() => {
    let on = true;
    void getJson<Status>("/api/v1/papers/status").then((r) => { if (on && r.ok) setStatus(r.d); });
    const sh = readShare(window.location.search);
    void Promise.resolve().then(() => {
      if (!on) return;
      if (sh.machine) setMachine(sh.machine);
      if (sh.date) setDate(sh.date);
      if (sh.shots) setShots(sh.shots);
      if (sh.reported) setRep(sh.reported);
      if (sh.paper) {
        setInput(sh.paper);
        autorun.current = sh.circuit ? { circuit: sh.circuit } : null;
        void lookUp(sh.paper, sh.circuit);
      }
    });
    return () => { on = false; };
  }, [lookUp]);

  // A machine named in a link but not stored here falls back to the ideal simulator, and says so below.
  useEffect(() => {
    if (status && machine && !status.machines.some((m) => m.machine === machine)) void Promise.resolve().then(() => setMachine(""));
  }, [status, machine]);

  const go = useCallback(async () => {
    if (!qasm.trim()) return;
    if (built && !built.ok) { setRun({ s: "error", msg: built.msg }); return; }
    setRun({ s: "working" }); setCmp({ c: null, err: null });
    const body: Record<string, unknown> = { circuit: qasm, shots: Math.min(shots, shotCap) };
    if (machine) { body.machine = machine; if (date) body.date = date; }
    if (built?.ok) body.reported = built.reported;
    const r = await getJson<RunResult>("/api/v1/papers/run", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) { setRun({ s: "error", msg: r.msg }); return; }
    setRun({ s: "ok", r: r.d });
    setCmp({ c: r.d.comparison, err: null });
  }, [qasm, shots, shotCap, machine, date, built]);

  // A shared link runs once its paper and circuit are loaded.
  useEffect(() => {
    if (!autorun.current || find.s !== "ok" || !status) return;
    const want = autorun.current.circuit;
    autorun.current = null;
    if (want && pick === want) void Promise.resolve().then(() => void go());
  }, [find, status, pick, go]);

  // Typing the paper's numbers after a run compares again without running again.
  const recompare = useCallback(async () => {
    if (run.s !== "ok") return;
    if (!built) { setCmp({ c: null, err: null }); return; }
    if (!built.ok) { setCmp({ c: null, err: built.msg }); return; }
    const r = await getJson<Comparison>("/api/v1/papers/compare", { method: "POST", body: JSON.stringify({
      result: { counts: run.r.counts, shots: run.r.shots, mode: run.r.mode, ideal: run.r.ideal }, reported: built.reported }) });
    setCmp(r.ok ? { c: r.d, err: null } : { c: null, err: r.msg });
  }, [run, built]);

  useEffect(() => {
    setCommandContext([
      { id: "here:papers-run", kind: "here", title: "Run this circuit", hint: "Ctrl+Enter in the paper box", run: () => void go() },
      { id: "here:papers-example", kind: "here", title: `Try a paper: arXiv ${EXAMPLE} (OpenQASM)`, hint: "Fills the box and looks it up", run: () => { setInput(EXAMPLE); void lookUp(EXAMPLE); } },
      { id: "here:rewind", kind: "here", title: "Rewind: a machine as it was on a past date", hint: "Replay any circuit", href: "/rewind" },
    ]);
    return () => setCommandContext([]);
  }, [go, lookUp]);

  const link = useMemo(() => {
    if (!paper || !chosen || typeof window === "undefined") return null;
    return shareUrl(window.location.href, { paper: paper.arxiv_id, circuit: chosen.id, machine, date: machine ? date : "", shots, reported: rep });
  }, [paper, chosen, machine, date, shots, rep]);

  const summary = run.s === "ok" ? (cmp.c?.line ?? `Ran ${run.r.shots.toLocaleString("en-US")} shots. Type the paper's numbers below to compare.`)
    : run.s === "working" ? `Running on ${machine ? `${machine}'s replica` : "the ideal simulator"}…`
      : run.s === "error" ? run.msg
        : find.s === "working" ? `Reading arXiv ${find.id}: its details, its source files and any GitHub repository it links…`
          : find.s === "error" ? find.msg
            : paper ? paper.message
              : "Paste an arXiv link or id. Q-Lab finds the paper's OpenQASM circuits, runs one on a simulator modelled on an IBM machine, and puts the result next to the paper's numbers.";

  return (
    <main className={board.page}>
      <header className={board.head}>
        <span className={`inst-label ${s.channel}`}><i aria-hidden />Papers</span>
        <h1 className={board.title}>Reproduce a paper<small>its circuits, run again, next to its numbers</small></h1>
        <p className="summary-line" aria-live="polite">{summary}</p>
      </header>

      <section className="frame">
        <div className="frame-head"><h2>The paper</h2><span className="inst-label">arXiv link or id</span></div>
        <form className="frame-body" style={{ display: "grid", gap: 10 }} onSubmit={(e) => { e.preventDefault(); void lookUp(input); }}>
          <div className={s.row}>
            <label className="sr-only" htmlFor="pp-paper">arXiv link or id</label>
            <input id="pp-paper" className="input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="arxiv.org/abs/1707.03429 or 1707.03429"
              autoComplete="off" spellCheck={false} maxLength={300} style={{ flex: "1 1 260px", minWidth: 0 }} />
            <button className="button" type="submit" disabled={!input.trim() || find.s === "working"}>{find.s === "working" ? "Reading…" : "Find circuits"}</button>
            <button className={s.chip} type="button" onClick={() => { setInput(EXAMPLE); void lookUp(EXAMPLE); }}>Try {EXAMPLE}</button>
          </div>
          <p className={s.note}>
            Q-Lab reads the paper from arXiv and, if its abstract or comments link one, its GitHub repository. It only reads OpenQASM 2 and 3;
            it never runs Python or any other code from a paper. {!signedIn && <>No account needed; <Link href="/login?next=/papers" style={{ textDecoration: "underline" }}>signed in</Link>, you can save a comparison as a run.</>}
          </p>
          {find.s === "error" && <div className="alert alert-warn" role="alert">{find.msg}</div>}
        </form>
      </section>

      {paper && <PaperFacts p={paper} />}

      {paper && (
        <section className="frame">
          <div className="frame-head"><h2>The circuit</h2><span className="inst-label">{paper.circuits.filter((c) => c.ok).length} runnable</span></div>
          <div className="frame-body" style={{ display: "grid", gap: 10 }}>
            {paper.python_only && <p className={s.honest} role="note">{paper.message}</p>}
            <fieldset className={s.list}>
              <legend className="sr-only">Pick a circuit</legend>
              {paper.circuits.filter((c) => c.ok).map((c) => (
                <label key={c.id} className={s.item}>
                  <input type="radio" name="pp-circuit" value={c.id} checked={pick === c.id} onChange={() => setPick(c.id)} />
                  <span>
                    <b className="mono">{c.name}</b>{" "}
                    {c.facts && <span className={s.note}>{c.facts.num_qubits} qubits · depth {c.facts.depth} · {c.facts.expanded_operations} operations</span>}
                    <span className={s.where}>{c.source} · {c.origin}</span>
                  </span>
                </label>
              ))}
              <label className={s.item}>
                <input type="radio" name="pp-circuit" value={PASTE} checked={pick === PASTE} onChange={() => setPick(PASTE)} />
                <span><b>Paste the circuit</b> <span className={s.note}>as OpenQASM 2 or 3</span></span>
              </label>
            </fieldset>
            {paper.circuits.some((c) => !c.ok) && (
              <details className={s.code}>
                <summary>{paper.circuits.filter((c) => !c.ok).length} more found that Q-Lab can&apos;t run, and why</summary>
                <ul className={s.skipped}>
                  {paper.circuits.filter((c) => !c.ok).map((c) => (
                    <li key={c.id}><span className="mono">{c.source} · {c.origin}</span>: {c.problem}</li>
                  ))}
                </ul>
              </details>
            )}
            {paper.more > 0 && <p className={s.note}>{paper.more} more circuit{paper.more === 1 ? "" : "s"} found but not listed.</p>}
            {pick === PASTE ? (
              <>
                <label className="sr-only" htmlFor="pp-qasm">OpenQASM circuit</label>
                <textarea id="pp-qasm" className="input mono" rows={8} spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value)}
                  placeholder={'OPENQASM 2.0;\ninclude "qelib1.inc";\n…'} maxLength={64000}
                  style={{ width: "100%", height: "auto", minHeight: 140, fontSize: 12.5, lineHeight: 1.5, resize: "vertical", padding: 10 }} />
              </>
            ) : chosen && (
              <details className={s.code}>
                <summary>The OpenQASM as found</summary>
                <pre className="mono">{chosen.qasm}</pre>
              </details>
            )}
          </div>
        </section>
      )}

      {paper && (
        <section className="frame">
          <div className="frame-head"><h2>Where to run it</h2><span className="inst-label">simulated · never hardware</span></div>
          <div className="frame-body" style={{ display: "grid", gap: 10 }}>
            <div className={s.controls}>
              <div className={s.field}>
                <label className="inst-label" htmlFor="pp-machine">Machine</label>
                <select id="pp-machine" className="input" value={machine} onChange={(e) => { setMachine(e.target.value); setDate(""); }}>
                  <option value="">Ideal simulator (no noise)</option>
                  {(status?.machines ?? []).map((m) => <option key={m.machine} value={m.machine}>{m.machine} replica · {m.snapshots} calibrations</option>)}
                </select>
              </div>
              {machine && mInfo && (
                <div className={s.field}>
                  <label className="inst-label" htmlFor="pp-date">Calibration of (empty: the latest)</label>
                  <input id="pp-date" className="input num" type="date" value={date} min={mInfo.first_date} max={mInfo.last_date} onChange={(e) => setDate(e.target.value)} />
                </div>
              )}
              <div className={s.field}>
                <label className="inst-label" htmlFor="pp-shots">Shots (up to {shotCap.toLocaleString("en-US")})</label>
                <input id="pp-shots" className="input num" type="number" min={1} max={shotCap} value={shots}
                  onChange={(e) => setShots(Math.max(1, Math.min(shotCap, Math.round(Number(e.target.value) || 1))))} />
              </div>
            </div>
            {status && !status.calibration_available && <p className={s.honest} role="note">{status.reason} Nothing here is invented to fill the gap.</p>}
            {!machine && <p className={s.note}>{status?.ideal_label ?? "Ideal (noiseless) simulator: no hardware noise is modelled."}</p>}
            {machine && <p className={s.note}>A replica built from {machine}&apos;s IBM-published calibration (Rewind{mInfo ? `; ${day(mInfo.first_date)} to ${day(mInfo.last_date)} stored` : ""}). <Link href={withDetail(`/rewind?machine=${encodeURIComponent(machine)}`, detail)} style={{ textDecoration: "underline" }}>What it models</Link>.</p>}
          </div>
        </section>
      )}

      {paper && <ReportedBox rep={rep} setRep={setRep} paper={paper} error={repError} />}

      {paper && (
        <div className={s.row}>
          <button className="button" type="button" disabled={!canRun} onClick={() => void go()}>{run.s === "working" ? "Running…" : run.s === "ok" ? "Run again" : "Run"}</button>
          {run.s === "ok" && <button className="button secondary" type="button" onClick={() => void recompare()} disabled={!built || !built.ok}>Compare with these numbers</button>}
          {!canRun && run.s !== "working" && <span className={s.note}>{pick === PASTE ? "Paste a circuit to run." : "Pick a circuit that fits."}</span>}
        </div>
      )}

      {run.s === "error" && <div className="alert alert-warn" role="alert">{run.msg}</div>}
      {run.s === "ok" && paper && (
        <ResultView r={run.r} c={cmp.c} cmpErr={cmp.err} paper={paper} />
      )}
      {run.s === "ok" && paper && (
        <section className="frame">
          <div className="frame-head"><h2>Keep it</h2><span className="inst-label">link · run</span></div>
          <div className="frame-body" style={{ display: "grid", gap: 10 }}>
            {link ? (
              <div className={s.row}>
                <button type="button" className="button secondary" onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>
                  {copied ? "Link copied" : "Copy a link to this comparison"}
                </button>
                <span className={s.note}>Anyone with the link sees the same paper, circuit, machine and numbers, and the run repeats with the same counts.</span>
              </div>
            ) : <p className={s.note}>A pasted circuit isn&apos;t put in a link. Save it as a run to keep it.</p>}
            {signedIn ? <SaveRun r={run.r} paper={paper} qasm={qasm} origin={pick === PASTE ? "pasted" : chosen?.origin ?? null}
              source={pick === PASTE ? null : chosen?.source ?? null} name={pick === PASTE ? null : chosen?.name ?? null}
              shots={run.r.shots} rep={built?.ok ? built.reported : null} />
              : <p className={s.note}><Link href="/login?next=/papers" style={{ textDecoration: "underline" }}>Sign in</Link> to save this comparison as a Q-Lab run.</p>}
          </div>
        </section>
      )}
      {status && <p className={s.note}>{status.note}</p>}
    </main>
  );
}

function PaperFacts({ p }: { p: Paper }) {
  return (
    <section className="frame">
      <div className="frame-head">
        <h2><a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a></h2>
        <span className="inst-label">arXiv {p.arxiv_id}{p.cached ? " · cached" : ""}</span>
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 8 }}>
        <p className={s.note}>{p.authors.join(", ")}{p.authors_total > p.authors.length ? ` and ${p.authors_total - p.authors.length} more` : ""}{p.published ? ` · ${day(p.published)}` : ""}</p>
        <p style={{ margin: 0 }}>{p.message}</p>
        <ul className={s.sources}>
          {p.sources.map((src) => (
            <li key={src.url} data-s={src.status}>
              <span className="mono">{src.name}</span>{" "}
              <span className={s.note}>{src.status === "ok" ? `read ${src.files_read} file${src.files_read === 1 ? "" : "s"}` : src.note}</span>
              {src.skipped_total > 0 && (
                <details>
                  <summary className={s.note}>{src.skipped_total} entr{src.skipped_total === 1 ? "y" : "ies"} skipped or refused</summary>
                  <ul className={s.skipped}>{src.skipped.map((x, i) => <li key={i}><span className="mono">{x.name}</span>: {x.reason}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
        {p.python_files.length > 0 && !p.python_only && <p className={s.note}>Also found Python that builds circuits ({p.python_files.slice(0, 3).join(", ")}); it is not run.</p>}
      </div>
    </section>
  );
}

function ReportedBox({ rep, setRep, paper, error }: { rep: ReportedInput; setRep: (r: ReportedInput) => void; paper: Paper; error: string | null }) {
  const set = (ch: Partial<ReportedInput>) => setRep({ ...rep, ...ch, extracted: ch.extracted ?? false });
  return (
    <section className="frame">
      <div className="frame-head"><h2>The paper&apos;s numbers</h2><span className="inst-label">you type them · optional</span></div>
      <div className="frame-body" style={{ display: "grid", gap: 10 }}>
        <Seg label="What the paper reports" value={rep.kind} options={KINDS} onChange={(k) => set({ kind: k })} />
        {rep.kind === "distribution" ? (
          <>
            <label className="inst-label" htmlFor="pp-dist">Outcomes and their probabilities or counts, one per line</label>
            <textarea id="pp-dist" className="input mono" rows={5} spellCheck={false} value={rep.distribution} placeholder={"000: 0.47\n111: 0.45\n010: 0.03"}
              onChange={(e) => set({ distribution: e.target.value })} style={{ width: "100%", height: "auto", minHeight: 100, fontSize: 12.5, padding: 10 }} />
          </>
        ) : (
          <div className={s.controls}>
            <div className={s.field}>
              <label className="inst-label" htmlFor="pp-value">{rep.kind === "fidelity" ? "Reported fidelity" : "Reported probability"}</label>
              <input id="pp-value" className="input num" inputMode="decimal" value={rep.value} placeholder="0.87 or 87%" onChange={(e) => set({ value: e.target.value })} />
            </div>
            {rep.kind === "probability" && (
              <div className={s.field}>
                <label className="inst-label" htmlFor="pp-outs">Of the outcomes</label>
                <input id="pp-outs" className="input mono" value={rep.outcomes} placeholder="000, 111" onChange={(e) => set({ outcomes: e.target.value })} />
              </div>
            )}
          </div>
        )}
        {rep.kind === "fidelity" && <p className={s.note}>Compared with the run&apos;s Hellinger fidelity to the noiseless result. If the paper reports another fidelity (state, process, XEB), the two aren&apos;t the same quantity.</p>}
        {paper.values.length > 0 && (
          <div className={s.row}>
            <span className="inst-label">Found in the paper&apos;s files</span>
            {paper.values.map((v, i) => (
              <button key={i} type="button" className={s.chip} onClick={() => setRep({ kind: "distribution", value: "", outcomes: "", distribution: distributionText(v.distribution), extracted: true })}>
                Use {v.origin} ({v.kind})
              </button>
            ))}
          </div>
        )}
        {rep.extracted && <p className={s.honest} role="note">Extracted from the paper&apos;s files, check it: make sure these are the numbers the paper reports for this circuit.</p>}
        {error && <p className={board.err} role="alert">{error}</p>}
      </div>
    </section>
  );
}

function ResultView({ r, c, cmpErr, paper }: { r: RunResult; c: Comparison | null; cmpErr: string | null; paper: Paper }) {
  const where = r.mode === "ideal" ? "Ideal simulator" : `${r.machine} replica, ${r.snapshot ? day(r.snapshot.calibrated_at) : ""}`;
  return (
    <section className="frame">
      <div className="frame-head"><h2>Q-Lab next to the paper</h2><span className="inst-label">{r.shots.toLocaleString("en-US")} shots · simulated</span></div>
      <div className="frame-body" style={{ display: "grid", gap: 12 }}>
        {c ? <p className={s.verdict} data-v={c.verdict}>{c.line}</p>
          : <p className={s.note}>{cmpErr ?? "Type the paper's numbers above to see them side by side."}</p>}
        <div className="table-wrap">
          <table className={s.side}>
            <caption className="sr-only">This run and the paper, side by side</caption>
            <thead><tr><th scope="col"><span className="sr-only">Quantity</span></th><th scope="col">Q-Lab: {where}</th><th scope="col">Paper: arXiv {paper.arxiv_id}</th></tr></thead>
            <tbody>
              {c && c.kind !== "distribution" && (
                <tr>
                  <th scope="row">{c.kind === "fidelity" ? "Fidelity" : `P(${(c.outcomes ?? []).join(", ")})`}</th>
                  <td className="num">{fmt3(c.ours)}</td>
                  <td className="num">{fmt3(c.reported)}{c.tolerance != null && <span className={s.note}> · ±{c.tolerance.toFixed(3)} expected from shots</span>}</td>
                </tr>
              )}
              {c?.kind === "distribution" && (c.rows ?? []).map(([k, ours, theirs]) => (
                <tr key={k}>
                  <th scope="row" className="mono">{k}</th>
                  <td><Bar v={ours} /></td>
                  <td><Bar v={theirs} paper /></td>
                </tr>
              ))}
              {c?.kind === "distribution" && (
                <tr><th scope="row">Hellinger fidelity</th><td className="num" colSpan={2}>{fmt3(c.hellinger_fidelity)} between the two · total variation distance {fmt3(c.tvd)}</td></tr>
              )}
              <tr><th scope="row">Vs noiseless</th><td className="num">{r.ideal.available ? `fidelity ${fmt3(r.ideal.hellinger_fidelity)}` : r.ideal.reason}</td><td className={s.note}>—</td></tr>
            </tbody>
          </table>
        </div>
        {c?.notes.map((n) => <p key={n} className={s.note}>{n}</p>)}
        <details className={s.code}>
          <summary>All counts from this run</summary>
          <div className="table-wrap"><CountBars counts={r.counts} shots={r.shots} ideal={r.ideal.available ? r.ideal.top : undefined} /></div>
        </details>
        <p className={s.label} role="note">{r.label}</p>
        {r.snapshot && r.snapshot.gap_days !== 0 && <p className={s.note}>{r.snapshot.note}</p>}
        {r.notes.map((n) => <p key={n} className={s.note}>{n}</p>)}
        {r.mode === "calibrated" && r.noise_model && <p className={`${s.note} d-standard`}>Not modelled: {r.noise_model.not_modelled.join("; ")}.</p>}
        <p className={`${s.note} d-expert mono`}>
          {r.circuit.num_qubits} qubits · depth {r.circuit.depth} · seeds sim {r.seeds.simulator}, transpiler {r.seeds.transpiler}
          {r.snapshot ? ` · calibration ${r.snapshot.sha256.slice(0, 12)}` : ""} · {Object.entries(r.software).map(([k, v]) => `${k} ${v}`).join(" · ")} · {r.seconds.toFixed(2)} s
        </p>
      </div>
    </section>
  );
}

function Bar({ v, paper }: { v: number; paper?: boolean }) {
  return (
    <span className={s.cell}>
      <span className="num">{pct(v)}</span>
      <span className={s.track} aria-hidden="true"><span className={paper ? s.barPaper : s.bar} style={{ width: `${Math.min(100, v * 100)}%` }} /></span>
    </span>
  );
}

function SaveRun({ r, paper, qasm, origin, source, name, shots, rep }: {
  r: RunResult; paper: Paper; qasm: string; origin: string | null; source: string | null; name: string | null; shots: number; rep: unknown;
}) {
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
    const body: Record<string, unknown> = { arxiv_id: paper.arxiv_id, title: paper.title, origin, source, circuit: qasm, shots,
      project: project || null, name: name ? `${name} (arXiv ${paper.arxiv_id})` : null, seed: r.seeds.simulator };
    if (r.mode === "calibrated" && r.machine) { body.machine = r.machine; if (r.requested_date) body.date = r.requested_date; }
    if (rep) body.reported = rep;
    const x = await getJson<{ run_id: string }>("/api/v1/papers/save", { method: "POST", body: JSON.stringify(body) });
    setSt(x.ok ? { s: "saved", id: x.d.run_id } : { s: "error", msg: x.msg });
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className={s.row}>
        <label className="inst-label" htmlFor="pp-project">Project</label>
        <select id="pp-project" className="input" value={project} onChange={(e) => setProject(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">No project</option>
          {(projects ?? []).map((p) => <option key={p.slug} value={p.slug}>{p.name || p.slug}</option>)}
        </select>
        <button type="button" className="button secondary" disabled={st.s === "saving"} onClick={() => void save()}>{st.s === "saving" ? "Saving…" : "Save to Q-Lab"}</button>
        {st.s === "saved" && <Link href={`/runs/${encodeURIComponent(st.id)}`} style={{ textDecoration: "underline" }}>Saved: open the run</Link>}
        {st.s === "error" && <span className={board.err} role="alert">{st.msg}</span>}
      </div>
      <p className={s.note}>Saved as a run tagged <span className="mono">paper</span> and <span className="mono">simulated</span>, with the paper, the circuit&apos;s origin, the paper&apos;s numbers and the verdict. From the run you can share it like any other.</p>
    </div>
  );
}
