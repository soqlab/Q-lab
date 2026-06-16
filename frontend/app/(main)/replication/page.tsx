"use client";
import { useState, useEffect } from "react";
import { submitReplicationClaim, attemptReplication, listReplicationClaims, ReplicationClaim } from "@/lib/api";

export default function ReplicationPage() {
  const [claims, setClaims] = useState<ReplicationClaim[]>([]);
  const [selected, setSelected] = useState<ReplicationClaim | null>(null);
  const [showClaim, setShowClaim] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [claimForm, setClaimForm] = useState({ title: "", original_value: 0.95, metric: "fidelity", description: "", backend: "ibm_brisbane", n_qubits: 5 });
  const [attemptForm, setAttemptForm] = useState({ your_value: 0.0, notes: "" });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await listReplicationClaims();
      setClaims(r.claims);
    } catch { /* ignore */ }
  }

  async function submitClaim() {
    setLoading(true); setError("");
    try {
      await submitReplicationClaim({ title: claimForm.title, original_value: claimForm.original_value, metric: claimForm.metric, description: claimForm.description, backend: claimForm.backend, n_qubits: claimForm.n_qubits });
      setShowClaim(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function attempt() {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      await attemptReplication({ claim_id: selected.claim_id, your_value: attemptForm.your_value, notes: attemptForm.notes });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const badgeColor: Record<string, string> = {
    gold: "bg-yellow-500 text-yellow-900",
    silver: "bg-gray-400 text-gray-900",
    contested: "bg-red-700 text-red-100",
    pending: "bg-gray-700 text-gray-300",
  };

  const statusColor: Record<string, string> = {
    open: "text-blue-400",
    replicated: "text-green-400",
    contested: "text-red-400",
    failed: "text-orange-400",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Replication Market</h1>
          <p className="text-gray-400 text-sm">Track replication attempts for quantum results. Claims earn Gold/Silver/Contested badges based on independent reproductions.</p>
        </div>
        <button onClick={() => setShowClaim(!showClaim)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + New Claim
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showClaim && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <h2 className="font-semibold">New Replication Claim</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400">Claim Title</label>
              <input value={claimForm.title} onChange={e => setClaimForm(f => ({ ...f, title: e.target.value }))}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Metric</label>
              <select value={claimForm.metric} onChange={e => setClaimForm(f => ({ ...f, metric: e.target.value }))}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
                {["fidelity", "energy", "approximation_ratio", "error_rate", "t2_us"].map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-400">Original Value</label>
              <input type="number" step="any" value={claimForm.original_value} onChange={e => setClaimForm(f => ({ ...f, original_value: Number(e.target.value) }))}
                className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
            </div>
            <div>
              <label className="text-sm text-gray-400">Backend</label>
              <input value={claimForm.backend} onChange={e => setClaimForm(f => ({ ...f, backend: e.target.value }))}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
            <div className="col-span-2">
              <label className="text-sm text-gray-400">Description</label>
              <textarea value={claimForm.description} onChange={e => setClaimForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={submitClaim} disabled={loading || !claimForm.title} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Submit</button>
            <button onClick={() => setShowClaim(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase">Claims</h2>
          {claims.map(c => (
            <div key={c.claim_id} onClick={() => setSelected(c)}
              className={`bg-gray-900 rounded-lg p-3 cursor-pointer border transition-colors ${selected?.claim_id === c.claim_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-sm truncate">{c.title}</div>
                {c.badge && <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badgeColor[c.badge] ?? "bg-gray-700 text-gray-300"}`}>{c.badge}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-1 font-mono">
                {c.metric}: {c.original_value.toFixed(4)} → {c.consensus_value !== null ? c.consensus_value.toFixed(4) : "—"}
              </div>
              <div className={`text-xs mt-1 ${statusColor[c.status] ?? "text-gray-400"}`}>{c.status} · {c.replication_count} attempt{c.replication_count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gray-900 rounded-lg p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-bold text-lg">{selected.title}</h2>
                {selected.badge && (
                  <span className={`text-sm px-3 py-1 rounded-full font-bold flex-shrink-0 ${badgeColor[selected.badge] ?? "bg-gray-700"}`}>
                    {selected.badge.toUpperCase()} BADGE
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="bg-gray-800 rounded p-3 text-center">
                  <div className="text-gray-400 text-xs">Original</div>
                  <div className="font-mono font-bold text-white">{selected.original_value.toFixed(4)}</div>
                </div>
                <div className="bg-gray-800 rounded p-3 text-center">
                  <div className="text-gray-400 text-xs">Consensus</div>
                  <div className="font-mono font-bold text-indigo-400">{selected.consensus_value !== null ? selected.consensus_value.toFixed(4) : "—"}</div>
                </div>
                <div className="bg-gray-800 rounded p-3 text-center">
                  <div className="text-gray-400 text-xs">Replication Rate</div>
                  <div className={`font-medium ${selected.replication_rate > 0.7 ? "text-green-400" : "text-red-400"}`}>{(selected.replication_rate * 100).toFixed(0)}%</div>
                </div>
              </div>
              {selected.description && <div className="text-sm text-gray-300">{selected.description}</div>}
              <div className="text-xs text-gray-500">{selected.backend} · {selected.n_qubits} qubits · {selected.metric}</div>

              {selected.attempts && (selected.attempts as { your_value?: number; notes?: string }[]).length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Replication Attempts ({selected.replication_count})</h3>
                  {(selected.attempts as { your_value?: number; notes?: string; backend?: string }[]).map((a, i) => (
                    <div key={i} className="bg-gray-800 rounded p-3 flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm text-white">{a.your_value?.toFixed(4) ?? "—"}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{a.backend} · {a.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-gray-900 rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Submit Replication Attempt</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400">Your Value ({selected.metric})</label>
                  <input type="number" step="any" value={attemptForm.your_value} onChange={e => setAttemptForm(f => ({ ...f, your_value: Number(e.target.value) }))}
                    className="w-full mt-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Notes</label>
                  <input value={attemptForm.notes} onChange={e => setAttemptForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm" />
                </div>
              </div>
              <button onClick={attempt} disabled={loading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">
                Submit Attempt
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
