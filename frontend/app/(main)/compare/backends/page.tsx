"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ComparableGroup, ComparisonResult, compareRecordedRuns, listComparableGroups } from "../../../../lib/api";
import { GitCompare } from "lucide-react";

const mono = { fontFamily: "ui-monospace,monospace" };
const cell = { padding: "0.5rem 0.75rem", textAlign: "left" as const };

function fmt(v: number | null, digits = 4): string {
  return v === null ? "n/a" : v.toFixed(digits);
}

export default function CompareBackendsPage() {
  const [groups, setGroups] = useState<ComparableGroup[] | null>(null);
  const [source, setSource] = useState("");
  const [runIds, setRunIds] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listComparableGroups()
      .then((r) => { setGroups(r.groups); setSource(r.source); })
      .catch((e: unknown) => { setGroups([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  async function compare(ids: string[]) {
    if (ids.length < 2) { setError("Choose at least two runs"); return; }
    setRunning(true); setError(null); setResult(null);
    try { setResult(await compareRecordedRuns(ids)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  }

  const parsed = runIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  return (
    <main className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
          <GitCompare size={24} /> Cross-Backend Comparison
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4, maxWidth: 760 }}>
          Compares what different backends actually returned for the same circuit, using runs you have already
          recorded. Nothing is submitted or simulated on a device here.
        </p>
        {source && <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Source: {source}</p>}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header"><h2>Circuits run on several backends</h2></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {groups === null && <span style={{ color: "var(--muted)" }}>Loading…</span>}
            {groups !== null && groups.length === 0 && (
              <span style={{ color: "var(--muted)" }}>
                None of your circuits has recorded runs on two or more backends yet. Run the same circuit on another
                backend with the Q-Lab SDK and it will appear here.
              </span>
            )}
            {groups?.map((g) => (
              <button key={g.circuit_key} onClick={() => { setRunIds(g.run_ids.join(", ")); void compare(g.run_ids.slice(0, 12)); }}
                style={{ textAlign: "left", background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", color: "var(--text)" }}>
                <div style={{ fontWeight: 600 }}>{g.circuit_name || <span style={mono}>{g.circuit_key.slice(0, 12)}</span>}</div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>{g.backends.join(", ")} · {g.run_ids.length} run(s)</div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel" style={{ margin: 0 }}>
          <div className="panel-header"><h2>Compare chosen runs</h2></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Run IDs (2 to 12, comma or space separated)</label>
            <textarea value={runIds} onChange={(e) => setRunIds(e.target.value)} rows={3} className="input" style={mono} />
            <div>
              <button className="button" disabled={running} onClick={() => void compare(parsed)}>
                {running ? "Comparing…" : "Compare"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="panel">
          <div className="panel-header"><h2>Results</h2></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
            {result.best_by_fidelity && (
              <div>Closest to the ideal distribution: <strong>{result.best_by_fidelity.backend ?? "unknown"}</strong>{" "}
                (<Link href={`/runs/${result.best_by_fidelity.run_id}`} style={mono}>{result.best_by_fidelity.run_id}</Link>)</div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--muted)" }}>
                    {["Run", "Backend", "Shots", "Top outcome", "Hellinger fidelity to ideal", "TVD to ideal"].map((h) => (
                      <th key={h} style={{ ...cell, fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.runs.map((r) => (
                    <tr key={r.run_id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ ...cell, ...mono }}><Link href={`/runs/${r.run_id}`}>{r.run_id}</Link></td>
                      <td style={cell}>{r.backend ?? "unknown"}</td>
                      <td style={cell}>{r.shots}</td>
                      <td style={{ ...cell, ...mono }}>{r.top_bitstring}</td>
                      <td style={cell}>{fmt(r.hellinger_fidelity_to_ideal)}</td>
                      <td style={cell}>{fmt(r.tvd_to_ideal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.pairwise_tvd.length > 0 && (
              <div>
                <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Distance between runs (TVD, 0 = identical output)</div>
                {result.pairwise_tvd.map((p) => (
                  <div key={`${p.run_a}-${p.run_b}`} style={mono}>{p.run_a.slice(0, 12)} vs {p.run_b.slice(0, 12)}: {p.tvd.toFixed(4)}</div>
                ))}
              </div>
            )}
            {result.skipped.map((s) => (
              <div key={s.run_id} style={{ color: "var(--muted)" }}><span style={mono}>{s.run_id}</span>: {s.reason}</div>
            ))}
            {result.warnings.map((w) => (
              <div key={w} style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "8px 12px" }}>{w}</div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
