"use client";

import { useEffect, useState } from "react";
import { Cpu, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { fetchBackends, fetchHardwareRec, type BackendInfo, type HardwareRecResult } from "../../../lib/api";

const DEFAULT_SPEC = { num_qubits: 5, depth: 20, size: 40, two_qubit_gate_count: 8, circuit_time_us: 10, non_clifford_ratio: 0.1 };

function CalBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  if (value == null) return <span style={{ color: "#aaa", fontSize: 12 }}>N/A</span>;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 6, background: "#e8ecf0", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12 }}>{(value * 100).toFixed(3)}%</span>
    </div>
  );
}

function T1Bar({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "#aaa", fontSize: 12 }}>N/A</span>;
  return <span style={{ fontSize: 13, fontWeight: 600 }}>{value.toFixed(0)} µs</span>;
}

function AgeChip({ days }: { days: number | null }) {
  if (days == null) return <span style={{ fontSize: 11, color: "#aaa" }}>unknown</span>;
  const color = days < 1 ? "#1f8a5b" : days < 7 ? "#e67e22" : "#e74c3c";
  const label = days < 1 ? "today" : days < 2 ? "yesterday" : `${Math.floor(days)}d ago`;
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600, background: color + "22", padding: "1px 6px", borderRadius: 4 }}>
      {label}
    </span>
  );
}

type SortKey = "backend" | "run_count" | "avg_ge_2q" | "avg_t1_us" | "avg_ro";

function SortHeader({ col, label, sortKey, sortDir, onSort }: {
  col: SortKey; label: string; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--fg, #17202a)" : "var(--muted, #5f6f80)", fontWeight: active ? 700 : 600 }}
      onClick={() => onSort(col)}>
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );
}

export default function BackendsPage() {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [scores, setScores] = useState<Record<string, { score: number; grade: string }>>({});
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("run_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const bs = await fetchBackends();
      setBackends(bs);
      // Also run a default circuit spec recommendation to get scores
      if (bs.length > 0) {
        try {
          const rec = await fetchHardwareRec(DEFAULT_SPEC);
          const scoreMap: Record<string, { score: number; grade: string }> = {};
          for (const b of rec.backends) scoreMap[b.backend] = { score: b.score, grade: b.grade };
          setScores(scoreMap);
        } catch { /* scores are optional */ }
      }
    } catch { setError("Failed to load backends"); }
    finally { setLoading(false); }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = [...backends].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortKey === "backend") { av = a.backend; bv = b.backend; }
    else if (sortKey === "run_count") { av = a.run_count; bv = b.run_count; }
    else if (sortKey === "avg_ge_2q") { av = a.avg_ge_2q ?? Infinity; bv = b.avg_ge_2q ?? Infinity; }
    else if (sortKey === "avg_t1_us") { av = a.avg_t1_us ?? 0; bv = b.avg_t1_us ?? 0; }
    else { av = a.avg_ro ?? Infinity; bv = b.avg_ro ?? Infinity; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const GRADE_COLOR: Record<string, string> = {
    "A+": "#1f8a5b", A: "#27ae60", "B+": "#2ecc71", B: "#f39c12",
    "C+": "#e67e22", C: "#e67e22", D: "#e74c3c", F: "#c0392b",
  };

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><Cpu size={17} /> Backend Health Dashboard</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted, #5f6f80)" }}>Scores for a 5-qubit, depth-20 circuit</span>
            <button className="button secondary" onClick={load} style={{ height: 30, fontSize: 12 }}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty">Loading backends…</div>
        ) : error ? (
          <div className="empty" style={{ color: "#e74c3c" }}>{error}</div>
        ) : backends.length === 0 ? (
          <div className="empty">No backends found. Run experiments on real hardware backends to populate this dashboard.</div>
        ) : (
          <>
            {/* Summary strip */}
            <div style={{ padding: "12px 18px", display: "flex", gap: 20, borderBottom: "1px solid var(--border, #dfe4ea)" }}>
              <div><span style={{ fontSize: 22, fontWeight: 700 }}>{backends.length}</span><span style={{ fontSize: 12, color: "#5f6f80", marginLeft: 6 }}>backends</span></div>
              <div><span style={{ fontSize: 22, fontWeight: 700 }}>{backends.filter(b => b.has_calibration).length}</span><span style={{ fontSize: 12, color: "#5f6f80", marginLeft: 6 }}>with calibration</span></div>
              <div><span style={{ fontSize: 22, fontWeight: 700 }}>{Object.values(scores).filter(s => s.score >= 70).length}</span><span style={{ fontSize: 12, color: "#27ae60", marginLeft: 6 }}>A-grade fit</span></div>
              <div><span style={{ fontSize: 22, fontWeight: 700 }}>{backends.reduce((s, b) => s + b.run_count, 0)}</span><span style={{ fontSize: 12, color: "#5f6f80", marginLeft: 6 }}>total runs</span></div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHeader col="backend" label="Backend" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th>Cal freshness</th>
                    <SortHeader col="avg_ge_2q" label="2Q gate err" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader col="avg_t1_us" label="Avg T1" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader col="avg_ro" label="Readout err" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th>Fit score</th>
                    <SortHeader col="run_count" label="Runs" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th>Latest run</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(b => {
                    const sc = scores[b.backend];
                    const gradeColor = sc ? (GRADE_COLOR[sc.grade] ?? "#888") : "#bbb";
                    return (
                      <tr key={b.backend}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {b.has_calibration
                              ? <CheckCircle size={13} color="#27ae60" />
                              : <AlertTriangle size={13} color="#e67e22" />}
                            {b.backend}
                          </div>
                        </td>
                        <td>
                          {b.has_calibration
                            ? <span style={{ fontSize: 11, color: "#1f8a5b", fontWeight: 600 }}>✓ available</span>
                            : <span style={{ fontSize: 11, color: "#e67e22" }}>no cal data</span>}
                        </td>
                        <td><CalBar value={b.avg_ge_2q} max={0.05} color="#e74c3c" /></td>
                        <td><T1Bar value={b.avg_t1_us} /></td>
                        <td><CalBar value={b.avg_ro} max={0.1} color="#e67e22" /></td>
                        <td>
                          {sc ? (
                            <span style={{
                              fontSize: 13, fontWeight: 700, color: gradeColor,
                              background: gradeColor + "22", padding: "2px 8px", borderRadius: 999,
                            }}>
                              {sc.grade} {sc.score.toFixed(0)}
                            </span>
                          ) : <span style={{ color: "#bbb", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>{b.run_count}</td>
                        <td style={{ fontSize: 12, color: "#5f6f80" }}>
                          {b.latest_run ? new Date(b.latest_run).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
