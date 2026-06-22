"use client";

import { useEffect, useState } from "react";

const API = "/qlab-api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunCost {
  run_id: string;
  circuit_name: string | null;
  backend: string | null;
  created_at: string | null;
  cost_usd: number;
  provider: string;
}

interface CostSummary {
  total_cost_usd: number;
  total_runs: number;
  by_provider: Record<string, number>;
  monthly_trend: Record<string, number>;
  top_10_most_expensive: RunCost[];
  free_vs_paid_pct: { free: number; paid: number };
}

interface BudgetCheck {
  current_month_spend: number;
  budget: number;
  remaining: number;
  overage: number;
  is_over_budget: boolean;
  projected_monthly: number;
  day_of_month: number;
}

interface ProjectCost {
  project_slug: string;
  total_cost_usd: number;
  by_backend: Record<string, number>;
  run_count: number;
  avg_cost_per_run: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem 1.25rem", flex: "1 1 150px" }}>
      <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ color: color ?? "#e2e8f0", fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Monthly bar chart ───────────────────────────────────────────────────────

function MonthlyBarChart({ monthly }: { monthly: Record<string, number> }) {
  const entries = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  if (entries.length === 0) return <div style={{ color: "#475569", fontSize: 13 }}>No monthly data</div>;
  const max = Math.max(...entries.map(([, v]) => v), 0.0001);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 100, padding: "0 4px" }}>
      {entries.map(([month, val]) => {
        const h = Math.max(2, (val / max) * 90);
        return (
          <div key={month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div
              title={`${month}: ${fmt(val)}`}
              style={{ width: "100%", height: h, background: "#3b82f6", borderRadius: "3px 3px 0 0", opacity: 0.85 }}
            />
            <span style={{ color: "#475569", fontSize: 9, writingMode: "vertical-rl", transform: "rotate(180deg)", height: 28, overflow: "hidden" }}>
              {month.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Provider bars ───────────────────────────────────────────────────────────

function ProviderBars({ byProvider, total }: { byProvider: Record<string, number>; total: number }) {
  const entries = Object.entries(byProvider).sort(([, a], [, b]) => b - a);
  const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];
  if (entries.length === 0) return <div style={{ color: "#475569", fontSize: 13 }}>No provider data</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map(([provider, cost], i) => {
        const pct = total > 0 ? (cost / total) * 100 : 0;
        return (
          <div key={provider}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{provider}</span>
              <span style={{ color: "#64748b" }}>{fmt(cost)} ({pct.toFixed(1)}%)</span>
            </div>
            <div style={{ height: 8, background: "#0f172a", borderRadius: 4 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: COLORS[i % COLORS.length], borderRadius: 4, transition: "width 0.5s" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Budget check section ────────────────────────────────────────────────────

function BudgetSection({ budget }: { budget: BudgetCheck }) {
  const usedPct = budget.budget > 0 ? Math.min((budget.current_month_spend / budget.budget) * 100, 100) : 0;
  const barColor = budget.is_over_budget ? "#ef4444" : usedPct > 80 ? "#f59e0b" : "#10b981";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: "#94a3b8" }}>Spent this month</span>
        <span style={{ color: barColor, fontWeight: 700 }}>{fmt(budget.current_month_spend)} / {fmt(budget.budget)}</span>
      </div>
      <div style={{ height: 12, background: "#0f172a", borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ height: "100%", width: `${usedPct}%`, background: barColor, borderRadius: 6, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
        <div>
          <div style={{ color: "#64748b" }}>Remaining</div>
          <div style={{ color: "#10b981", fontWeight: 600 }}>{fmt(budget.remaining)}</div>
        </div>
        <div>
          <div style={{ color: "#64748b" }}>Projected</div>
          <div style={{ color: "#f59e0b", fontWeight: 600 }}>{fmt(budget.projected_monthly)}</div>
        </div>
        <div>
          <div style={{ color: "#64748b" }}>Day</div>
          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{budget.day_of_month}/30</div>
        </div>
      </div>
      {budget.is_over_budget && (
        <div style={{ marginTop: 8, background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 6, padding: "0.5rem 0.75rem", color: "#f87171", fontSize: 12 }}>
          Over budget by {fmt(budget.overage)}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CostTrackerPage() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budget, setBudget] = useState<BudgetCheck | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async (mb: number = monthlyBudget) => {
    setLoading(true);
    setError(null);
    try {
      const [s, b] = await Promise.all([
        fetch(`${API}/api/v1/cost-tracker/summary`).then(r => r.json()),
        fetch(`${API}/api/v1/cost-tracker/budget-check?monthly_budget_usd=${mb}`).then(r => r.json()),
      ]);
      setSummary(s);
      setBudget(b);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load cost data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const thisMontKey = new Date().toISOString().slice(0, 7);
  const thisMonthSpend = summary?.monthly_trend[thisMontKey] ?? 0;
  const freeRunsPct = summary?.free_vs_paid_pct.free ?? 0;
  const topProvider = summary ? Object.entries(summary.by_provider).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "—" : "—";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>QPU Cost Tracker</h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Estimate and track spending across IBM, IonQ, Rigetti, and simulator backends.
        </p>
      </div>

      {error && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>Loading costs…</div>
      ) : summary ? (
        <>
          {/* KPI strip */}
          <div style={{ display: "flex", gap: 12, marginBottom: "1.5rem", flexWrap: "wrap" }}>
            <KpiCard label="Total Spend" value={fmt(summary.total_cost_usd)} sub={`${summary.total_runs} runs`} />
            <KpiCard label="This Month" value={fmt(thisMonthSpend)} color="#3b82f6" />
            <KpiCard label="Free Runs" value={`${freeRunsPct}%`} sub="of all runs" color="#10b981" />
            <KpiCard label="Most Used Backend" value={topProvider} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            {/* Monthly bar chart */}
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
              <h2 style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: "0 0 1rem 0" }}>Monthly Spending (USD)</h2>
              <MonthlyBarChart monthly={summary.monthly_trend} />
            </div>

            {/* Provider breakdown */}
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
              <h2 style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: "0 0 1rem 0" }}>By Provider</h2>
              <ProviderBars byProvider={summary.by_provider} total={summary.total_cost_usd} />
            </div>
          </div>

          {/* Budget check */}
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: 0 }}>Budget Check</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#64748b", fontSize: 13 }}>Monthly budget $</span>
                <input
                  type="number"
                  value={monthlyBudget}
                  onChange={e => setMonthlyBudget(Number(e.target.value))}
                  min={0}
                  style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.35rem 0.6rem", width: 80, fontSize: 13 }}
                />
                <button
                  onClick={() => loadAll(monthlyBudget)}
                  style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "0.35rem 0.8rem", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                >
                  Update
                </button>
              </div>
            </div>
            {budget && <BudgetSection budget={budget} />}
          </div>

          {/* Top 10 most expensive runs */}
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", overflow: "hidden", marginBottom: "1.5rem" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #334155" }}>
              <h2 style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: 0 }}>Top 10 Most Expensive Runs</h2>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {["Circuit", "Backend", "Provider", "Date", "Cost (USD)"].map(h => (
                      <th key={h} style={{ padding: "0.6rem 1rem", textAlign: "left", color: "#64748b", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.top_10_most_expensive.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: "1rem", color: "#475569", textAlign: "center" }}>No run data yet</td></tr>
                  ) : summary.top_10_most_expensive.map((run, i) => (
                    <tr key={run.run_id} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "0.55rem 1rem", color: "#e2e8f0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {run.circuit_name ?? run.run_id}
                      </td>
                      <td style={{ padding: "0.55rem 1rem", color: "#94a3b8", fontFamily: "monospace" }}>{run.backend ?? "—"}</td>
                      <td style={{ padding: "0.55rem 1rem", color: "#94a3b8" }}>{run.provider}</td>
                      <td style={{ padding: "0.55rem 1rem", color: "#64748b" }}>{fmtDate(run.created_at)}</td>
                      <td style={{ padding: "0.55rem 1rem", fontWeight: 700, color: i === 0 ? "#ef4444" : i < 3 ? "#f59e0b" : "#e2e8f0" }}>
                        {fmt(run.cost_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Free vs paid */}
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h2 style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, margin: "0 0 0.75rem 0" }}>Free vs Paid Runs</h2>
            <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
              <div>
                <div style={{ color: "#10b981", fontWeight: 700, fontSize: 20 }}>{summary.free_vs_paid_pct.free}%</div>
                <div style={{ color: "#64748b" }}>Simulator / Free</div>
              </div>
              <div>
                <div style={{ color: "#3b82f6", fontWeight: 700, fontSize: 20 }}>{summary.free_vs_paid_pct.paid}%</div>
                <div style={{ color: "#64748b" }}>Real QPU (Paid)</div>
              </div>
            </div>
            <div style={{ marginTop: 10, height: 10, background: "#0f172a", borderRadius: 5, overflow: "hidden", display: "flex" }}>
              <div style={{ height: "100%", width: `${summary.free_vs_paid_pct.free}%`, background: "#10b981" }} />
              <div style={{ height: "100%", flex: 1, background: "#3b82f6" }} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
