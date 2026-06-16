"use client";
import { useState } from "react";
import { runStatAnalysis, StatAnalysisResult } from "@/lib/api";

export default function StatsEnginePage() {
  const [nQubits, setNQubits] = useState(2);
  const [nShots, setNShots] = useState(8192);
  const [targetState, setTargetState] = useState("00");
  const [rawCounts, setRawCounts] = useState('{"00": 4020, "01": 180, "10": 160, "11": 3832}');
  const [nSamples, setNSamples] = useState(5);
  const [result, setResult] = useState<StatAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true); setError(""); setResult(null);
    try {
      const counts = JSON.parse(rawCounts) as Record<string, number>;
      const samples = Array.from({ length: nSamples }, (_, i) => ({
        counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.max(0, Math.round(v * (0.95 + Math.random() * 0.1)))])),
        n_shots: nShots, n_qubits: nQubits, label: `Run ${i + 1}`,
      }));
      const r = await runStatAnalysis({ samples, target_state: targetState, confidence_level: 0.95, n_bootstrap: 500 });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const Meter = ({ value, label, color = "indigo" }: { value: number; label: string; color?: string }) => (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1"><span>{label}</span><span className="font-mono">{(value * 100).toFixed(2)}%</span></div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div className={`bg-${color}-500 h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Statistical Analysis Engine</h1>
      <p className="text-gray-400">Fisher information, Cramér–Rao bounds, bootstrap CIs, Bayesian evidence, and full error budget — computed automatically on every result set.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" value={nQubits} min={1} max={10} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Shots per run</label>
            <input type="number" value={nShots} min={100} onChange={e => setNShots(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Target state</label>
            <input value={targetState} onChange={e => setTargetState(e.target.value)} placeholder="00"
              className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <div>
          <label className="text-sm text-gray-400">Measurement counts (JSON)</label>
          <textarea value={rawCounts} onChange={e => setRawCounts(e.target.value)}
            className="w-full h-20 mt-1 bg-gray-800 text-green-400 font-mono text-sm px-3 py-2 rounded border border-gray-700" />
        </div>
        <div>
          <label className="text-sm text-gray-400">Simulated samples (runs): {nSamples}</label>
          <input type="range" min={2} max={20} value={nSamples} onChange={e => setNSamples(Number(e.target.value))}
            className="w-full mt-1" />
        </div>
        <button onClick={analyze} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Analyzing..." : "Run Full Statistical Analysis"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {([
              ["Fidelity", `${(result.fidelity_mean * 100).toFixed(3)}%`, result.is_significant ? "text-green-400" : "text-yellow-400"],
              ["p-value", result.chi2_p_value.toFixed(4), result.chi2_p_value < 0.05 ? "text-green-400" : "text-red-400"],
              ["Effect Size d", result.effect_size.toFixed(3), "text-indigo-400"],
              ["Power", `${(result.power * 100).toFixed(1)}%`, result.power > 0.8 ? "text-green-400" : "text-yellow-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-xl font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-sm">Fidelity Distribution</h2>
              <Meter value={result.fidelity_mean} label="Mean fidelity" />
              <div className="text-xs text-gray-400">
                95% CI: [{(result.fidelity_ci_low * 100).toFixed(3)}%, {(result.fidelity_ci_high * 100).toFixed(3)}%]
              </div>
              <div className="text-xs text-gray-400">Bootstrap: {(result.bootstrap_mean * 100).toFixed(3)}% ± {(result.bootstrap_std * 100).toFixed(3)}%</div>
              <div className={`text-sm font-medium ${result.is_significant ? "text-green-400" : "text-yellow-400"}`}>
                {result.is_significant ? "Statistically significant (χ² test)" : "Not significant at α=0.05"}
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg p-5 space-y-3">
              <h2 className="font-semibold text-sm">Fisher Information</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">QFI:</span> <span className="font-mono">{result.fisher.qfi.toFixed(2)}</span></div>
                <div><span className="text-gray-500">CFI:</span> <span className="font-mono">{result.fisher.cfi.toFixed(2)}</span></div>
                <div><span className="text-gray-500">HL bound:</span> <span className="font-mono">{result.fisher.hl_bound.toFixed(6)}</span></div>
                <div><span className="text-gray-500">SQL bound:</span> <span className="font-mono">{result.fisher.sql_bound.toFixed(6)}</span></div>
              </div>
              <div className="flex gap-3 text-xs">
                <span className={result.fisher.beating_sql ? "text-green-400" : "text-gray-500"}>
                  {result.fisher.beating_sql ? "✓ Beats SQL" : "✗ Below SQL"}
                </span>
                <span className={result.fisher.beating_hl ? "text-yellow-400" : "text-gray-500"}>
                  {result.fisher.beating_hl ? "✓ Beats HL!" : "✗ Below HL"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-5 space-y-3">
            <h2 className="font-semibold text-sm">Error Budget</h2>
            <div className="flex gap-6 text-sm">
              <div><span className="text-gray-500">Shot noise:</span> <span className="font-mono text-blue-400">{(result.shot_variance * 1e6).toFixed(2)}×10⁻⁶</span></div>
              <div><span className="text-gray-500">Systematic:</span> <span className="font-mono text-red-400">{(result.systematic_variance * 1e6).toFixed(2)}×10⁻⁶</span></div>
              <div><span className="text-gray-500">Dominant:</span> <span className={`font-medium ${result.dominant_noise === "systematic" ? "text-red-400" : "text-blue-400"}`}>{result.dominant_noise}</span></div>
            </div>
            <div className="w-full h-4 bg-gray-700 rounded-full overflow-hidden flex">
              <div className="bg-blue-500 h-full transition-all" style={{ width: `${result.error_budget.shot_fraction * 100}%` }} />
              <div className="bg-red-500 h-full transition-all" style={{ width: `${result.error_budget.systematic_fraction * 100}%` }} />
            </div>
            <div className="flex gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Shot noise {(result.error_budget.shot_fraction * 100).toFixed(0)}%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Systematic {(result.error_budget.systematic_fraction * 100).toFixed(0)}%</span>
            </div>
          </div>

          {result.recommendations.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4 space-y-2">
              <h2 className="font-semibold text-sm">Recommendations</h2>
              {result.recommendations.map((r, i) => <div key={i} className="text-sm text-gray-300">• {r}</div>)}
              <div className="text-xs text-gray-500 mt-2">Need {result.sample_size_needed} total runs for 80% power at current effect size</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
