"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { qlabApiPath } from "../../../lib/api";
import { commitUrl, FRONTEND_COMMIT, shortSha } from "../../../lib/build";
import s from "../../landing.module.css";

/*
 * Verify this run. Each check names what it compared, and passes, fails, or can't be made (and
 * why). Nothing on this page asks you to take the dashboard's word: the record's SHA-256 can be
 * recomputed from the downloaded record with the one-line command shown, and the server's commit
 * links to its source.
 */

type Check = { id: string; title: string; status: "pass" | "fail" | "cant"; detail: string };
type Verify = {
  run_id: string; record_sha256: string; record: Record<string, unknown>; how_to_recompute: string;
  checks: Check[]; checked_by: { commit: string | null; source: string }; passed: boolean;
};

const MARK: Record<Check["status"], { label: string; dot: string }> = {
  pass: { label: "PASS", dot: "ok" },
  fail: { label: "FAIL", dot: "bad" },
  cant: { label: "CAN'T CHECK", dot: "" },
};

export default function VerifyPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [v, setV] = useState<{ id: string; state: "ok" | "missing" | "error"; data?: Verify } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/verify`), { cache: "no-store" })
      .then(async (r) => {
        if (!on) return;
        if (r.status === 404) return setV({ id: runId, state: "missing" });
        if (!r.ok) return setV({ id: runId, state: "error" });
        setV({ id: runId, state: "ok", data: await r.json() });
      })
      .catch(() => { if (on) setV({ id: runId, state: "error" }); });
    return () => { on = false; };
  }, [runId]);

  const d = v?.id === runId ? v.data : undefined;
  const fails = d?.checks.filter((c) => c.status === "fail").length ?? 0;
  const passes = d?.checks.filter((c) => c.status === "pass").length ?? 0;
  const cants = d?.checks.filter((c) => c.status === "cant").length ?? 0;
  const summary = !v || v.id !== runId ? "Checking this run's record…"
    : v.state === "missing" ? "This run isn't one you can open. Runs are private: sign in as its owner, or ask for its share link."
    : v.state === "error" || !d ? "The checks couldn't be run right now."
    : fails ? `${fails} of ${d.checks.length} checks failed: this run's record is not internally consistent. Details below.`
    : `${passes} of ${d.checks.length} checks passed${cants ? `, ${cants} couldn't be made with what was recorded` : ""}. Nothing in this run's record contradicts itself.`;

  function download() {
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "verify.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className={s.root}>
      <header className={s.bar}>
        <Link href="/" className={s.word}>Q-LAB</Link>
        <span className={s.host}>verify a run</span>
        <nav className={s.links} aria-label="Q-Lab">
          <Link href="/trust">Trust</Link>
          <Link href={`/runs/${encodeURIComponent(runId)}`} className={s.primary}>Open the run</Link>
        </nav>
      </header>
      <main className={s.main}>
        <p className="summary-line">{summary}</p>
        {d && (
          <>
            <section className="frame" aria-labelledby="checks-h">
              <div className="frame-head">
                <h2 id="checks-h" className="inst-label">Checks on run {d.run_id.slice(0, 16)}</h2>
                <span className="mono" style={{ fontSize: 11, color: d.passed ? "var(--ok)" : "var(--danger)" }}>{d.passed ? "consistent" : "inconsistent"}</span>
              </div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {d.checks.map((c) => (
                  <li key={c.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: "4px 12px" }}>
                    <span className="mono" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6, color: c.status === "fail" ? "var(--danger)" : c.status === "pass" ? "var(--ok)" : "var(--muted)" }}>
                      <span className={`dot ${MARK[c.status].dot}`} aria-hidden="true" />{MARK[c.status].label}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</span>
                    <span />
                    <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55, overflowWrap: "anywhere" }}>{c.detail}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="frame" aria-labelledby="rec-h">
              <div className="frame-head"><h2 id="rec-h" className="inst-label">Check it yourself</h2></div>
              <div className="frame-body" style={{ display: "grid", gap: 10 }}>
                <p className={s.p} style={{ margin: 0 }}>
                  The run&apos;s record has this SHA-256. Download the record and run the command below on your own machine: it must print the same value. If anyone changes the run later, the value changes.
                </p>
                <code className="mono" style={{ fontSize: 13, overflowWrap: "anywhere", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 4 }}>{d.record_sha256}</code>
                <pre className="code" style={{ margin: 0 }}>{d.how_to_recompute}</pre>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="button" type="button" onClick={download}>Download the record (verify.json)</button>
                  <button className="button secondary" type="button" onClick={() => { void navigator.clipboard.writeText(d.how_to_recompute).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                    {copied ? "Copied" : "Copy the command"}
                  </button>
                  <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/bundle.zip`)}>Reproduction bundle (.zip)</a>
                </div>
              </div>
            </section>

            <dl className="readouts">
              <div className="readout">
                <dt>Checked by backend</dt>
                <dd>{d.checked_by.commit ? <a href={commitUrl(d.checked_by.commit)} rel="noreferrer">{shortSha(d.checked_by.commit)}</a> : "—"}
                  <small>{d.checked_by.commit ? "the source of these checks" : "the server doesn't know its commit"}</small></dd>
              </div>
              <div className="readout">
                <dt>This page</dt>
                <dd>{FRONTEND_COMMIT ? <a href={commitUrl(FRONTEND_COMMIT)} rel="noreferrer">{shortSha(FRONTEND_COMMIT)}</a> : "—"}
                  <small>dashboard commit</small></dd>
              </div>
            </dl>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: "80ch" }}>
              What this does not show: that the counts came from the machine named. Only a hardware-board run is tied to a job this server submitted to IBM itself; any other run&apos;s results are what the uploader&apos;s SDK sent.
            </p>
          </>
        )}
      </main>
      <footer className={s.foot}>
        <Link href={`/runs/${encodeURIComponent(runId)}`}>The run</Link>
        <Link href="/trust">What this Q-Lab runs and loads</Link>
      </footer>
    </div>
  );
}
