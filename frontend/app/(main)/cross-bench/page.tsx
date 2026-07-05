"use client";
import { useState, useEffect } from "react";
import { listBenchmarks, compareToBenchmark, CrossBenchResult } from "@/lib/api";

export default function CrossBenchPage() {
  const [benchmarks, setBenchmarks] = useState<{ benchmark_id: string; name: string; metric: string; description: string; higher_is_better: boolean; sota_value: number }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [yourValue, setYourValue] = useState("");
  const [nQubits, setNQubits] = useState(5);
  const [backend, setBackend] = useState("ibm_brisbane");
  const [result, setResult] = useState<CrossBenchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listBenchmarks()
      .then(r => {
        const bs = r.benchmarks as { benchmark_id: string; name: string; metric: string; description: string; higher_is_better: boolean; sota_value: number }[];
        setBenchmarks(bs);
        if (bs.length) setSelectedId(bs[0].benchmark_id);
      })
      .catch(e => setError(String(e)));
  }, []);

  async function compare() {
    if (!selectedId || !yourValue) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await compareToBenchmark({ benchmark_id: selectedId, your_value: Number(yourValue), n_qubits: nQubits, backend });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const selected = benchmarks.find(b => b.benchmark_id === selectedId);

  function verdictBoxStyle(r: CrossBenchResult): React.CSSProperties {
    if (r.beats_sota) {
      return { borderRadius: 8, padding: 20, textAlign: "center", background: "rgba(245,158,11,0.12)", border: "1px solid #d97706" };
    }
    if (r.beats_classical) {
      return { borderRadius: 8, padding: 20, textAlign: "center", background: "rgba(16,185,129,0.1)", border: "1px solid var(--ok)" };
    }
    return { borderRadius: 8, padding: 20, textAlign: "center", background: "var(--surface)" };
  }

  return (
    <div style={{ padding: 24, maxWidth: 896, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Cross-Lab Benchmarking</h1>
      <p style={{ color: "var(--muted)" }}>Compare your results against published state-of-the-art benchmarks, classical bounds, and the community leaderboard.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Benchmark</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="input" style={{ width: "100%", marginTop: 4 }}>
            {(benchmarks ?? []).map(b => <option key={b.benchmark_id} value={b.benchmark_id}>{b.name}</option>)}
          </select>
          {selected && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{selected.description} · Metric: {selected.metric} · SoTA: {selected.sota_value}</p>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Your Value ({selected?.metric ?? "metric"})</label>
            <input type="number" value={yourValue} onChange={e => setYourValue(e.target.value)} step="any"
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubits</label>
            <input type="number" value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Backend</label>
            <input value={backend} onChange={e => setBackend(e.target.value)}
              className="input" style={{ width: "100%", marginTop: 4 }} />
          </div>
        </div>

        <button onClick={compare} disabled={loading} className="button"
          style={{ padding: "8px 24px", borderRadius: 6, fontWeight: 500, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer", alignSelf: "flex-start" }}>
          {loading ? "Comparing..." : "Compare to SoTA"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={verdictBoxStyle(result)}>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{result.verdict}</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Rank #{result.rank} of {result.total_entries} · {result.your_percentile.toFixed(1)}th percentile</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {([
              ["Your Value", result.your_value.toFixed(4)],
              ["SoTA", result.sota_value.toFixed(4)],
              ["Gap to SoTA", `${result.gap_to_sota_pct.toFixed(1)}%`],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontFamily: "ui-monospace,monospace", fontWeight: 600 }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>Leaderboard</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>
                    {["#", "Label", "Value", "Qubits", "Backend", "Year"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 16px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.all_entries ?? []).map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 16px", color: "var(--muted)" }}>{i + 1}</td>
                      <td style={{ padding: "8px 16px" }}>{e.label}</td>
                      <td style={{ padding: "8px 16px", fontFamily: "ui-monospace,monospace" }}>{e.value}</td>
                      <td style={{ padding: "8px 16px" }}>{e.n_qubits}</td>
                      <td style={{ padding: "8px 16px", color: "var(--muted)", fontSize: 12 }}>{e.backend}</td>
                      <td style={{ padding: "8px 16px", color: "var(--muted)" }}>{e.year}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
