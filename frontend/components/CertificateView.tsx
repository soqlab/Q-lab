"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const noSubscription = () => () => {};
import { qlabApiPath } from "../lib/api";
import {
  checkInBrowser, checkSentence, publishedKeyId, snippets,
  type BrowserCheck, type CertDoc, type CertState,
} from "../lib/certificate";

/*
 * A provenance certificate, readable: what was certified, the check this browser just ran, and how
 * to repeat that check offline. Used by the public /verified page, the owner's certificate page
 * and /certificate (check a saved file).
 */

/** Runs the check on `doc` in this browser and compares the key with the one this server publishes. */
export function useBrowserCheck(doc: CertDoc | null | undefined): BrowserCheck | null {
  const [state, setState] = useState<{ doc: CertDoc; check: BrowserCheck } | null>(null);
  useEffect(() => {
    if (!doc) return;
    let on = true;
    void Promise.all([checkInBrowser(doc), publishedKeyId()]).then(([c, key]) => {
      if (on) setState({ doc, check: c.status === "done" ? { ...c, publishedKey: key } : c });
    });
    return () => { on = false; };
  }, [doc]);
  if (!doc) return null;
  return state && state.doc === doc ? state.check : { status: "checking" };
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="button secondary" style={{ height: 30, fontSize: 12.5 }}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? "Copied" : label}
    </button>
  );
}

function Mark({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null ? "var(--muted)" : ok ? "var(--ok)" : "var(--danger)";
  return (
    <span className="mono" style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 6, color }}>
      <span className={`dot ${ok === null ? "" : ok ? "ok" : "bad"}`} aria-hidden="true" />
      {label} {ok === null ? "…" : ok ? "ok" : "FAILED"}
    </span>
  );
}

function Row({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 210px) minmax(0, 1fr)", gap: 12, padding: "7px 14px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{k}</span>
      <span className={mono ? "mono" : undefined} style={{ overflowWrap: "anywhere", fontSize: mono ? 12 : 13 }}>{v ?? "—"}</span>
    </div>
  );
}

const STATE_COLOR: Record<CertState, string> = {
  reproduced: "var(--ok)", mixed: "var(--warn)", not_reproduced: "var(--danger)", not_yet: "var(--muted)",
};

const REP_LABEL: Record<string, string> = {
  reproduced: "agreed", not_reproduced: "didn't agree", pending: "waiting for results",
  cant_test: "can't be judged", different_circuit: "different circuit",
};

/** The three sentences, one per level of the "how technical" dial. */
export function LevelSentence({ s }: { s: { plain: string; standard: string; expert: string } }) {
  return (
    <>
      <span className="d-plain-only">{s.plain}</span>
      <span className="d-standard d-not-expert">{s.standard}</span>
      <span className="d-expert">{s.expert}</span>
    </>
  );
}

export function CheckFrame({ check, doc }: { check: BrowserCheck | null; doc: CertDoc }) {
  const v = check?.status === "done" ? check.verdict : null;
  const pending = !check || check.status === "checking";
  const keyMatches = check?.status === "done" && check.publishedKey ? check.publishedKey === v?.key_id : null;
  return (
    <section className="frame" aria-labelledby="cert-check-h">
      <div className="frame-head">
        <h2 id="cert-check-h" className="inst-label">Checked in this browser</h2>
        <span className="mono" style={{ fontSize: 11, color: v?.valid ? "var(--ok)" : pending ? "var(--muted)" : "var(--danger)" }}>
          {pending ? "checking" : v?.valid ? "valid" : "not valid"}
        </span>
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 14 }}>{checkSentence(check)}</p>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Mark ok={pending ? null : v ? v.body_hash_ok : false} label="body SHA-256" />
          <Mark ok={pending ? null : v ? v.ed25519 : false} label="Ed25519" />
          <Mark ok={pending ? null : v ? v.ml_dsa_65 : false} label="ML-DSA-65" />
          {keyMatches !== null && <Mark ok={keyMatches} label="key is this server's" />}
        </div>
        <div className="d-standard" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          {doc.signature
            ? <>Signed {doc.signature.signed_at} by key <code className="mono">{doc.signature.key}</code>. Body SHA-256 <code className="mono" style={{ overflowWrap: "anywhere" }}>{doc.body_sha256}</code>.</>
            : <>Unsigned: {doc.unsigned_reason ?? "the server had no signing key"}.</>}
        </div>
        <p className="d-expert" style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
          Verified with @noble/post-quantum 0.7.1 (ML-DSA-65, FIPS 204, context &quot;qlab-provenance-certificate/1&quot;) and @noble/curves 2.4.0
          (Ed25519, RFC 8032, strict), served from this site at /vendor/qlab-pq-verify.js; the canonical-JSON rules are in /certificate-verify.js.
          A valid signature shows the body is unchanged since the key holder signed it; pin the key id to trust the signer.
        </p>
      </div>
    </section>
  );
}

