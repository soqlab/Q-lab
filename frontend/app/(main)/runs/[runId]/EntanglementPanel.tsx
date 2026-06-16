"use client";

import { useEffect, useState } from "react";
import { fetchEntanglementCert, EntanglementResult } from "../../../../lib/api";

const TIER_COLOR: Record<string, string> = {
  "strongly entangled": "text-green-400 bg-green-900/30 border-green-700",
  "moderately entangled": "text-blue-400 bg-blue-900/30 border-blue-700",
  "weakly correlated": "text-yellow-400 bg-yellow-900/30 border-yellow-700",
  "no detected correlations": "text-zinc-400 bg-zinc-800 border-zinc-700",
};

function MIMatrix({ matrix, n }: { matrix: number[][]; n: number }) {
  if (!matrix.length || n > 12) return <p className="text-xs text-zinc-500">Matrix too large to display ({n}×{n})</p>;
  const flat = matrix.flat();
  const maxVal = Math.max(...flat, 1e-9);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {matrix.map((row, i) => (
          <div key={i} className="flex">
            {row.map((val, j) => {
              const intensity = val / maxVal;
              return (
                <div
                  key={j}
                  title={`MI[${i}][${j}] = ${val.toFixed(3)} bits`}
                  style={{
                    backgroundColor: i === j ? "transparent" : `rgba(96,165,250,${intensity * 0.9})`,
                    width: 26, height: 26,
                  }}
                  className="border border-zinc-800 flex items-center justify-center text-[8px] text-white"
                >
                  {i !== j && val > 0.01 ? val.toFixed(2) : i === j ? <span className="text-zinc-700">·</span> : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EntanglementPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<EntanglementResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"mi" | "corr">("mi");

  useEffect(() => {
    fetchEntanglementCert(runId)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [runId]);

  if (err) return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
      Entanglement Cert: {err}
    </div>
  );
  if (!data) return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500 animate-pulse">
      Certifying entanglement…
    </div>
  );

  const {
    n_qubits, n_bitstrings, total_entropy_bits, max_entropy_bits,
    entanglement_score, tier, is_gme_candidate, min_bipartite_mi,
    schmidt_rank_lb, pairwise_mi, mi_matrix, correlation_matrix, narrative,
  } = data;

  const tierCls = TIER_COLOR[tier] ?? TIER_COLOR["no detected correlations"];

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-semibold text-white text-sm">Entanglement Certification</h3>
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${tierCls} shrink-0`}>
          {tier}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
        <div className="bg-zinc-800 rounded-lg p-2">
          <p className="text-xs text-zinc-400 mb-1">Score</p>
          <p className="font-bold text-blue-400">{(entanglement_score * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-2">
          <p className="text-xs text-zinc-400 mb-1">Entropy</p>
          <p className="font-bold text-white">{total_entropy_bits.toFixed(2)}/{max_entropy_bits}b</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-2">
          <p className="text-xs text-zinc-400 mb-1">GME</p>
          <p className={`font-bold ${is_gme_candidate ? "text-green-400" : "text-zinc-500"}`}>
            {is_gme_candidate ? "Likely" : "N/A"}
          </p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-2">
          <p className="text-xs text-zinc-400 mb-1">Schmidt ≥</p>
          <p className="font-bold text-purple-400">{schmidt_rank_lb}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs text-zinc-500 mr-2">Matrix:</p>
          <button
            onClick={() => setView("mi")}
            className={`text-xs px-2 py-0.5 rounded ${view === "mi" ? "bg-blue-700 text-white" : "text-zinc-400 hover:text-white"}`}
          >
            Mutual Information
          </button>
          <button
            onClick={() => setView("corr")}
            className={`text-xs px-2 py-0.5 rounded ${view === "corr" ? "bg-blue-700 text-white" : "text-zinc-400 hover:text-white"}`}
          >
            Correlations
          </button>
        </div>
        <MIMatrix matrix={view === "mi" ? mi_matrix : correlation_matrix} n={n_qubits} />
      </div>

      {pairwise_mi.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Top pairwise mutual information</p>
          <div className="space-y-1">
            {pairwise_mi.slice(0, 8).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-400 w-12">q{p.i}–q{p.j}</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, p.mi * 100)}%` }} />
                </div>
                <span className="text-blue-400 w-16 text-right">{p.mi.toFixed(3)} bits</span>
                <span className="text-zinc-600">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400 leading-relaxed">{narrative}</p>
      <p className="text-xs text-zinc-600">{n_qubits}q · {n_bitstrings} bitstrings · {data.computed_at.slice(0, 19).replace("T", " ")} UTC</p>
    </div>
  );
}
