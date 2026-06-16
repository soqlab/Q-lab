"use client";
import { useState } from "react";
import { captureEnvironment, diffEnvironments, EnvironmentSnapshot, EnvDiff } from "@/lib/api";

export default function EnvironmentPage() {
  const [snapshots, setSnapshots] = useState<EnvironmentSnapshot[]>([]);
  const [diff, setDiff] = useState<EnvDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [diffA, setDiffA] = useState("");
  const [diffB, setDiffB] = useState("");

  async function capture() {
    setLoading(true); setError("");
    try {
      const snap = await captureEnvironment({});
      setSnapshots(prev => [snap, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function runDiff() {
    if (!diffA || !diffB) { setError("Select two snapshots to diff"); return; }
    setLoading(true); setError(""); setDiff(null);
    try {
      const d = await diffEnvironments({ env_id_a: diffA, env_id_b: diffB });
      setDiff(d);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const riskColor = (level: string) =>
    level === "high" ? "text-red-400" : level === "medium" ? "text-yellow-400" : "text-green-400";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Environment Snapshots</h1>
      <p className="text-gray-400">Capture your exact Python + package environment and diff between snapshots to detect reproducibility risks.</p>

      <button onClick={capture} disabled={loading}
        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
        {loading ? "Capturing..." : "Capture Current Environment"}
      </button>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {snapshots.length > 0 && (
        <div className="space-y-3">
          {snapshots.map(s => (
            <div key={s.env_id} className="bg-gray-900 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-indigo-400">{s.env_id.slice(0, 8)}</span>
                <span className="text-xs text-gray-500">{new Date(s.captured_at).toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-500">Python:</span> <span className="font-mono">{s.python_version}</span></div>
                <div><span className="text-gray-500">Qiskit:</span> <span className="font-mono">{s.qiskit_version}</span></div>
                <div><span className="text-gray-500">Packages:</span> <span>{s.packages.length}</span></div>
              </div>
              <div className="font-mono text-xs text-gray-600 truncate">hash: {s.env_hash}</div>
            </div>
          ))}
        </div>
      )}

      {snapshots.length >= 2 && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Compare Snapshots</h2>
          <div className="grid grid-cols-2 gap-3">
            {([["Snapshot A", diffA, setDiffA], ["Snapshot B", diffB, setDiffB]] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
              <div key={label}>
                <label className="text-xs text-gray-400">{label}</label>
                <select value={val} onChange={e => set(e.target.value)}
                  className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
                  <option value="">Select...</option>
                  {snapshots.map(s => <option key={s.env_id} value={s.env_id}>{s.env_id.slice(0, 8)} — {s.python_version}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={runDiff} disabled={loading}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm disabled:opacity-50">
            Compare
          </button>

          {diff && (
            <div className="space-y-3 mt-3">
              <div className="flex gap-4 text-sm">
                <span className="text-green-400">+{diff.added.length} added</span>
                <span className="text-red-400">-{diff.removed.length} removed</span>
                <span className="text-yellow-400">{diff.changed.length} changed</span>
                <span className={`ml-auto font-semibold ${riskColor(diff.risk_level)}`}>Risk: {diff.risk_level}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${diff.reproducibility_score * 100}%` }} />
              </div>
              <div className="text-xs text-gray-400">Reproducibility score: {(diff.reproducibility_score * 100).toFixed(0)}%</div>
              {diff.warnings.map((w, i) => (
                <div key={i} className="text-yellow-300 bg-yellow-900/20 rounded p-2 text-sm">{w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
