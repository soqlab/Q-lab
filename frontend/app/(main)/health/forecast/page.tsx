"use client";
import { useEffect, useState } from "react";
import { HealthMetricForecast, HealthForecastResponse, createHealthForecast, listHealthForecasts } from "../../../../lib/api";
import { HeartPulse, RefreshCw, AlertTriangle } from "lucide-react";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ibm_sherbrooke", "simulator_statevector"];
const METRICS = ["t1", "t2", "gate_error", "readout_error"];
const METRIC_LABELS: Record<string, { label: string; unit: string; goodDir: "up" | "down" }> = {
  t1:           { label: "T1 Relaxation",  unit: "µs", goodDir: "up" },
  t2:           { label: "T2 Dephasing",   unit: "µs", goodDir: "up" },
  gate_error:   { label: "Gate Error",     unit: "",   goodDir: "down" },
  readout_error:{ label: "Readout Error",  unit: "",   goodDir: "down" },
};
const RISK_COLORS: Record<string, string> = {
  low: "#10b981", medium: "#f59e0b", high: "#f97316", critical: "#ef4444", unknown: "#475569",
};

function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLORS[level] ?? "#475569";
  return (
    <span style={{ fontSize: "0.72rem", fontWeight: 700, color, background: color + "22", border: `1px solid ${color}40`, borderRadius: 4, padding: "1px 6px", textTransform: "uppercase" }}>
      {level}
    </span>
  );
}

