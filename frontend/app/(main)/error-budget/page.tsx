"use client";
import { useState } from "react";
import { analyzeErrorBudget, ErrorBudgetReport, ErrorComponent } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  gate: "#6366f1",
  decoherence: "#ef4444",
  spam: "#f59e0b",
  measurement: "#a855f7",
  leakage: "#ec4899",
  crosstalk: "#14b8a6",
};

function getMetricColor(cls: string): string {
  if (cls.includes("green")) return "var(--ok)";
  if (cls.includes("yellow")) return "#f59e0b";
  if (cls.includes("red")) return "var(--danger)";
  return "var(--text)";
}

const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

export default function ErrorBudgetPage() {
  const [runId, setRunId] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [gateNs, setGateNs] = useState("");
  const [readout, setReadout] = useState("");
  const [result, setResult] = useState<ErrorBudgetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!runId.trim()) { setError("Enter a run ID"); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      setResult(await analyzeErrorBudget({
        run_id: runId.trim(), single_q_error_rate: num(p1), two_q_error_rate: num(p2), t1_us: num(t1),
        t2_us: num(t2), gate_time_ns: num(gateNs), readout_error: num(readout),
      }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const total = result && result.total_error > 0 ? result.total_error : 1;
  const fields: [string, string, (v: string) => void, string][] = [
    ["1-qubit gate error", p1, setP1, "e.g. 0.0003"], ["2-qubit gate error", p2, setP2, "e.g. 0.008"],
    ["T1 (us)", t1, setT1, "from calibration"], ["T2 (us)", t2, setT2, "from calibration"],
    ["Gate time (ns)", gateNs, setGateNs, "needed for T1/T2 terms"], ["Readout error", readout, setReadout, "e.g. 0.015"],
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Error Budget Analyzer</h1>
      <p style={{ color: "var(--muted)" }}>
        First-order error budget of one of your runs: gate counts and depth from its stored circuit, error rates from the
        calibration recorded with it. Fill in a field to override a recorded value or supply a missing one; anything
        neither recorded nor stated is left out, not assumed.
      </p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Run ID</label>
          <input value={runId} onChange={e => setRunId(e.target.value)} className="input"
            style={{ width: "100%", marginTop: 4, fontFamily: "ui-monospace,monospace" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}>
          {fields.map(([label, value, set, hint]) => (
            <div key={label}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>{label}</label>
              <input value={value} onChange={e => set(e.target.value)} placeholder={hint} inputMode="decimal"
                className="input" style={{ width: "100%", marginTop: 4, fontFamily: "ui-monospace,monospace" }} />
            </div>
          ))}
        </div>
        <button onClick={run} disabled={loading} className="button"
          style={{ padding: "8px 24px", opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Analyzing..." : "Compute Error Budget"}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {([
              ["Total Error", (result.total_error * 100).toFixed(3) + "%", result.total_error < 0.01 ? "text-green-400" : result.total_error < 0.05 ? "text-yellow-400" : "text-red-400"],
              ["FT Threshold", (result.fault_tolerant_threshold * 100).toFixed(3) + "%", "text-gray-300"],
              ["Below FT", result.below_ft_threshold ? "Yes" : "No", result.below_ft_threshold ? "text-green-400" : "text-red-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 20, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: getMetricColor(c) }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Error Budget Breakdown</h2>
            <div style={{ display: "flex", height: 32, borderRadius: 999, overflow: "hidden", marginBottom: 16 }}>
              {(result.components ?? []).map((comp: ErrorComponent) => {
                const pct = (comp.absolute_error / total) * 100;
                const color = CATEGORY_COLORS[comp.category] ?? "#6b7280";
                return <div key={comp.name} style={{ height: "100%", width: `${pct}%`, background: color }} title={`${comp.name}: ${comp.contribution_pct.toFixed(1)}%`} />;
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[...(result.components ?? [])].sort((a: ErrorComponent, b: ErrorComponent) => b.absolute_error - a.absolute_error).map((comp: ErrorComponent) => (
                <div key={comp.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: CATEGORY_COLORS[comp.category] ?? "#6b7280" }} />
                  <div style={{ width: 160, fontSize: 13, color: "var(--text)" }}>{comp.name}</div>
                  <div style={{ flex: 1, background: "var(--line)", borderRadius: 999, height: 8 }}>
                    <div style={{ height: 8, borderRadius: 999, width: `${comp.contribution_pct}%`, background: CATEGORY_COLORS[comp.category] ?? "#6b7280" }} />
                  </div>
                  <div style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", width: 96, textAlign: "right" }}>
                    <span style={{ color: "var(--text)" }}>{(comp.absolute_error * 100).toFixed(3)}%</span>
                    <span style={{ color: "var(--muted)", marginLeft: 4 }}>({comp.contribution_pct.toFixed(0)}%)</span>
                  </div>
                  {comp.mitigatable && <span style={{ fontSize: 12, color: "var(--ok)" }}>mitigatable</span>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>Dominant Error Source</h2>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--danger)" }}>{result.dominant_error ?? "none estimated"}</div>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Gate error</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{(result.gate_error_total * 100).toFixed(3)}%</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Decoherence</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.decoherence_total === null ? "not estimated" : `${(result.decoherence_total * 100).toFixed(3)}%`}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Readout</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.measurement_total === null ? "not estimated" : `${(result.measurement_total * 100).toFixed(3)}%`}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Gates counted</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.n_1q_gates} 1Q, {result.n_2q_gates} 2Q, depth {result.circuit_depth}</span></div>
              </div>
            </div>
            {result.recommendations && result.recommendations.length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <h2 style={{ fontWeight: 600, fontSize: 13 }}>Recommendations</h2>
                {(result.recommendations ?? []).map((r, i) => <div key={i} style={{ fontSize: 13, color: "var(--text)" }}>• {r}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
