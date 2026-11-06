"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { listEnvironmentSnapshots, diffEnvironments, EnvSnapshotSummary, EnvDiff } from "../../../lib/api";

const mono = { fontFamily: "ui-monospace,monospace" };

export default function EnvironmentPage() {
  const [snapshots, setSnapshots] = useState<EnvSnapshotSummary[] | null>(null);
  const [source, setSource] = useState("");
  const [diff, setDiff] = useState<EnvDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [diffA, setDiffA] = useState("");
  const [diffB, setDiffB] = useState("");

  useEffect(() => {
    listEnvironmentSnapshots()
      .then((r) => { setSnapshots(r.snapshots); setSource(r.source); })
      .catch((e: unknown) => { setSnapshots([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  async function runDiff() {
    if (!diffA || !diffB) { setError("Choose two runs to compare"); return; }
    setLoading(true); setError(""); setDiff(null);
    try {
      setDiff(await diffEnvironments({ run_id_a: diffA, run_id_b: diffB }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Environment Snapshots</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          The Python version, platform, git commit and package versions the Q-Lab SDK recorded with each of your runs.
          Compare two runs to see what changed between them.
        </p>
        {source && <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Source: {source}</p>}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {snapshots === null && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>}

      {snapshots !== null && snapshots.length === 0 && (
        <div className="panel" style={{ padding: "16px 20px", fontSize: 14, color: "var(--muted)" }}>
          None of your runs carries an environment record yet. Runs captured with the Q-Lab SDK record one
          automatically; set <span style={mono}>include_pip_freeze=True</span> to record every installed package.
        </div>
      )}

      {snapshots !== null && snapshots.length >= 2 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><h2>Compare two runs</h2></div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
              {([["Run A", diffA, setDiffA], ["Run B", diffB, setDiffB]] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</label>
                  <select value={val} onChange={(e) => set(e.target.value)} className="input" style={{ width: "100%" }}>
                    <option value="">Select…</option>
                    {snapshots.map((s) => (
                      <option key={s.run_id} value={s.run_id}>
                        {s.run_id.slice(0, 12)} · {s.backend ?? "?"} · Python {s.python_version ?? "?"}
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
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
                {diff.identical ? (
                  <div style={{ color: "var(--ok)" }}>The two recorded environments are identical.</div>
                ) : (
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--ok)" }}>+{diff.added.length} added</span>
                    <span style={{ color: "var(--danger)" }}>-{diff.removed.length} removed</span>
                    <span>{diff.changed.length} changed</span>
                  </div>
                )}
                {diff.changed.map((c) => (
                  <div key={c.name} style={mono}>{c.name}: {c.from} → {c.to}</div>
                ))}
                {diff.added.map((p) => <div key={`+${p.name}`} style={mono}>+ {p.name} {p.version}</div>)}
                {diff.removed.map((p) => <div key={`-${p.name}`} style={mono}>- {p.name} {p.version}</div>)}
                {diff.warnings.map((w) => (
                  <div key={w} style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {snapshots !== null && snapshots.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {snapshots.map((s) => (
            <div key={s.run_id} className="panel" style={{ margin: 0, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/runs/${s.run_id}`} style={{ ...mono, fontSize: 13, color: "var(--strong)", fontWeight: 600 }}>
                  {s.run_id}
                </Link>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {s.captured_at ? new Date(s.captured_at).toLocaleString() : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
                <span><span style={{ color: "var(--muted)" }}>Backend: </span>{s.backend ?? "unknown"}</span>
                <span><span style={{ color: "var(--muted)" }}>Python: </span><span style={mono}>{s.python_version ?? "not recorded"}</span></span>
                <span><span style={{ color: "var(--muted)" }}>Packages recorded: </span>{s.n_packages}</span>
              </div>
              {s.env_hash && <div style={{ ...mono, fontSize: 11, color: "var(--muted)" }}>hash: {s.env_hash}</div>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
