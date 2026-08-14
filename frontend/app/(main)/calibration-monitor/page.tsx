"use client";
import { useState, useEffect } from "react";
import { listCalibrationBackends, getCalibration, getCalibrationHistory, BackendCalibration } from "@/lib/api";

const TREND_COLORS: Record<string, string> = {
  stable: "var(--ok)",
  degrading: "var(--danger)",
  improving: "var(--info-text)",
};

function MetricBar({ value, max, label, unit }: { value: number; max: number; label: string; unit: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "ui-monospace,monospace" }}>{value.toFixed(1)}{unit}</span>
      </div>
      <div style={{ width: "100%", background: "var(--line)", borderRadius: 999, height: 5 }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: 5, borderRadius: 999, background: "var(--strong)" }} />
      </div>
    </div>
  );
}

export default function CalibrationMonitorPage() {
  const [backends, setBackends] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [cal, setCal] = useState<BackendCalibration | null>(null);
  const [history, setHistory] = useState<BackendCalibration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listCalibrationBackends()
      .then(r => {
        const bs = (r.backends as { backend: string }[]).map(b => b.backend);
        setBackends(bs);
        if (bs.length) { setSelected(bs[0]); }
      })
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    Promise.all([getCalibration(selected), getCalibrationHistory(selected, 10)])
      .then(([c, h]) => { setCal(c); setHistory(h.history); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Calibration Monitor</h1>
        {cal && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, letterSpacing: "0.04em",
            background: cal.data_source === "ibm_api" ? "var(--ok-bg)" : "var(--panel-2)",
            color: cal.data_source === "ibm_api" ? "var(--ok)" : "var(--muted)",
            border: `1px solid ${cal.data_source === "ibm_api" ? "var(--ok)" : "var(--border)"}`,
          }}>
            {cal.data_source === "ibm_api" ? "Live IBM data" : "Simulated"}
          </span>
        )}
      </div>
      <p style={{ color: "var(--muted)" }}>
        Real-time T1, T2, gate error, and readout fidelity tracking across all major backends.
        {!cal || cal.data_source !== "ibm_api" ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {" "}To see live IBM calibration,{" "}
            <a href="/settings" style={{ color: "var(--info-text, #60a5fa)", textDecoration: "underline" }}>
              connect your IBM account in Settings
            </a>.
          </span>
        ) : null}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(backends ?? []).map(b => (
          <button key={b} onClick={() => setSelected(b)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "ui-monospace,monospace",
              border: "none",
              cursor: "pointer",
              background: selected === b ? "var(--strong)" : "var(--surface)",
              color: selected === b ? "var(--text)" : "var(--muted)",
            }}>
            {b}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ color: "var(--muted)" }}>Loading calibration data...</div>}

      {cal && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {([
              ["Health Score", `${(cal.health_score * 100).toFixed(0)}%`, ""],
              ["QV", cal.qv.toString(), ""],
              ["CLOPS", cal.clops.toLocaleString(), ""],
              ["Trend", cal.trend, TREND_COLORS[cal.trend] ?? "var(--text)"],
            ] as [string, string, string][]).map(([label, val, color]) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontWeight: 600 }}>Median Metrics</h2>
            <MetricBar value={cal.median_t1_us} max={500} label="T₁" unit="μs" />
            <MetricBar value={cal.median_t2_us} max={500} label="T₂" unit="μs" />
            <MetricBar value={cal.median_1q_error * 1000} max={5} label="1Q Gate Error" unit="×10⁻³" />
            <MetricBar value={cal.median_2q_error * 100} max={5} label="2Q Gate Error" unit="%" />
            <MetricBar value={cal.median_readout_error * 100} max={10} label="Readout Error" unit="%" />
          </div>

          {(history ?? []).length > 1 && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
              <h2 style={{ fontWeight: 600, marginBottom: 12 }}>T₁ History (μs)</h2>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 96 }}>
                {(history ?? []).slice().reverse().map((h, i) => {
                  const pct = (h.median_t1_us / 400) * 100;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ width: "100%", background: "var(--strong)", borderRadius: "6px 6px 0 0", height: `${pct}%` }} title={`${h.median_t1_us.toFixed(1)}μs`} />
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>Last {history.length} calibrations</div>
            </div>
          )}

          <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontWeight: 600, marginBottom: 12 }}>Per-Qubit T₁ (μs)</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 4 }}>
              {(cal.qubits ?? []).map(q => (
                <div key={q.qubit_id}
                  style={{
                    aspectRatio: "1/1",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontFamily: "ui-monospace,monospace",
                    background: `rgba(99,102,241,${Math.min(1, q.t1_us / 400)})`,
                  }}
                  title={`Q${q.qubit_id}: T1=${q.t1_us.toFixed(0)}μs`}>
                  {q.qubit_id}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