function ForecastCard({ f }: { f: HealthMetricForecast }) {
  const info = METRIC_LABELS[f.metric] ?? { label: f.metric, unit: "", goodDir: "up" as const };
  const slope = f.trend_slope ?? 0;
  const improving = (info.goodDir === "up" && slope > 0) || (info.goodDir === "down" && slope < 0);
  const W = 280; const H = 80; const PAD = 20;
  const series = f.series.slice(-24);
  const vals = series.map(s => s.value);
  const allVals = [...vals, f.forecast_72h ?? 0].filter(v => v !== null) as number[];
  const yMin = Math.min(...allVals) * 0.9;
  const yMax = (Math.max(...allVals) * 1.1) || 1;
  const xMax = (series[series.length - 1]?.hours_offset ?? 0) + 72;
  const px = (x: number) => PAD + (x / xMax) * (W - PAD * 2);
  const py = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);
  const seriesPts = series.map(s => `${px(s.hours_offset)},${py(s.value)}`).join(" ");
  const lastX = series[series.length - 1]?.hours_offset ?? 0;
  const lastY = series[series.length - 1]?.value ?? (f.current_value ?? 0);

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${RISK_COLORS[f.risk_level] ?? "#334155"}40`, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{info.label}</span>
        <RiskBadge level={f.risk_level} />
      </div>
      <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: 8 }}>
        {f.data_points} data points · {improving
          ? <span style={{ color: "#10b981" }}>↑ Improving</span>
          : <span style={{ color: "#ef4444" }}>↓ Degrading</span>}
        {f.r2 != null && <> · R²={f.r2.toFixed(3)}</>}
      </div>

      {series.length > 1 ? (
        <svg width={W} height={H} style={{ display: "block", width: "100%" }}>
          <polyline points={seriesPts} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
          {f.forecast_24h != null && <circle cx={px(lastX + 24)} cy={py(f.forecast_24h)} r={3} fill="#f59e0b" />}
          {f.forecast_48h != null && <circle cx={px(lastX + 48)} cy={py(f.forecast_48h)} r={3} fill="#f97316" />}
          {f.forecast_72h != null && <circle cx={px(lastX + 72)} cy={py(f.forecast_72h)} r={3} fill="#ef4444" />}
          {f.forecast_72h != null && (
            <line x1={px(lastX)} y1={py(lastY)} x2={px(lastX + 72)} y2={py(f.forecast_72h)}
              stroke="#475569" strokeWidth={1} strokeDasharray="3 2" />
          )}
        </svg>
      ) : (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "0.8rem" }}>No historical data</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: 8 }}>
        {[
          { label: "Now",  value: f.current_value,  color: "#3b82f6" },
          { label: "+24h", value: f.forecast_24h,   color: "#f59e0b" },
          { label: "+48h", value: f.forecast_48h,   color: "#f97316" },
          { label: "+72h", value: f.forecast_72h,   color: "#ef4444" },
        ].map(p => (
          <div key={p.label} style={{ background: "#0f172a", borderRadius: 6, padding: "0.3rem", textAlign: "center" }}>
            <div style={{ color: "#475569", fontSize: "0.65rem" }}>{p.label}</div>
            <div style={{ color: p.color, fontWeight: 700, fontSize: "0.82rem" }}>
              {p.value != null ? `${p.value.toFixed(3)}${info.unit}` : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HealthForecastPage() {
  const [backend, setBackend] = useState("ibm_brisbane");
  const [days, setDays] = useState(30);
  const [response, setResponse] = useState<HealthForecastResponse | null>(null);
  const [history, setHistory] = useState<HealthMetricForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listHealthForecasts().then(setHistory).catch(() => {}); }, []);

  const handleForecast = async () => {
    setLoading(true); setError(null);
    try {
      const r = await createHealthForecast({ backend, metrics: METRICS, days });
      setResponse(r);
      setHistory(prev => [...r.forecasts, ...prev].slice(0, 50));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const forecasts = response?.forecasts ?? [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <HeartPulse size={28} color="#3b82f6" /> Predictive Hardware Health Oracle
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          ML regression on T1/T2 calibration history forecasts hardware degradation 24–72 hours ahead. No quantum platform does this today.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Backend
            <select value={backend} onChange={e => setBackend(e.target.value)}
              style={{ display: "block", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            History window: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{days} days</span>
            <input type="range" min={7} max={90} step={7} value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ display: "block", marginTop: 4, width: 160, accentColor: "#3b82f6" }} />
          </label>
          <button onClick={handleForecast} disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem 1.3rem", cursor: "pointer", fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <RefreshCw size={15} /> {loading ? "Forecasting…" : "Run Forecast"}
          </button>

          {response && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: RISK_COLORS[response.overall_risk] + "18", border: `1px solid ${RISK_COLORS[response.overall_risk]}40`, borderRadius: 8, padding: "0.5rem 1rem" }}>
              <AlertTriangle size={16} color={RISK_COLORS[response.overall_risk]} />
              <span style={{ color: RISK_COLORS[response.overall_risk], fontWeight: 700 }}>Overall 72h Risk: {response.overall_risk.toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

      {forecasts.length > 0 && (
        <div>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>{backend} — 72-hour forecast</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            {forecasts.map(f => <ForecastCard key={f.metric} f={f} />)}
          </div>
        </div>
      )}

      {history.length > 0 && forecasts.length === 0 && (
        <div>
          <h3 style={{ color: "#94a3b8", fontWeight: 600, marginBottom: "1rem" }}>Recent Forecast History</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.slice(0, 12).map((f, i) => (
              <div key={i} style={{ background: "#1e293b", borderRadius: 8, border: "1px solid #334155", padding: "0.6rem 1rem", display: "flex", alignItems: "center", gap: "1.5rem" }}>
                <span style={{ color: "#e2e8f0", fontSize: "0.85rem", width: 120 }}>{METRIC_LABELS[f.metric]?.label ?? f.metric}</span>
                <span style={{ color: "#64748b", fontSize: "0.8rem", flex: 1 }}>{f.backend}</span>
                <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>Now: {f.current_value?.toFixed(3) ?? "—"}</span>
                <span style={{ color: "#ef4444", fontSize: "0.8rem" }}>+72h: {f.forecast_72h?.toFixed(3) ?? "—"}</span>
                <RiskBadge level={f.risk_level} />
              </div>
            ))}
          </div>
        </div>
      )}

      {forecasts.length === 0 && history.length === 0 && !loading && (
        <div style={{ textAlign: "center", color: "#475569", padding: "4rem" }}>
          <HeartPulse size={48} style={{ opacity: 0.15, marginBottom: 12 }} />
          <p>Select a backend and run a forecast to predict hardware health 72 hours ahead.</p>
          <p style={{ fontSize: "0.85rem", marginTop: 4 }}>Requires calibration data from historical runs on the selected backend.</p>
        </div>
      )}
    </div>
  );
}
