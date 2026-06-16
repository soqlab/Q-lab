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

export default function ErrorBudgetPage() {
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(50);
  const [backend, setBackend] = useState("ibm_brisbane");
  const [fidelity, setFidelity] = useState(0.92);
  const [result, setResult] = useState<ErrorBudgetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await analyzeErrorBudget({ n_qubits: nQubits, circuit_depth: depth, backend, measured_fidelity: fidelity });
      setResult(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const total = result ? result.total_error : 1;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Error Budget Analyzer</h1>
      <p className="text-gray-400">Break down total circuit error by source: gate errors, decoherence, readout, crosstalk, leakage. Identify the dominant bottleneck for your algorithm.</p>

      <div className="bg-gray-900 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Qubits</label>
            <input type="number" min={1} max={50} value={nQubits} onChange={e => setNQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Circuit Depth</label>
            <input type="number" min={1} value={depth} onChange={e => setDepth(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <div>
            <label className="text-sm text-gray-400">Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2"].map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Measured Fidelity</label>
            <input type="number" step="0.001" min={0} max={1} value={fidelity} onChange={e => setFidelity(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
          </div>
        </div>
        <button onClick={run} disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
          {loading ? "Analyzing..." : "Compute Error Budget"}
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([
              ["Total Error", (result.total_error * 100).toFixed(3) + "%", result.total_error < 0.01 ? "text-green-400" : result.total_error < 0.05 ? "text-yellow-400" : "text-red-400"],
              ["FT Threshold", (result.fault_tolerant_threshold * 100).toFixed(3) + "%", "text-gray-300"],
              ["Below FT", result.below_ft_threshold ? "Yes" : "No", result.below_ft_threshold ? "text-green-400" : "text-red-400"],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="bg-gray-900 rounded-lg p-4 text-center">
                <div className="text-xs text-gray-500 mb-1">{l}</div>
                <div className={`text-xl font-mono font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-4">Error Budget Breakdown</h2>
            <div className="flex h-8 rounded-full overflow-hidden mb-4">
              {result.components.map((comp: ErrorComponent) => {
                const pct = (comp.absolute_error / total) * 100;
                const color = CATEGORY_COLORS[comp.category] ?? "#6b7280";
                return <div key={comp.name} className="h-full transition-all" title={`${comp.name}: ${comp.contribution_pct.toFixed(1)}%`}
                  style={{ width: `${pct}%`, background: color }} />;
              })}
            </div>
            <div className="space-y-2">
              {[...result.components].sort((a: ErrorComponent, b: ErrorComponent) => b.absolute_error - a.absolute_error).map((comp: ErrorComponent) => (
                <div key={comp.name} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: CATEGORY_COLORS[comp.category] ?? "#6b7280" }} />
                  <div className="w-40 text-sm text-gray-300">{comp.name}</div>
                  <div className="flex-1 bg-gray-700 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{ width: `${comp.contribution_pct}%`, background: CATEGORY_COLORS[comp.category] ?? "#6b7280" }} />
                  </div>
                  <div className="text-sm font-mono w-24 text-right">
                    <span className="text-gray-300">{(comp.absolute_error * 100).toFixed(3)}%</span>
                    <span className="text-gray-500 ml-1">({comp.contribution_pct.toFixed(0)}%)</span>
                  </div>
                  {comp.mitigatable && <span className="text-xs text-green-400">mitigatable</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4 space-y-2">
              <h2 className="font-semibold text-sm">Dominant Error Source</h2>
              <div className="text-xl font-bold text-red-400">{result.dominant_error.replace(/_/g, " ")}</div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-400">Gate error</span><span className="font-mono">{(result.gate_error_total * 100).toFixed(3)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Decoherence</span><span className="font-mono">{(result.decoherence_total * 100).toFixed(3)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">SPAM</span><span className="font-mono">{(result.spam_total * 100).toFixed(3)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Leakage</span><span className="font-mono">{(result.leakage_total * 100).toFixed(3)}%</span></div>
              </div>
            </div>
            {result.recommendations && result.recommendations.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-4 space-y-2">
                <h2 className="font-semibold text-sm">Recommendations</h2>
                {result.recommendations.map((r, i) => <div key={i} className="text-sm text-gray-300">• {r}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
