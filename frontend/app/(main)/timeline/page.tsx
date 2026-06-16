"use client";

import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { searchRuns, QLabRun, healthColor } from "../../../lib/api";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function statusColor(status: string): string {
  if (status === "completed") return "var(--ok)";
  if (status === "failed") return "var(--danger)";
  if (status === "submitted") return "var(--info)";
  return "var(--muted)";
}

function daysAgo(d: string): number {
  return (Date.now() - new Date(d).getTime()) / 86400000;
}

// ------------------------------------------------------------------
// Pixel helpers
// ------------------------------------------------------------------
function timeToX(date: string, minMs: number, maxMs: number, w: number): number {
  const ms = new Date(date).getTime();
  return ((ms - minMs) / (maxMs - minMs)) * w;
}

// ------------------------------------------------------------------
// Row for one project lane
// ------------------------------------------------------------------
function ProjectLane({
  project,
  runs,
  minMs,
  maxMs,
  laneW,
}: {
  project: string;
  runs: QLabRun[];
  minMs: number;
  maxMs: number;
  laneW: number;
}) {
  const BAR_H = 16;
  const LABEL_W = 150;

  return (
    <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)", minHeight: 36 }}>
      {/* Project label */}
      <div style={{ width: LABEL_W, flexShrink: 0, padding: "0 12px", fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={project}>
        {project}
      </div>
      {/* Bar area */}
      <div style={{ flex: 1, position: "relative", height: 36, overflow: "visible" }}>
        {runs.map(r => {
          const x = timeToX(r.created_at, minMs, maxMs, laneW);
          const hc = healthColor(r.health_score);
          const sc = statusColor(r.status);
          return (
            <Link
              key={r.run_id}
              href={`/runs/${r.run_id}`}
              title={`${r.circuit_name ?? r.run_id}\n${r.status} · health ${r.health_score ?? "—"}\n${new Date(r.created_at).toLocaleString()}`}
              style={{
                position: "absolute",
                left: `${Math.max(0, x - 4)}px`,
                top: `${(36 - BAR_H) / 2}px`,
                width: 8,
                height: BAR_H,
                borderRadius: 3,
                background: sc,
                border: `2px solid ${hc}`,
                boxSizing: "border-box",
                textDecoration: "none",
                display: "block",
                transition: "transform 0.1s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Time axis
// ------------------------------------------------------------------
function TimeAxis({ minMs, maxMs, w }: { minMs: number; maxMs: number; w: number }) {
  const LABEL_W = 150;
  const rangeMs = maxMs - minMs;
  const rangeDay = rangeMs / 86400000;

  // Pick tick interval
  const tickIntervalDay = rangeDay <= 7 ? 1 : rangeDay <= 30 ? 7 : rangeDay <= 90 ? 14 : 30;
  const ticks: Date[] = [];
  const start = new Date(minMs);
  start.setHours(0, 0, 0, 0);
  const cur = new Date(start);
  while (cur.getTime() <= maxMs) {
    ticks.push(new Date(cur));
    cur.setDate(cur.getDate() + tickIntervalDay);
  }

  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--line)", height: 28, position: "relative" }}>
      <div style={{ width: LABEL_W, flexShrink: 0 }} />
      <div style={{ flex: 1, position: "relative" }}>
        {ticks.map(t => {
          const x = timeToX(t.toISOString(), minMs, maxMs, w);
          if (x < 0 || x > w) return null;
          return (
            <div key={t.getTime()} style={{ position: "absolute", left: x, height: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <div style={{ width: 1, height: 6, background: "var(--line)" }} />
              <span style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap", transform: "translateX(-50%)" }}>
                {t.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------
export default function TimelinePage() {
  const [runs, setRuns] = useState<QLabRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    searchRuns({ page_size: 500, sort_by: "created_at", sort_order: "desc" })
      .then(r => setRuns(r.items))
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Group by project
  const filtered = useMemo(() => {
    const cutoff = Date.now() - days * 86400000;
    return runs.filter(r => {
      if (new Date(r.created_at).getTime() < cutoff) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [runs, days, statusFilter]);

  const byProject = useMemo(() => {
    const map: Record<string, QLabRun[]> = {};
    for (const r of filtered) {
      const p = r.project ?? "— no project —";
      if (!map[p]) map[p] = [];
      map[p].push(r);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const { minMs, maxMs } = useMemo(() => {
    if (!filtered.length) return { minMs: Date.now() - days * 86400000, maxMs: Date.now() };
    const times = filtered.map(r => new Date(r.created_at).getTime());
    const pad = (Math.max(...times) - Math.min(...times)) * 0.03 || 86400000;
    return { minMs: Math.min(...times) - pad, maxMs: Math.max(...times) + pad };
  }, [filtered, days]);

  const laneW = 900; // logical width for time mapping

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of filtered) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [filtered]);

  return (
    <main className="page">
      <div className="toolbar">
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>Experiment Timeline</h1>
      </div>

      {/* Controls */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div style={{ padding: "12px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Time window</label>
            <select
              className="input"
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              style={{ height: 32, fontSize: 13 }}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last year</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</label>
            <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ height: 32, fontSize: 13 }}>
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>

          {/* Status legend */}
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginLeft: 8 }}>
            {[["completed", "var(--ok)"], ["failed", "var(--danger)"], ["submitted", "var(--info)"]].map(([s, c]) => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />
                {s} ({statusCounts[s] ?? 0})
              </span>
            ))}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>border = health score colour</span>
          </div>

          <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>
            {filtered.length} runs · {byProject.length} projects
          </div>
        </div>
      </section>

      {error && <div className="empty">{error}</div>}
      {loading && <div className="empty">Loading timeline…</div>}

      {!loading && !error && byProject.length === 0 && (
        <div className="empty">No runs in the selected window.</div>
      )}

      {!loading && !error && byProject.length > 0 && (
        <section className="panel">
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 800 }}>
              <TimeAxis minMs={minMs} maxMs={maxMs} w={laneW} />
              {byProject.map(([project, projectRuns]) => (
                <ProjectLane
                  key={project}
                  project={project}
                  runs={projectRuns}
                  minMs={minMs}
                  maxMs={maxMs}
                  laneW={laneW}
                />
              ))}
            </div>
          </div>
          <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--muted)" }}>
            Hover over a bar to see run details · Click to open run · Each bar is one run
          </div>
        </section>
      )}
    </main>
  );
}
