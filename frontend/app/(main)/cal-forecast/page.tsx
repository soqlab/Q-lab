"use client";
import { useState } from "react";
import { forecastCalibration, CalForecast, ForecastPoint } from "@/lib/api";

function miniChart(vals: number[], color: string) {
  if (vals.length === 0) return null;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 64 }}>
      {vals.map((v, i) => {
        const pct = mx === mn ? 50 : ((v - mn) / (mx - mn)) * 100;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: "4px 4px 0 0",
              height: `${Math.max(4, pct)}%`,
              background: color,
            }}
            title={`t+${i}h: ${v.toFixed(1)} μs`}
          />
        );
      })}
    </div>
  );
}

export default function CalForecastPage() {
  const [backend, setBackend] = useState("ibm_brisbane");
  const [horizon, setHorizon] = useState(48);
  const [qubit, setQubit] = useState(0);
  const [result, setResult] = useState<CalForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await forecastCalibration({ backend, horizon_hours: horizon, qubit });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const forecastPoints: ForecastPoint[] = result?.forecasts ?? [];
  const t1Vals = forecastPoints.map(p => p.t1_predicted_us);
  const t2Vals = forecastPoints.map(p => p.t2_predicted_us);
  const lastForecast = forecastPoints[forecastPoints.length - 1];
  const t1End = lastForecast?.t1_predicted_us ?? result?.current_t1_us ?? 0;
  const t2End = lastForecast?.t2_predicted_us ?? result?.current_t2_us ?? 0;
  const t1Degrades = result ? t1End < result.current_t1_us * 0.85 : false;
  const t2Degrades = result ? t2End < result.current_t2_us * 0.85 : false;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Calibration Forecaster</h1>
      <p style={{ color: "var(--muted)" }}>ML-based T1/T2 drift forecasting. Predicts when calibration will degrade below threshold, and identifies optimal experiment windows.</p>

      <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              {["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Qubit</label>
            <input type="number" min={0} value={qubit} onChange={e => setQubit(Number(e.target.value))}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Forecast Horizon: {horizon}h</label>
            <input type="range" min={6} max={168} step={6} value={horizon} onChange={e => setHorizon(Number(e.target.value))}
              style={{ width: "100%", marginTop: 12 }} />
          </div>
        </div>
        <button onClick={run} disabled={loading} className="button"
          style={{ padding: "8px 24px", opacity: loading ? 0.5 : 1 }}>
          {loading ? "Forecasting..." : `Forecast Next ${horizon}h`}
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {([
              ["Current T1", `${result.current_t1_us.toFixed(1)} μs`, "var(--info-text)"],
              ["Current T2", `${result.current_t2_us.toFixed(1)} μs`, "#a78bfa"],
              ["Forecast T1", `${t1End.toFixed(1)} μs`, t1Degrades ? "var(--danger)" : "var(--ok)"],
              ["Forecast T2", `${t2End.toFixed(1)} μs`, t2Degrades ? "var(--danger)" : "var(--ok)"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} style={{ background: "var(--surface)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: c }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "var(--info-text)" }}>T1 Forecast</h2>
              {miniChart(t1Vals, "#60a5fa")}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              {t1Degrades && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>⚠ T1 forecast to drop {((1 - t1End / result.current_t1_us) * 100).toFixed(1)}%</div>}
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#a78bfa" }}>T2 Forecast</h2>
              {miniChart(t2Vals, "#a78bfa")}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              {t2Degrades && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>⚠ T2 forecast to drop {((1 - t2End / result.current_t2_us) * 100).toFixed(1)}%</div>}
            </div>
          </div>

          {(result.optimal_window_start || result.optimal_window_end) && (
            <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid var(--ok)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, color: "var(--ok)", marginBottom: 8 }}>Optimal Experiment Window</h2>
              <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
                <div><span style={{ color: "var(--muted)" }}>Start: </span><span style={{ fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>{result.optimal_window_start}</span></div>
                <div><span style={{ color: "var(--muted)" }}>End: </span><span style={{ fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>{result.optimal_window_end}</span></div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13 }}>Forecast Analysis</h2>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Degradation alert</span><span style={{ color: result.degradation_alert ? "var(--danger)" : "var(--ok)" }}>{result.degradation_alert ? "Yes" : "No"}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Recovery expected</span><span style={{ color: result.recovery_expected ? "var(--ok)" : "var(--muted)" }}>{result.recovery_expected ? "Yes" : "No"}</span></div>
                {result.recovery_eta_hours !== null && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Recovery ETA</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.recovery_eta_hours}h</span></div>}
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Model R²</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{result.model_r2.toFixed(3)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>Points forecast</span><span style={{ fontFamily: "ui-monospace,monospace" }}>{forecastPoints.length}</span></div>
              </div>
            </div>
            {result.recommendations && result.recommendations.length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Recommendations</h2>
                {result.recommendations.map((r, i) => <div key={i} style={{ fontSize: 13, color: "var(--text)" }}>• {r}</div>)}
              </div>
            )}
          </div>

          {forecastPoints.length > 0 && forecastPoints.some(p => p.alert_level !== "normal") && (
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16 }}>
              <h2 style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Alert Timeline</h2>
              <div style={{ display: "flex", gap: 4 }}>
                {forecastPoints.map((p, i) => {
                  const alertColor = p.alert_level === "critical" ? "#ef4444" : p.alert_level === "warning" ? "#f59e0b" : "#374151";
                  return <div key={i} style={{ flex: 1, height: 12, borderRadius: 4, background: alertColor }} title={`+${p.hours_ahead}h: ${p.alert_level}`} />;
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "#ef4444", display: "inline-block" }} /> critical</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "#f59e0b", display: "inline-block" }} /> warning</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: "var(--line)", display: "inline-block" }} /> normal</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
