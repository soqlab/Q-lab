"use client";

import { useEffect, useState } from "react";
import { fetchExperimentDesign, ExperimentDesignResult, ExperimentSuggestion } from "../../../lib/api";

function SuggestionCard({ s, rank }: { s: ExperimentSuggestion; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-full bg-indigo-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
            #{rank}
          </span>
          <div className="text-left">
            <p className="text-sm font-medium text-white">
              {s.num_qubits}q · depth {s.depth} · {s.shots.toLocaleString()} shots · opt {s.optimization_level}
            </p>
            <p className="text-xs text-zinc-400">
              Expected health: <span className="text-green-400 font-medium">{s.predicted_health.toFixed(1)}</span>
              &nbsp;±{s.uncertainty.toFixed(1)}
              &nbsp;· EI: <span className="text-indigo-400">{s.expected_improvement.toFixed(3)}</span>
            </p>
          </div>
        </div>
        <span className="text-zinc-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-zinc-800 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Configuration</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Qubits</span>
                  <span className="text-white font-medium">{s.num_qubits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Circuit Depth</span>
                  <span className="text-white font-medium">{s.depth}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Shots</span>
                  <span className="text-white font-medium">{s.shots.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Opt Level</span>
                  <span className="text-white font-medium">{s.optimization_level}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">GP Estimates</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Predicted Health</span>
                  <span className="text-green-400 font-medium">{s.predicted_health.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Uncertainty (1σ)</span>
                  <span className="text-yellow-400 font-medium">±{s.uncertainty.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Expected Improvement</span>
                  <span className="text-indigo-400 font-medium">{s.expected_improvement.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Novelty</span>
                  <span className="text-purple-400 font-medium">{s.novelty.toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-500 mb-1">Uncertainty breakdown</p>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${Math.min(100, s.predicted_health)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-600 mt-0.5">
              <span>0</span>
              <span className="text-indigo-400">{s.predicted_health.toFixed(1)}</span>
              <span>100</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExperimentDesignPage() {
  const [slug, setSlug] = useState("");
  const [n, setN] = useState(5);
  const [data, setData] = useState<ExperimentDesignResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    if (!slug.trim()) return;
    setLoading(true);
    setErr(null);
    setData(null);
    fetchExperimentDesign(slug.trim(), n)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Bayesian Experiment Design</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Gaussian Process surrogate model suggests next experiments to maximise your quantum circuit health score.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-zinc-400 block mb-1">Project slug</label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value)}
              onKeyDown={e => e.key === "Enter" && run()}
              placeholder="my-project"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="w-24">
            <label className="text-xs text-zinc-400 block mb-1">Suggestions</label>
            <select
              value={n}
              onChange={e => setN(Number(e.target.value))}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              {[3, 5, 8, 10].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={run}
              disabled={loading || !slug.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm font-medium text-white transition-colors"
            >
              {loading ? "Computing…" : "Suggest"}
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">{err}</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <p className="text-zinc-400">
              Trained on <span className="text-white font-medium">{data.n_training_runs}</span> runs · best health seen: <span className="text-green-400 font-medium">{data.best_health_seen.toFixed(1)}</span> · GP length scale: {data.length_scale.toFixed(3)}
            </p>
          </div>
          <div className="space-y-3">
            {data.suggestions.map((s, i) => (
              <SuggestionCard key={i} s={s} rank={i + 1} />
            ))}
          </div>
          <p className="text-xs text-zinc-600">{data.computed_at.slice(0, 19).replace("T", " ")} UTC</p>
        </div>
      )}
    </div>
  );
}
