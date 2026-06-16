"use client";

import { useEffect, useState } from "react";
import { fetchPassiveRB, PassiveRBResult } from "../../../lib/api";

function SparkChart({ raw, fitted }: { raw: { d: number; f: number }[]; fitted: { d: number; f: number }[] }) {
  if (!raw.length) return null;
  const allY = [...raw.map(p => p.f), ...fitted.map(p => p.f)];
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const allX = [...raw.map(p => p.d), ...fitted.map(p => p.d)];
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const W = 400, H = 120, PAD = 12;
  const px = (d: number) => PAD + ((d - minX) / Math.max(1, maxX - minX)) * (W - 2 * PAD);
  const py = (f: number) => H - PAD - ((f - minY) / Math.max(1e-9, maxY - minY)) * (H - 2 * PAD);
  const rawPath = raw.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.d)},${py(p.f)}`).join(" ");
  const fitPath = fitted.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.d)},${py(p.f)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28 mt-2">
      <path d={rawPath} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4,2" />
      <path d={fitPath} fill="none" stroke="#34d399" strokeWidth={2} />
      {raw.map((p, i) => <circle key={i} cx={px(p.d)} cy={py(p.f)} r={2.5} fill="#60a5fa" />)}
    </svg>
  );
}

const TREND_BADGE: Record<string, string> = {
  improving: "bg-green-900 text-green-300",
  stable: "bg-yellow-900 text-yellow-300",
  degrading: "bg-red-900 text-red-300",
  insufficient_data: "bg-zinc-700 text-zinc-400",
};

export default function PassiveRBPanel({ backend }: { backend: string }) {
  const [data, setData] = useState<PassiveRBResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchPassiveRB(backend)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [backend]);

  if (err) return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
      Passive RB: {err}
    </div>
  );
  if (!data) return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500 animate-pulse">
      Computing passive benchmarking…
    </div>
  );

  const { fit, epc, gate_fidelity, process_infidelity, trend, sparkline, n_runs_used, narrative } = data;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Passive Randomized Benchmarking</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TREND_BADGE[trend] ?? TREND_BADGE.insufficient_data}`}>
          {trend.replace("_", " ")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Gate Fidelity</p>
          <p className="text-lg font-bold text-white">{(gate_fidelity * 100).toFixed(3)}%</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">EPC</p>
          <p className="text-lg font-bold text-amber-400">{epc.toExponential(2)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-400 mb-1">Process Infidelity</p>
          <p className="text-lg font-bold text-rose-400">{process_infidelity.toExponential(2)}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-zinc-500 mb-1">Fidelity decay: F(d) = {fit.A.toFixed(3)}·{fit.p.toFixed(4)}^d + {fit.B.toFixed(3)} &nbsp;(R²={fit.r2.toFixed(3)})</p>
        <div className="flex items-center gap-4 text-xs text-zinc-500 mb-1">
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-blue-400"></span>raw data</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-green-400"></span>fitted decay</span>
        </div>
        <SparkChart raw={sparkline.raw} fitted={sparkline.fitted} />
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed">{narrative}</p>
      <p className="text-xs text-zinc-600">From {n_runs_used} runs · {data.computed_at.slice(0, 19).replace("T", " ")} UTC</p>
    </div>
  );
}
