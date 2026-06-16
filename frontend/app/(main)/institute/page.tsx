"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Overview {
  total_members: number;
  total_runs: number;
  runs_this_month: number;
  total_departments: number;
  completed_runs: number;
  success_rate: number;
  avg_health_score: number | null;
  total_qpu_seconds: number;
  total_qpu_time_formatted: string;
  generated_at: string;
}

interface LeaderboardEntry {
  rank: number;
  user_id: number;
  name: string;
  email: string;
  role: string;
  department: string | null;
  runs: number;
  completed_runs: number;
  avg_health_score: number | null;
  qpu_seconds: number;
  qpu_time_formatted: string;
  success_rate: number;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  total_researchers: number;
  sort_by: string;
  generated_at: string;
}

interface BudgetEntry {
  department: string;
  runs: number;
  total_shots: number;
  cost_usd: number;
  cost_formatted: string;
  pct_of_total: number;
}

interface BudgetData {
  breakdown: BudgetEntry[];
  total_cost_usd: number;
  total_cost_formatted: string;
  cost_model: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthColor(score: number | null): string {
  if (score === null) return "#9ca3af";
  if (score >= 70) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    owner:      { bg: "#7c3aed18", color: "#7c3aed" },
    admin:      { bg: "#1d6f8f18", color: "#1d6f8f" },
    researcher: { bg: "#10b98118", color: "#10b981" },
    viewer:     { bg: "#9ca3af18", color: "#9ca3af" },
  };
  const s = colors[role] ?? colors.viewer;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, background: s.bg, color: s.color,
      textTransform: "capitalize",
    }}>
      {role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({ overview }: { overview: Overview }) {
  const kpis: { label: string; value: string | number; color: string }[] = [
    { label: "Total Members",    value: overview.total_members,                  color: "#6366f1" },
    { label: "Total Runs",       value: overview.total_runs.toLocaleString(),     color: "#1d6f8f" },
    { label: "Runs This Month",  value: overview.runs_this_month.toLocaleString(), color: "#3b82f6" },
    { label: "Departments",      value: overview.total_departments,               color: "#8b5cf6" },
    { label: "Avg Health Score", value: overview.avg_health_score ?? "—",        color: healthColor(overview.avg_health_score) },
    { label: "Success Rate",     value: `${(overview.success_rate * 100).toFixed(1)}%`, color: "#10b981" },
    { label: "Total QPU Time",   value: overview.total_qpu_time_formatted,        color: "#f59e0b" },
  ];

  return (
    <section className="summary-grid" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))`, marginBottom: 20 }}>
      {kpis.map(k => (
        <div className="metric" key={k.label}>
          <div className="metric-label">{k.label}</div>
          <div className="metric-value" style={{ fontSize: 22, color: k.color }}>{String(k.value)}</div>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard table
// ---------------------------------------------------------------------------

function LeaderboardTable({
  data,
  sortBy,
  onSortChange,
}: {
  data: LeaderboardData;
  sortBy: string;
  onSortChange: (s: string) => void;
}) {
  function SortBtn({ id, label }: { id: string; label: string }) {
    const active = sortBy === id;
    return (
      <button
        type="button"
        onClick={() => onSortChange(id)}
        style={{
          border: "none", cursor: "pointer", fontWeight: 600, fontSize: 12,
          background: active ? "rgba(99,102,241,0.15)" : "transparent",
          color: active ? "#6366f1" : "var(--muted, #6b7280)",
          borderRadius: 4, padding: "2px 8px",
        }}
      >
        {active ? "▼ " : ""}{label}
      </button>
    );
  }

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <h2>Researcher Leaderboard</h2>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>Sort by:</span>
          <SortBtn id="runs" label="Runs" />
          <SortBtn id="health" label="Health" />
          <SortBtn id="qpu_time" label="QPU Time" />
        </div>
      </div>
      {!data.leaderboard.length ? (
        <div className="empty">No researcher data available.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Researcher</th>
                <th>Department</th>
                <th>Role</th>
                <th>Runs</th>
                <th>Completed</th>
                <th>Avg Health</th>
                <th>Success Rate</th>
                <th>QPU Time</th>
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map(entry => (
                <tr key={entry.user_id}>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      color: entry.rank === 1 ? "#f59e0b" : entry.rank === 2 ? "#9ca3af" : entry.rank === 3 ? "#b45309" : "inherit",
                    }}>
                      {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{entry.name || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>{entry.email}</div>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {entry.department ?? <span style={{ color: "var(--muted, #9ca3af)" }}>Unassigned</span>}
                  </td>
                  <td><RoleBadge role={entry.role} /></td>
                  <td style={{ fontWeight: 600 }}>{entry.runs.toLocaleString()}</td>
                  <td>{entry.completed_runs.toLocaleString()}</td>
                  <td>
                    <span style={{ color: healthColor(entry.avg_health_score), fontWeight: 600 }}>
                      {entry.avg_health_score ?? "—"}
                    </span>
                  </td>
                  <td>{(entry.success_rate * 100).toFixed(1)}%</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{entry.qpu_time_formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted, #6b7280)", borderTop: "1px solid var(--line, #e2e8f0)" }}>
        Showing top {data.leaderboard.length} of {data.total_researchers} researchers
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Budget SVG bar chart
// ---------------------------------------------------------------------------

function BudgetChart({ data }: { data: BudgetData }) {
  const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];
  const items = data.breakdown.slice(0, 8);
  const maxCost = Math.max(...items.map(d => d.cost_usd), 0.0001);
  const W = 680, BAR_H = 28, GAP = 8, PL = 200, PR = 120, PT = 12;
  const chartW = W - PL - PR;
  const totalH = PT + items.length * (BAR_H + GAP);

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <h2>QPU Budget by Department</h2>
        <span style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>
          Total: {data.total_cost_formatted} — {data.cost_model}
        </span>
      </div>
      {!items.length ? (
        <div className="empty">No budget data available. Assign members to departments to see cost breakdown.</div>
      ) : (
        <div style={{ padding: "16px 18px", overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${W} ${totalH + 16}`}
            style={{ width: "100%", maxWidth: W, height: totalH + 16 }}
            aria-label="QPU cost by department"
          >
            {items.map((d, i) => {
              const y = PT + i * (BAR_H + GAP);
              const barW = Math.max(2, (d.cost_usd / maxCost) * chartW);
              const color = COLORS[i % COLORS.length];
              return (
                <g key={d.department}>
                  <text
                    x={PL - 8}
                    y={y + BAR_H / 2 + 4}
                    textAnchor="end"
                    fontSize={12}
                    fill="var(--fg, #111)"
                    fontWeight={500}
                  >
                    {d.department.length > 26 ? d.department.slice(0, 24) + "…" : d.department}
                  </text>
                  {/* Bar background */}
                  <rect x={PL} y={y} width={chartW} height={BAR_H} rx={4} fill="#f1f5f9" />
                  {/* Bar fill */}
                  <rect x={PL} y={y} width={barW} height={BAR_H} rx={4} fill={color} opacity={0.85} />
                  {/* Value label */}
                  <text x={PL + barW + 6} y={y + BAR_H / 2 + 4} fontSize={11} fill="var(--muted, #6b7280)">
                    {d.cost_formatted} ({d.pct_of_total}%)
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Budget detail table
// ---------------------------------------------------------------------------

function BudgetTable({ data }: { data: BudgetData }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Cost Detail</h2>
        <span style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>{data.cost_model}</span>
      </div>
      {!data.breakdown.length ? (
        <div className="empty">No cost data available.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Runs</th>
                <th>Total Shots</th>
                <th>Cost (USD)</th>
                <th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {data.breakdown.map(d => (
                <tr key={d.department}>
                  <td style={{ fontWeight: 600 }}>{d.department}</td>
                  <td>{d.runs.toLocaleString()}</td>
                  <td>{d.total_shots.toLocaleString()}</td>
                  <td style={{ fontFamily: "monospace" }}>{d.cost_formatted}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${d.pct_of_total}%`, background: "#6366f1", borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 12, width: 40, textAlign: "right" }}>{d.pct_of_total}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line, #e2e8f0)", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: "var(--muted, #6b7280)" }}>Total</span>
        <strong>{data.total_cost_formatted}</strong>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InstitutePage() {
  const { token, user } = useAuth();
  const router = useRouter();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [sortBy, setSortBy] = useState("runs");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

  const authHeaders = useCallback((): HeadersInit => {
    const tok = token ?? localStorage.getItem("qlab_token");
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  }, [token]);

  const loadLeaderboard = useCallback(async (sort: string) => {
    try {
      const res = await fetch(`/qlab-api/institute-admin/leaderboard?sort_by=${sort}&limit=20`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
      setLeaderboard(await res.json() as LeaderboardData);
    } catch (err) {
      console.error("Leaderboard error:", err);
    }
  }, [authHeaders]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, budgetRes] = await Promise.all([
        fetch("/qlab-api/institute-admin/overview", { headers: authHeaders() }),
        fetch("/qlab-api/institute-admin/budget", { headers: authHeaders() }),
      ]);
      if (!overviewRes.ok) throw new Error(`Overview fetch failed: ${overviewRes.status}`);
      if (!budgetRes.ok) throw new Error(`Budget fetch failed: ${budgetRes.status}`);
      const [ov, bd] = await Promise.all([overviewRes.json(), budgetRes.json()]) as [Overview, BudgetData];
      setOverview(ov);
      setBudget(bd);
      await loadLeaderboard(sortBy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load institute data");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, loadLeaderboard, sortBy]);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) {
      router.push("/login");
      return;
    }
    if (user && user.role !== "owner" && user.role !== "admin") {
      router.push("/");
      return;
    }
    void loadData();
  }, [token, user, router, loadData]);

  async function handleSortChange(sort: string) {
    setSortBy(sort);
    await loadLeaderboard(sort);
  }

  async function handleDownloadReport() {
    setDownloadingReport(true);
    try {
      const res = await fetch("/qlab-api/institute-admin/report?format=html", {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Report generation failed");
      const htmlContent = await res.text();
      const blob = new Blob([htmlContent], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `institute-report-${new Date().toISOString().slice(0, 7)}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Report download error:", err);
    } finally {
      setDownloadingReport(false);
    }
  }

  if (loading) return <main className="page"><div className="empty">Loading institution dashboard…</div></main>;
  if (error) return <main className="page"><div className="empty" style={{ color: "var(--danger, #dc2626)" }}>{error}</div></main>;
  if (!overview) return null;

  return (
    <main className="page">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
            🏛 Institution Dashboard
          </h1>
          <div style={{ fontSize: 13, color: "var(--muted, #6b7280)" }}>
            Last updated: {new Date(overview.generated_at).toLocaleString()}
          </div>
        </div>
        <button
          className="button"
          onClick={() => void handleDownloadReport()}
          disabled={downloadingReport}
          type="button"
        >
          {downloadingReport ? "Generating…" : "📄 Download Monthly Report"}
        </button>
      </div>

      {/* KPI Strip */}
      <KpiStrip overview={overview} />

      {/* Leaderboard */}
      {leaderboard && (
        <LeaderboardTable
          data={leaderboard}
          sortBy={sortBy}
          onSortChange={s => void handleSortChange(s)}
        />
      )}

      {/* Budget chart */}
      {budget && <BudgetChart data={budget} />}

      {/* Budget table */}
      {budget && <BudgetTable data={budget} />}
    </main>
  );
}
