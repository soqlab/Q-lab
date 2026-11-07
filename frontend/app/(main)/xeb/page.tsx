"use client";
import { useState } from "react";
import Link from "next/link";
import { runXEB, XEBResult } from "@/lib/api";

const mono = { fontFamily: "ui-monospace,monospace" };
const cell = { padding: "6px 10px", textAlign: "left" as const };

export default function XEBPage() {
  const [runIds, setRunIds] = useState("");
  const [result, setResult] = useState<XEBResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const ids = runIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { setError("Enter at least one run ID"); return; }
    setLoading(true); setError(null); setResult(null);
    try { setResult(await runXEB(ids)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>XEB Fidelity</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0, maxWidth: 760 }}>
          Cross-entropy benchmarking of runs you recorded: linear XEB (about 1 for a perfect device, 0 for uniform
          noise) and heavy output probability, from each run&apos;s counts against the exact ideal distribution of its
          stored circuit.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Run IDs (comma or space separated; circuits up to 20 qubits)</label>
          <textarea value={runIds} onChange={(e) => setRunIds(e.target.value)} rows={3} className="input" style={mono} />
          <div>
            <button className="button" onClick={() => void run()} disabled={loading}>{loading ? "Computing…" : "Compute XEB"}</button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {result && (
        <div className="panel">
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Linear XEB (shot-weighted)</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{result.linear_xeb === null ? "n/a" : result.linear_xeb.toFixed(4)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>Heavy output probability</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{result.heavy_output_probability === null ? "n/a" : result.heavy_output_probability.toFixed(4)}</div></div>
            </div>
            {result.runs.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      {["Run", "Backend", "Bits", "Shots", "Linear XEB", "± (null SE)", "HOP", "Ideal HOP"].map((h) => (
                        <th key={h} style={{ ...cell, fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.runs.map((r) => (
                      <tr key={r.run_id} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ ...cell, ...mono }}><Link href={`/runs/${r.run_id}`}>{r.run_id}</Link></td>
                        <td style={cell}>{r.backend ?? "unknown"}</td>
                        <td style={cell}>{r.n_bits}</td>
                        <td style={cell}>{r.shots}</td>
                        <td style={cell}>{r.linear_xeb.toFixed(4)}</td>
                        <td style={cell}>{r.null_std_error.toFixed(4)}</td>
                        <td style={cell}>{r.heavy_output_probability.toFixed(4)}</td>
                        <td style={cell}>{r.ideal_heavy_output_probability.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.skipped.map((s) => (
              <div key={s.run_id} style={{ color: "var(--muted)" }}><span style={mono}>{s.run_id}</span>: {s.reason}</div>
            ))}
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Source: {result.source}</div>
          </div>
        </div>
      )}
    </main>
  );
}
