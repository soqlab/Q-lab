"use client";

import { useEffect, useState } from "react";
import { fetchMilestonePredict, MilestonePredictResult, MilestonePrediction } from "../../../lib/api";

const TREND_COLOR: Record<string, string> = {
  improving: "text-green-400",
  stable: "text-yellow-400",
  degrading: "text-red-400",
};

function Sparkline({ data }: { data: { x: number; y: number }[] }) {
  if (data.length < 2) return null;
  const W = 200, H = 40;
  const xs = data.map(p => p.x);
  const ys = data.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (x: number) => ((x - minX) / Math.max(1, maxX - minX)) * W;
  const py = (y: number) => H - ((y - minY) / Math.max(1e-9, maxY - minY)) * H;
  const d = data.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x)},${py(p.y)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8">
      <path d={d} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
    </svg>
  );
}

function MilestoneRow({ ms }: { ms: MilestonePrediction }) {
  if (!ms.feasible) return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-zinc-400">{ms.label}</span>
      <span className="text-zinc-600">{ms.note ?? "—"}</span>
    </div>
  );
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-zinc-300">{ms.label}</span>
      <div className="text-right">
        <span className="text-green-400 font-medium">{ms.predicted_date}</span>
        {ms.days !== null && <span className="text-zinc-500 ml-2">({ms.days}d{ms.ci_days ? ` ±${ms.ci_days}d` : ""})</span>}
      </div>
    </div>
  );
}

export default function MilestonePredictPanel({ backend }: { backend: string }) {
  const [data, setData] = useState<MilestonePredictResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchMilestonePredict(backend)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [backend]);

  if (err) return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
      Milestone Prediction: {err}
    </div>
  );
  if (!data) return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500 animate-pulse">
      Fitting milestone trajectories…
    </div>
  );

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Milestone Trajectory Prediction</h3>
        <span className="text-xs text-zinc-500">{data.n_runs} runs · {Math.round(data.observation_days)}d observed</span>
      </div>

      <div className="space-y-4">
        {data.metrics.map(metric => (
          <div key={metric.key} className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">{metric.label}</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${TREND_COLOR[metric.trend] ?? "text-zinc-400"}`}>
                  {metric.trend}
                </span>
                <span className="text-xs text-zinc-500">R²={metric.r2.toFixed(2)}</span>
              </div>
            </div>

            <Sparkline data={metric.sparkline} />

            <div className="text-xs text-zinc-500">
              Current: <span className="text-zinc-300">{metric.current_value.toExponential(3)}</span>
              &nbsp;·&nbsp;slope: <span className="text-zinc-300">{metric.slope_per_day > 0 ? "+" : ""}{metric.slope_per_day.toExponential(2)}/day</span>
            </div>

            <div className="border-t border-zinc-700 pt-2 space-y-0.5">
              {metric.milestones.map((ms: MilestonePrediction, i: number) => (
                <MilestoneRow key={i} ms={ms} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-600">{data.computed_at.slice(0, 19).replace("T", " ")} UTC</p>
    </div>
  );
}
