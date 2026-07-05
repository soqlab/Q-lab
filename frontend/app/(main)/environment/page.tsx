"use client";
import { useState } from "react";
import { captureEnvironment, diffEnvironments, EnvironmentSnapshot, EnvDiff } from "../../../lib/api";

const RISK_COLORS: Record<string, string> = {
  high:   "var(--danger)",
  medium: "var(--warn, #f59e0b)",
  low:    "var(--ok)",
};

export default function EnvironmentPage() {
  const [snapshots, setSnapshots] = useState<EnvironmentSnapshot[]>([]);
  const [diff, setDiff] = useState<EnvDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [diffA, setDiffA] = useState("");
  const [diffB, setDiffB] = useState("");

  async function capture() {
    setLoading(true); setError("");
    try {
      const snap = await captureEnvironment({});
      setSnapshots(prev => [snap, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function runDiff() {
    if (!diffA || !diffB) { setError("Select two snapshots to diff"); return; }
    setLoading(true); setError(""); setDiff(null);
    try {
      const d = await diffEnvironments({ env_id_a: diffA, env_id_b: diffB });
      setDiff(d);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Environment Snapshots</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Capture your exact Python + package environment and diff between snapshots to detect reproducibility risks.
        </p>
      </div>

      <button onClick={() => void capture()} disabled={loading} className="button" style={{ marginBottom: 16 }}>
        {loading ? "Capturing…" : "Capture Current Environment"}
      </button>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {snapshots.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {snapshots.map(s => (
            <div key={s.env_id} className="panel" style={{ margin: 0 }}>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, color: "var(--strong)", fontWeight: 600 }}>
                    {s.env_id.slice(0, 8)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {new Date(s.captured_at).toLocaleString()}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 13 }}>
                  <div><span style={{ color: "var(--muted)" }}>Python: </span><span style={{ fontFamily: "ui-monospace,monospace" }}>{s.python_version}</span></div>
                  <div><span style={{ color: "var(--muted)" }}>Qiskit: </span><span style={{ fontFamily: "ui-monospace,monospace" }}>{s.qiskit_version}</span></div>
                  <div><span style={{ color: "var(--muted)" }}>Packages: </span><span>{s.packages.length}</span></div>
                </div>
                <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  hash: {s.env_hash}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {snapshots.length >= 2 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><h2>Compare Snapshots</h2></div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {([["Snapshot A", diffA, setDiffA], ["Snapshot B", diffB, setDiffB]] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</label>
                  <select
                    value={val}
                    onChange={e => set(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                  >
                    <option value="">Select…</option>
                    {snapshots.map(s => (
                      <option key={s.env_id} value={s.env_id}>
                        {s.env_id.slice(0, 8)} — {s.python_version}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <button onClick={() => void runDiff()} disabled={loading} className="button">
                {loading ? "Comparing…" : "Compare"}
              </button>
            </div>

            {diff && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 20, fontSize: 13, alignItems: "center" }}>
                  <span style={{ color: "var(--ok)" }}>+{diff.added.length} added</span>
                  <span style={{ color: "var(--danger)" }}>-{diff.removed.length} removed</span>
                  <span style={{ color: "#f59e0b" }}>{diff.changed.length} changed</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600, color: RISK_COLORS[diff.risk_level] ?? "var(--text)" }}>
                    Risk: {diff.risk_level}
                  </span>
                </div>
                <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 6 }}>
                  <div style={{ background: "var(--ok)", height: 6, borderRadius: 999, width: `${diff.reproducibility_score * 100}%` }} />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Reproducibility score: {(diff.reproducibility_score * 100).toFixed(0)}%
                </div>
                {diff.warnings.map((w, i) => (
                  <div key={i} style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "8px 12px", color: "#f59e0b", fontSize: 13 }}>
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
