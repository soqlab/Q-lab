"use client";
import { useState, useEffect } from "react";
import { listCalibrationBackends, getCalibration, getCalibrationHistory, BackendCalibration } from "@/lib/api";

const TREND_COLORS: Record<string, string> = {
  stable: "text-green-400",
  degrading: "text-red-400",
  improving: "text-blue-400",
};

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

  const MetricBar = ({ value, max, label, unit }: { value: number; max: number; label: string; unit: string }) => (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span><span className="font-mono">{value.toFixed(1)}{unit}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Calibration Monitor</h1>
      <p className="text-gray-400">Real-time T1, T2, gate error, and readout fidelity tracking across all major backends.</p>

      <div className="flex gap-2 flex-wrap">
        {backends.map(b => (
          <button key={b} onClick={() => setSelected(b)}
            className={`px-3 py-1.5 rounded text-sm font-mono transition-colors ${selected === b ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            {b}
          </button>
        ))}
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}
      {loading && <div className="text-gray-400">Loading calibration data...</div>}

      {cal && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {([
              ["Health Score", `${(cal.health_score * 100).toFixed(0)}%`, ""],
              ["QV", cal.qv.toString(), ""],
              ["CLOPS", cal.clops.toLocaleString(), ""],
              ["Trend", cal.trend, TREND_COLORS[cal.trend] ?? "text-gray-400"],
            ] as [string, string, string][]).map(([label, val, color]) => (
              <div key={label} className="bg-gray-900 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase">{label}</div>
                <div className={`text-xl font-bold mt-1 ${color || "text-white"}`}>{val}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg p-5 space-y-4">
            <h2 className="font-semibold">Median Metrics</h2>
            <MetricBar value={cal.median_t1_us} max={500} label="T₁" unit="μs" />
            <MetricBar value={cal.median_t2_us} max={500} label="T₂" unit="μs" />
            <MetricBar value={cal.median_1q_error * 1000} max={5} label="1Q Gate Error" unit="×10⁻³" />
            <MetricBar value={cal.median_2q_error * 100} max={5} label="2Q Gate Error" unit="%" />
            <MetricBar value={cal.median_readout_error * 100} max={10} label="Readout Error" unit="%" />
          </div>

          {history.length > 1 && (
            <div className="bg-gray-900 rounded-lg p-5">
              <h2 className="font-semibold mb-3">T₁ History (μs)</h2>
              <div className="flex items-end gap-1 h-24">
                {history.slice().reverse().map((h, i) => {
                  const pct = (h.median_t1_us / 400) * 100;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${pct}%` }} title={`${h.median_t1_us.toFixed(1)}μs`} />
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-gray-500 mt-1 text-center">Last {history.length} calibrations</div>
            </div>
          )}

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold mb-3">Per-Qubit T₁ (μs)</h2>
            <div className="grid grid-cols-8 gap-1">
              {cal.qubits.map(q => (
                <div key={q.qubit_id} className="aspect-square rounded flex items-center justify-center text-xs font-mono"
                  style={{ background: `rgba(99,102,241,${Math.min(1, q.t1_us / 400)})` }}
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
