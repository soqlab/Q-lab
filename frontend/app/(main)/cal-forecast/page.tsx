"use client";
import { useState } from "react";
import { forecastCalibration, CalForecast, ForecastPoint } from "@/lib/api";

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

  function miniChart(vals: number[], color: string) {
    if (vals.length === 0) return null;
    const mn = Math.min(...vals); const mx = Math.max(...vals);
    return (
      <div className="flex items-end gap-0.5 h-16">
        {vals.map((v, i) => {
          const pct = mx === mn ? 50 : ((v - mn) / (mx - mn)) * 100;
          return <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(4, pct)}%`, background: color }} title={`t+${i}h: ${v.toFixed(1)} μs`} />;
        })}
      </div>
    );
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Calibration Forecaster</h1>
      <p className="text-gray-400">ML-based T1/T2 drift forecasting. Predicts when calibration will degrade below threshold, and identifies optimal experiment windows.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400">Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Qubit</label>
            <input type="number" min={0} value={qubit} onChange={e => setQubit(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Forecast Horizon: {horizon}h</label>
            <input type="range" min={6} max={168} step={6} value={horizon} onChange={e => setHorizon(Number(e.target.value))}
              className="w-full mt-3" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Forecasting..." : `Forecast Next ${horizon}h`}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {([
              ["Current T1", `${result.current_t1_us.toFixed(1)} μs`, "text-blue-400"],
              ["Current T2", `${result.current_t2_us.toFixed(1)} μs`, "text-purple-400"],
              ["Forecast T1", `${t1End.toFixed(1)} μs`, t1Degrades ? "text-red-400" : "text-green-400"],
              ["Forecast T2", `${t2End.toFixed(1)} μs`, t2Degrades ? "text-red-400" : "text-green-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-lg font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3 text-blue-400">T1 Forecast</h2>
              {miniChart(t1Vals, "#60a5fa")}
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              {t1Degrades && <div className="text-xs text-red-400 mt-2">⚠ T1 forecast to drop {((1 - t1End / result.current_t1_us) * 100).toFixed(1)}%</div>}
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3 text-purple-400">T2 Forecast</h2>
              {miniChart(t2Vals, "#a78bfa")}
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              {t2Degrades && <div className="text-xs text-red-400 mt-2">⚠ T2 forecast to drop {((1 - t2End / result.current_t2_us) * 100).toFixed(1)}%</div>}
            </div>
          </div>

          {(result.optimal_window_start || result.optimal_window_end) && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
              <h2 className="font-semibold text-sm text-green-400 mb-2">Optimal Experiment Window</h2>
              <div className="flex gap-6 text-sm">
                <div><span className="text-gray-400">Start: </span><span className="font-mono text-green-300">{result.optimal_window_start}</span></div>
                <div><span className="text-gray-400">End: </span><span className="font-mono text-green-300">{result.optimal_window_end}</span></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4 space-y-2">
              <h2 className="font-semibold text-sm">Forecast Analysis</h2>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-400">Degradation alert</span><span className={result.degradation_alert ? "text-red-400" : "text-green-400"}>{result.degradation_alert ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Recovery expected</span><span className={result.recovery_expected ? "text-green-400" : "text-gray-400"}>{result.recovery_expected ? "Yes" : "No"}</span></div>
                {result.recovery_eta_hours !== null && <div className="flex justify-between"><span className="text-gray-400">Recovery ETA</span><span className="font-mono">{result.recovery_eta_hours}h</span></div>}
                <div className="flex justify-between"><span className="text-gray-400">Model R²</span><span className="font-mono">{result.model_r2.toFixed(3)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Points forecast</span><span className="font-mono">{forecastPoints.length}</span></div>
              </div>
            </div>
            {result.recommendations && result.recommendations.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-4 space-y-1">
                <h2 className="font-semibold text-sm mb-2">Recommendations</h2>
                {result.recommendations.map((r, i) => <div key={i} className="text-sm text-gray-300">• {r}</div>)}
              </div>
            )}
          </div>

          {forecastPoints.length > 0 && forecastPoints.some(p => p.alert_level !== "normal") && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-semibold text-sm mb-3">Alert Timeline</h2>
              <div className="flex gap-1">
                {forecastPoints.map((p, i) => {
                  const alertColor = p.alert_level === "critical" ? "#ef4444" : p.alert_level === "warning" ? "#f59e0b" : "#374151";
                  return <div key={i} className="flex-1 h-3 rounded-sm" style={{ background: alertColor }} title={`+${p.hours_ahead}h: ${p.alert_level}`} />;
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>now</span><span>+{Math.round(horizon / 2)}h</span><span>+{horizon}h</span>
              </div>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> critical</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> warning</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-700 inline-block" /> normal</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
