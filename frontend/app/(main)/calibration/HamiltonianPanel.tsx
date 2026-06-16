"use client";

import { useEffect, useState } from "react";
import { fetchHamiltonian, HamiltonianResult } from "../../../lib/api";

function CouplingMatrix({ matrix, n }: { matrix: number[][]; n: number }) {
  if (!matrix.length || n > 12) return null;
  const flat = matrix.flat();
  const maxAbs = Math.max(...flat.map(Math.abs), 1e-9);

  const color = (v: number) => {
    const t = v / maxAbs;
    if (t > 0.05) return `rgba(251,191,36,${Math.min(1, t * 1.5)})`;  // amber
    if (t < -0.05) return `rgba(139,92,246,${Math.min(1, -t * 1.5)})`; // purple
    return "rgba(63,63,70,0.5)";
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {matrix.map((row, i) => (
          <div key={i} className="flex">
            {row.map((val, j) => (
              <div
                key={j}
                title={`J[${i}][${j}] = ${val.toFixed(4)}`}
                style={{ backgroundColor: color(val), width: 28, height: 28 }}
                className="border border-zinc-800 flex items-center justify-center text-[8px] text-zinc-200"
              >
                {i !== j && Math.abs(val) > 0.001 ? val.toFixed(2) : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HamiltonianPanel({ backend }: { backend: string }) {
  const [data, setData] = useState<HamiltonianResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchHamiltonian(backend)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [backend]);

  if (err) return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
      Hamiltonian Learning: {err}
    </div>
  );
  if (!data) return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500 animate-pulse">
      Reconstructing Hamiltonian…
    </div>
  );

  const { n_qubits, local_fields, couplings, coupling_matrix, max_coupling, max_local_field, narrative, n_runs_used } = data;
  const topCouplings = [...couplings].sort((a, b) => Math.abs(b.J) - Math.abs(a.J)).slice(0, 10);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Effective Ising Hamiltonian</h3>
        <span className="text-xs text-zinc-500">{n_qubits} qubits · {n_runs_used} runs</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center text-sm">
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Max |J_ij|</p>
          <p className="font-bold text-amber-400">{max_coupling.toFixed(4)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Max |h_i|</p>
          <p className="font-bold text-purple-400">{max_local_field.toFixed(4)}</p>
        </div>
      </div>

      {coupling_matrix.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-2">Coupling matrix J_ij</p>
          <CouplingMatrix matrix={coupling_matrix} n={n_qubits} />
          <div className="flex gap-4 mt-1 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(251,191,36,0.8)" }}></span>ferromagnetic</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(139,92,246,0.8)" }}></span>antiferromagnetic</span>
          </div>
        </div>
      )}

      {topCouplings.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Strongest couplings</p>
          <div className="space-y-1">
            {topCouplings.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-400 w-16">q{c.i}–q{c.j}</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${c.J > 0 ? "bg-amber-500" : "bg-purple-500"}`}
                    style={{ width: `${Math.min(100, Math.abs(c.J) / Math.max(max_coupling, 1e-9) * 100)}%` }}
                  />
                </div>
                <span className={c.J > 0 ? "text-amber-400 w-16 text-right" : "text-purple-400 w-16 text-right"}>
                  {c.J > 0 ? "+" : ""}{c.J.toFixed(4)}
                </span>
                <span className="text-zinc-600">{c.strength}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {local_fields.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1">Local fields h_i</p>
          <div className="flex flex-wrap gap-2">
            {local_fields.map(f => (
              <span key={f.qubit} className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                q{f.qubit}: {f.h > 0 ? "+" : ""}{f.h.toFixed(3)}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400 leading-relaxed">{narrative}</p>
    </div>
  );
}