export function BadgeSnippets({ token, state, badgeText }: { token: string; state: CertState; badgeText: string }) {
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  if (!origin) return null;
  const s = snippets(origin, token, state, badgeText);
  const rows: [string, string][] = [["Markdown", s.markdown], ["HTML", s.html], ["LaTeX", s.latex], ["LaTeX footnote", s.latexFootnote]];
  return (
    <section className="frame" id="badge" aria-labelledby="badge-h">
      <div className="frame-head">
        <h2 id="badge-h" className="inst-label">Badge for your paper</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/verified/${token}/badge.svg`} alt={`Q-Lab: ${badgeText}`} height={20} />
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          The badge always shows the current state, including &quot;didn&apos;t reproduce&quot;. If sharing is turned off it shows &quot;not shared&quot; and the page stops working.
          LaTeX needs <code className="mono">\usepackage{"{hyperref}"}</code>.
        </p>
        {rows.map(([label, text]) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 120px) minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
            <code className="mono" style={{ fontSize: 12, overflowWrap: "anywhere", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 4 }}>{text}</code>
            <Copy text={text} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Reproductions({ doc }: { doc: CertDoc }) {
  const r = doc.certificate.reproduction;
  return (
    <section className="frame" aria-labelledby="cert-rep-h">
      <div className="frame-head">
        <h2 id="cert-rep-h" className="inst-label">Re-runs</h2>
        <span className="mono" style={{ fontSize: 11, color: STATE_COLOR[r.state] }}>
          {r.agreed} agreed · {r.disagreed} didn&apos;t{r.pending ? ` · ${r.pending} waiting` : ""}
        </span>
      </div>
      {r.runs.length === 0 ? (
        <div className="frame-body" style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          No re-run has been compared with this run yet. A re-run uploaded with <code className="mono">qlab.init(reproduces=&quot;{doc.certificate.run.run_id}&quot;)</code> (the
          run&apos;s reproduce script does this) is compared automatically. Re-runs by other accounts count once they are shared.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead><tr><th>Result</th><th>Machine</th><th className="d-standard">TVD</th><th className="d-expert">Shot noise ≈</th><th className="d-expert">p</th><th className="d-standard">Shots</th><th>By</th><th className="d-standard">When</th></tr></thead>
            <tbody>
              {r.runs.map((x, i) => (
                <tr key={i}>
                  <td style={{ color: x.state === "reproduced" ? "var(--ok)" : x.state === "not_reproduced" ? "var(--danger)" : "var(--muted)" }}>
                    {x.exact && x.state === "reproduced" ? "agreed exactly" : REP_LABEL[x.state] ?? x.state}
                    {x.public_page && <> · <a href={x.public_page} rel="noreferrer" style={{ textDecoration: "underline" }}>open</a></>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{x.backend ?? "—"}{x.same_machine ? "" : " (other machine)"}</td>
                  <td className="mono d-standard" style={{ fontSize: 12 }}>{x.tvd ?? "—"}</td>
                  <td className="mono d-expert" style={{ fontSize: 12 }}>{x.expected_tvd ?? "—"}</td>
                  <td className="mono d-expert" style={{ fontSize: 12 }}>{x.p_value ?? "—"}</td>
                  <td className="mono d-standard" style={{ fontSize: 12 }}>{x.shots ?? "—"}</td>
                  <td style={{ fontSize: 12.5 }}>{x.by === "author" ? "the author" : "someone else"}</td>
                  <td className="mono d-standard" style={{ fontSize: 12 }}>{x.created_at?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CertificateBody({ doc }: { doc: CertDoc }) {
  const b = doc.certificate;
  const c = b.circuit;
  const rw = b.calibration.rewind_snapshot;
  const tr = Object.entries(b.settings.transpiler);
  return (
    <>
      <dl className="readouts" aria-label="Certified run">
        <div className="readout"><dt>Machine</dt><dd style={{ fontSize: 15 }}>{b.machine.backend ?? "—"}<small>{b.machine.kind}</small></dd></div>
        <div className="readout"><dt>Shots</dt><dd>{b.settings.shots ?? "—"}</dd></div>
        <div className="readout"><dt>Qubits</dt><dd>{c.num_qubits ?? "—"}</dd></div>
        <div className="readout"><dt>Calibration</dt><dd style={{ fontSize: 15 }}>{b.calibration.recorded ? (b.calibration.calibrated_at?.slice(0, 16).replace("T", " ") ?? "recorded") : "not recorded"}<small>{rw ? "matches a Rewind snapshot" : b.calibration.recorded ? "hash certified" : ""}</small></dd></div>
      </dl>

      <Reproductions doc={doc} />

      <section className="frame d-standard" aria-labelledby="cert-what-h">
        <div className="frame-head"><h2 id="cert-what-h" className="inst-label">What is certified</h2><span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{b.schema}</span></div>
        <div>
          <Row k="Run" v={b.run.run_id} />
          <Row k="Circuit name" v={b.run.circuit_name} mono={false} />
          <Row k="Ran" v={b.run.created_at} />
          <Row k="Circuit as run (QASM)" v={c.as_run.qasm_sha256 ?? (c.hash_only ? "hash-only mode: " + (c.as_run.recorded_qasm_sha256 ?? "—") : null)} />
          <Row k="Circuit given to transpile (QPY)" v={c.logical.qpy_sha256} />
          <Row k="Compiled circuit that ran (QPY)" v={c.compiled.qpy_sha256} />
          <Row k="Calibration snapshot" v={b.calibration.sha256} />
          {rw && <Row k="Rewind snapshot" v={<>{rw.sha256} <span style={{ color: "var(--muted)" }}>({rw.match === "same_calibration" ? "the same calibration" : "the calibration in effect when it ran"}, {rw.calibrated_at}; listed in the {rw.manifest_date} manifest)</span></>} />}
          <Row k="Counts" v={b.results.counts_sha256 ? <>{b.results.counts_sha256} <span style={{ color: "var(--muted)" }}>({b.results.total_shots} shots, {b.results.outcomes} outcomes)</span></> : null} />
          <Row k="Packages" v={Object.entries(b.software.versions).map(([k, v]) => `${k} ${v}`).join(", ") || null} />
          <Row k="Python" v={b.software.python} />
        </div>
      </section>

      <section className="frame d-expert" aria-labelledby="cert-more-h">
        <div className="frame-head"><h2 id="cert-more-h" className="inst-label">Settings and record</h2></div>
        <div>
          {tr.map(([k, v]) => <Row key={k} k={`transpiler ${k.replace(/_/g, " ")}`} v={Array.isArray(v) ? v.join(", ") : String(v)} />)}
          <Row k="Compiled with" v={b.settings.compiled_with} />
          <Row k="Simulator seed" v={b.settings.seed_simulator} />
          <Row k="Ran with" v={b.settings.ran_with} />
          <Row k="Circuit given to transpile (QASM)" v={c.logical.qasm_sha256} />
          <Row k="Compiled circuit (QASM)" v={c.compiled.qasm_sha256} />
          <Row k="Hash recorded by the SDK" v={c.as_run.recorded_qasm_sha256} />
          <Row k="Run record (as on /verify)" v={b.run.record_sha256} />
          <Row k="Calibration hash method" v={b.calibration.hash_method} mono={false} />
          <Row k="Issued" v={b.issued_at} />
          <Row k="Issuer commit" v={b.issuer.backend_commit} />
        </div>
        <pre className="code" style={{ margin: 0, borderTop: "1px solid var(--line)", padding: 14, maxHeight: 360 }}>{JSON.stringify(doc, null, 2)}</pre>
      </section>
    </>
  );
}

export function OfflineCheck({ fileName, keyId }: { fileName: string; keyId: string | null }) {
  const verifier = qlabApiPath("/api/v1/certificates/verify.py");
  const cmd = `pip install "cryptography>=46"\npython verify_certificate.py --file ${fileName}${keyId ? ` --key ${keyId}` : ""}`;
  return (
    <section className="frame" aria-labelledby="cert-offline-h">
      <div className="frame-head"><h2 id="cert-offline-h" className="inst-label">Check it offline</h2></div>
      <div className="frame-body" style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: "80ch" }}>
          The verifier is one Python file that uses only the standard library and <code className="mono">cryptography</code>. It recomputes the body&apos;s hash and checks both signatures;
          <span className="d-standard"> with <code className="mono">--qasm circuit.qasm</code> it also checks a circuit file against the certified hashes.</span>
        </p>
        <pre className="code" style={{ margin: 0 }}>{cmd}</pre>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="button secondary" href={verifier} download="verify_certificate.py">Download the verifier (.py)</a>
          <Copy text={cmd} label="Copy the commands" />
        </div>
      </div>
    </section>
  );
}
