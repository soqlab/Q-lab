"use client";
import { useState, useEffect } from "react";
import { listHypotheses, createHypothesis, updateHypothesis, Hypothesis } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-gray-700 text-gray-300",
  testing: "bg-blue-900 text-blue-300",
  supported: "bg-green-900 text-green-300",
  refuted: "bg-red-900 text-red-300",
  inconclusive: "bg-yellow-900 text-yellow-300",
};

export default function HypothesesPage() {
  const [hyps, setHyps] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [prediction, setPrediction] = useState("");
  const [selected, setSelected] = useState<Hypothesis | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await listHypotheses();
      setHyps(r.hypotheses);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function submit() {
    if (!title || !statement) return;
    try {
      await createHypothesis({ title, statement, prediction });
      setTitle(""); setStatement(""); setPrediction(""); setShowForm(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function advance(hyp: Hypothesis) {
    const nextStatus: Record<string, string> = { proposed: "testing", testing: "supported" };
    const next = nextStatus[hyp.status];
    if (!next) return;
    try {
      await updateHypothesis(hyp.hyp_id, { status: next });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading hypotheses...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hypotheses Tracker</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
          + New Hypothesis
        </button>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showForm && (
        <div className="bg-gray-900 rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Formulate Hypothesis</h2>
          <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <textarea placeholder="Statement (falsifiable claim)" value={statement} onChange={e => setStatement(e.target.value)}
            className="w-full h-24 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <textarea placeholder="Prediction (what we expect to observe)" value={prediction} onChange={e => setPrediction(e.target.value)}
            className="w-full h-20 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <div className="flex gap-3">
            <button onClick={submit} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm">Create</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {hyps.map(h => (
          <div key={h.hyp_id}
            className={`bg-gray-900 rounded-lg p-5 cursor-pointer border transition-colors ${selected?.hyp_id === h.hyp_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}
            onClick={() => setSelected(selected?.hyp_id === h.hyp_id ? null : h)}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[h.status] ?? "bg-gray-700 text-gray-300"}`}>
                    {h.status}
                  </span>
                  <span className="font-semibold">{h.title}</span>
                </div>
                <p className="text-gray-400 text-sm">{h.statement}</p>
              </div>
              <div className="text-right text-sm">
                <div className="text-indigo-400 font-mono">{(h.confidence * 100).toFixed(0)}%</div>
                <div className="text-xs text-gray-500">confidence</div>
              </div>
            </div>

            {selected?.hyp_id === h.hyp_id && (
              <div className="mt-4 space-y-3 border-t border-gray-700 pt-4">
                {h.prediction && <div className="text-sm"><span className="text-gray-500">Prediction: </span>{h.prediction}</div>}
                {h.null_hypothesis && <div className="text-sm"><span className="text-gray-500">Null: </span>{h.null_hypothesis}</div>}
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400">For: {h.evidence_for.length}</span>
                  <span className="text-red-400">Against: {h.evidence_against.length}</span>
                  <span className="text-blue-400">Runs: {h.linked_run_ids.length}</span>
                </div>
                {h.status === "proposed" || h.status === "testing" ? (
                  <button onClick={e => { e.stopPropagation(); advance(h); }}
                    className="px-3 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs">
                    Advance to {h.status === "proposed" ? "Testing" : "Supported"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
