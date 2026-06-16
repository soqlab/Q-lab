"use client";

import { useEffect, useState } from "react";
import { fetchDeviceFingerprint, DeviceFingerprintResult } from "../../../lib/api";

const DRIFT_COLOR: Record<string, string> = {
  low: "text-green-400 bg-green-900/30 border-green-800",
  medium: "text-yellow-400 bg-yellow-900/30 border-yellow-800",
  high: "text-red-400 bg-red-900/30 border-red-800",
};

function FeatureBar({ name, early, recent, pct_change, flag }: { name: string; early: number; recent: number; pct_change: number; flag: boolean }) {
  const max = Math.max(Math.abs(early), Math.abs(recent), 1e-9);
  const ePct = Math.min(100, (Math.abs(early) / max) * 100);
  const rPct = Math.min(100, (Math.abs(recent) / max) * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className={flag ? "text-amber-400 font-medium" : "text-zinc-400"}>{name}{flag ? " ⚠" : ""}</span>
        <span className={pct_change > 0 ? "text-red-400" : "text-green-400"}>
          {pct_change > 0 ? "+" : ""}{pct_change.toFixed(1)}%
        </span>
      </div>
      <div className="flex gap-1 items-center">
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${ePct}%` }} />
        </div>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${rPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function DeviceFingerprintPanel({ backend }: { backend: string }) {
  const [data, setData] = useState<DeviceFingerprintResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchDeviceFingerprint(backend)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [backend]);

  if (err) return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
      Device Fingerprint: {err}
    </div>
  );
  if (!data) return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-500 animate-pulse">
      Computing device fingerprint…
    </div>
  );

  const { fingerprint_id, drift_score, drift_label, features, timeline, narrative, n_runs } = data;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white text-sm">Device Identity Fingerprint</h3>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">{fingerprint_id}</p>
        </div>
        <div className={`text-xs px-2 py-1 rounded border font-medium ${DRIFT_COLOR[drift_label]}`}>
          {drift_label} drift · {(drift_score * 100).toFixed(1)}%
        </div>
      </div>

      <div>
        <div className="flex items-center gap-4 text-xs text-zinc-500 mb-2">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-blue-500 rounded-full"></span>early</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-purple-500 rounded-full"></span>recent</span>
        </div>
        <div className="space-y-2">
          {features.map((f: import("../../../lib/api").FingerprintFeature) => (
            <FeatureBar key={f.name} {...f} />
          ))}
        </div>
      </div>

      {timeline.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-400 hover:text-white"
          >
            {expanded ? "▲ Hide" : "▼ Show"} 8-week timeline
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {timeline.map(t => (
                <div key={t.week_start} className="flex items-center gap-3 text-xs">
                  <span className="text-zinc-500 w-24 shrink-0">{t.week_start}</span>
                  <span className="font-mono text-zinc-400">{t.fingerprint}</span>
                  <span className={t.drift_from_baseline > 0.1 ? "text-amber-400" : "text-zinc-500"}>
                    drift {(t.drift_from_baseline * 100).toFixed(1)}%
                  </span>
                  <span className="text-zinc-600">{t.n_runs}r</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-zinc-400 leading-relaxed">{narrative}</p>
      <p className="text-xs text-zinc-600">From {n_runs} runs · {data.computed_at.slice(0, 19).replace("T", " ")} UTC</p>
    </div>
  );
}
