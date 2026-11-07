"use client";

import { useState, useEffect, useCallback } from "react";
import {
  certifyRuns,
  listCertifications,
  getCertification,
  type CertificationResult,
  type CertSummary,
} from "@/lib/api";

const label = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" } as const;
const mono = { fontFamily: "ui-monospace,monospace" };

function fmtP(p: number | null): string {
  if (p === null) return "n/a";
  return p < 1e-4 ? p.toExponential(2) : p.toFixed(4);
}

function CertificateView({ cert }: { cert: CertificationResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ borderRadius: 12, border: `1px solid ${cert.certified ? "var(--ok)" : "var(--danger)"}`, padding: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cert.certified ? "var(--ok)" : "var(--danger)" }}>
          {cert.certified ? "Signal certified" : "Not certified"}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{cert.name}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        {[
          ["Linear XEB", cert.linear_xeb === null ? "n/a" : cert.linear_xeb.toFixed(4)],
          ["Combined z", cert.combined_z === null ? "n/a" : cert.combined_z.toFixed(2)],
          ["p-value", fmtP(cert.p_value)],
          ["Runs evaluated", String(cert.runs.length)],
        ].map(([k, v]) => (
          <div key={k} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, textAlign: "center" }}>
            <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>{v}</p>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{k}</p>
          </div>
        ))}
      </div>

      {cert.runs.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: 6 }}>Run</th><th style={{ padding: 6 }}>Backend</th><th style={{ padding: 6 }}>Bits</th>
                <th style={{ padding: 6 }}>Shots</th><th style={{ padding: 6 }}>XEB</th><th style={{ padding: 6 }}>z</th>
              </tr>
            </thead>
            <tbody>
              {cert.runs.map((r) => (
                <tr key={r.run_id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: 6, ...mono }}>{r.run_id}</td><td style={{ padding: 6 }}>{r.backend ?? ""}</td>
                  <td style={{ padding: 6 }}>{r.n_bits}</td><td style={{ padding: 6 }}>{r.shots}</td>
                  <td style={{ padding: 6 }}>{r.linear_xeb.toFixed(4)}</td><td style={{ padding: 6 }}>{r.z_score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cert.skipped.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <div style={{ ...label, marginBottom: 6 }}>Not evaluated</div>
          {cert.skipped.map((s) => (
            <div key={s.run_id}><span style={mono}>{s.run_id}</span>: {s.reason}</div>
          ))}
        </div>
      )}

      <ul style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 18, margin: 0, fontSize: 13, color: "var(--text)" }}>
        {cert.methodology_notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Source: {cert.source}</p>
    </div>
  );
}

export default function CertifyPage() {
  const [name, setName] = useState("");
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [evidenceRunIds, setEvidenceRunIds] = useState("");
  const [certifying, setCertifying] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [shown, setShown] = useState<CertificationResult | null>(null);
  const [certsList, setCertsList] = useState<CertSummary[]>([]);
  const [certsLoading, setCertsLoading] = useState(true);

  // State is set only in the promise callbacks, so the mount effect below can call it.
  const fetchCertifications = useCallback(() =>
    listCertifications()
      .then(setCertsList)
      .catch(() => { setCertsList([]); })
      .finally(() => { setCertsLoading(false); }), []);

  const loadCertifications = useCallback(() => {
    setCertsLoading(true);
    return fetchCertifications();
  }, [fetchCertifications]);

  useEffect(() => { void fetchCertifications(); }, [fetchCertifications]);

  async function handleCertify(e: React.FormEvent) {
    e.preventDefault();
    setCertifying(true); setCertError(null); setShown(null);
    try {
      setShown(await certifyRuns({
        name,
        confidence_level: confidenceLevel,
        evidence_run_ids: evidenceRunIds.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean),
      }));
      void loadCertifications();
    } catch (err) {
      setCertError(err instanceof Error ? err.message : "Certification failed.");
    } finally {
      setCertifying(false);
    }
  }

  async function open(certId: string) {
    try { setShown(await getCertification(certId)); } catch { setCertError("Could not load that certificate."); }
  }

  return (
    <main style={{ minHeight: "100vh", color: "var(--text)", padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>XEB Certifier</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, maxWidth: 720 }}>
          Tests whether your runs&apos; measured counts carry the ideal circuit&apos;s signal or could be uniform noise.
          Each run&apos;s counts are scored with the linear cross-entropy benchmark against the exact ideal distribution
          of its stored circuit. This certifies fidelity to the circuit, not a quantum advantage.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>New certificate</h2>
            <form onSubmit={handleCertify} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={label}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="GHZ-5 on ibm_brisbane" className="input" required />
              </div>
              <div>
                <label style={label}>Run IDs (comma or space separated)</label>
                <textarea value={evidenceRunIds} onChange={(e) => setEvidenceRunIds(e.target.value)} className="input" rows={3} required style={mono} />
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Each run needs a stored circuit (QASM) and recorded counts; circuits up to 20 qubits.
                </p>
              </div>
              <div>
                <label style={label}>Confidence level</label>
                <select value={confidenceLevel} onChange={(e) => setConfidenceLevel(Number(e.target.value))} className="input">
                  <option value={0.9}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                  <option value={0.999}>99.9%</option>
                </select>
              </div>
              {certError && <div style={{ color: "var(--danger)", fontSize: 13 }}>{certError}</div>}
              <button type="submit" className="button" disabled={certifying}>
                {certifying ? "Computing…" : "Certify"}
              </button>
            </form>
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Your certificates</h2>
            {certsLoading ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
            ) : certsList.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>None yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {certsList.map((c) => (
                  <button key={c.cert_id} onClick={() => void open(c.cert_id)}
                    style={{ textAlign: "left", background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", color: "var(--text)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span style={{ color: c.certified ? "var(--ok)" : "var(--danger)", fontSize: 12 }}>{c.certified ? "Certified" : "Not certified"}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      XEB {c.linear_xeb === null ? "n/a" : c.linear_xeb.toFixed(4)} · p {fmtP(c.p_value)} · {c.n_runs} run(s) · {new Date(c.created_at).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>{shown && <CertificateView cert={shown} />}</div>
      </div>
    </main>
  );
}
