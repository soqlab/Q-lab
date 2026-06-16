"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getFederatedResults,
  getFederatedLeaderboard,
  getFederatedStats,
  contributeFederated,
  FederatedResult,
  FederatedResultsResponse,
  FederatedLeaderboard,
  FederatedStats,
  ContributeFederatedRequest,
} from "@/lib/api";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const CATEGORIES = ["optimization", "chemistry", "ml", "crypto", "simulation"];
const ALGORITHMS = ["vqe", "qaoa", "grover", "qft", "custom"];
const BACKENDS = [
  "ibm_sherbrooke",
  "ibm_brisbane",
  "ibm_cairo",
  "ibm_nairobi",
  "ionq_harmony",
  "ionq_aria",
  "rigetti_aspen_m3",
];
const MITIGATIONS = ["zne", "pec", "mem", "none"];
const PAGE_SIZE = 20;

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------
function healthColor(score: number): string {
  if (score >= 85) return "#22c55e";
  if (score >= 65) return "#f59e0b";
  return "#ef4444";
}

function healthBg(score: number): string {
  if (score >= 85) return "var(--badge-green-bg, #dcfce7)";
  if (score >= 65) return "var(--badge-yellow-bg, #fef9c3)";
  return "var(--badge-red-bg, #fee2e2)";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function HealthBadge({ score }: { score: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        color: healthColor(score),
        background: healthBg(score),
      }}
    >
      {score.toFixed(1)}
    </span>
  );
}

// SVG bar chart (no external deps)
function BarChart({
  data,
  labelKey,
  valueKey,
  title,
  color = "#6366f1",
}: {
  data: Record<string, number>;
  labelKey?: string;
  valueKey?: string;
  title: string;
  color?: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) return <p style={{ color: "var(--muted)" }}>No data</p>;

  const maxVal = Math.max(...entries.map(([, v]) => v));
  const barH = 22;
  const gap = 6;
  const labelW = 160;
  const chartW = 240;
  const svgH = entries.length * (barH + gap);

  return (
    <div>
      <h4 style={{ marginBottom: 8, fontSize: 13, color: "var(--muted)" }}>{title}</h4>
      <svg width={labelW + chartW + 60} height={svgH} style={{ overflow: "visible" }}>
        {entries.map(([label, value], i) => {
          const y = i * (barH + gap);
          const w = maxVal > 0 ? (value / maxVal) * chartW : 0;
          return (
            <g key={label}>
              <text
                x={labelW - 6}
                y={y + barH / 2 + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--fg, #e2e8f0)"
              >
                {label.length > 20 ? label.slice(0, 18) + "…" : label}
              </text>
              <rect x={labelW} y={y} width={w} height={barH} rx={4} fill={color} opacity={0.85} />
              <text x={labelW + w + 5} y={y + barH / 2 + 4} fontSize={11} fill="var(--muted, #94a3b8)">
                {typeof value === "number" && value < 2 ? value.toFixed(2) : value.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------
// Tab: Browse
// ------------------------------------------------------------------
function BrowseTab() {
  const [data, setData] = useState<FederatedResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Filters
  const [category, setCategory] = useState("");
  const [backend, setBackend] = useState("");
  const [minQubits, setMinQubits] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: 500 };
      if (category) params.algorithm_category = category;
      if (backend) params.backend = backend;
      if (minQubits) params.min_qubits = parseInt(minQubits, 10);
      const res = await getFederatedResults(params as Parameters<typeof getFederatedResults>[0]);
      setData(res);
      setPage(0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally {
      setLoading(false);
    }
  }, [category, backend, minQubits]);

  useEffect(() => { load(); }, [load]);

  const results = data?.results ?? [];
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  const pageItems = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Category</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)", fontSize: 13 }}
          >
            <option value="">All</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Backend</span>
          <select
            value={backend}
            onChange={e => setBackend(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)", fontSize: 13 }}
          >
            <option value="">All</option>
            {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Min Qubits</span>
          <input
            type="number"
            min={1}
            value={minQubits}
            onChange={e => setMinQubits(e.target.value)}
            placeholder="e.g. 5"
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)", fontSize: 13, width: 100 }}
          />
        </label>
        <button
          onClick={load}
          style={{ padding: "6px 18px", borderRadius: 6, background: "#6366f1", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, marginTop: 18 }}
        >
          Apply
        </button>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {error && <p style={{ color: "#ef4444" }}>{error}</p>}

      {!loading && data && (
        <>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Showing {pageItems.length} of {results.length} results (total in registry: {data.stats.total_contributed})
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Algorithm", "Backend", "Qubits", "Depth", "Health Score", "Error Rate", "Mitigation", "Contributed By", "Date"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map(r => (
                  <tr key={r.result_id} style={{ borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.05))" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.algorithm}</td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12 }}>{r.backend}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center" }}>{r.n_qubits}</td>
                    <td style={{ padding: "7px 10px", textAlign: "center" }}>{r.circuit_depth}</td>
                    <td style={{ padding: "7px 10px" }}><HealthBadge score={r.health_score} /></td>
                    <td style={{ padding: "7px 10px", textAlign: "center", color: "var(--muted)" }}>{(r.error_rate * 100).toFixed(2)}%</td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12 }}>{r.error_mitigation ?? "—"}</td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12 }}>{r.contributed_by}</td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(r.contributed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)", cursor: "pointer", opacity: page === 0 ? 0.4 : 1 }}
              >
                ‹ Prev
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Page {page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--fg)", cursor: "pointer", opacity: page === totalPages - 1 ? 0.4 : 1 }}
              >
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Tab: Leaderboard
// ------------------------------------------------------------------
function LeaderboardTab() {
  const [data, setData] = useState<FederatedLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFederatedLeaderboard()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (error) return <p style={{ color: "#ef4444" }}>{error}</p>;
  if (!data) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
      {CATEGORIES.map(cat => {
        const items = (data.by_category[cat] ?? []).slice(0, 3);
        return (
          <div
            key={cat}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}
          >
            <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, textTransform: "capitalize", letterSpacing: 0.5 }}>
              {cat}
            </h3>
            {items.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No contributions yet</p>
            ) : (
              items.map((r, idx) => (
                <div
                  key={r.result_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: idx < items.length - 1 ? "1px solid var(--border-subtle, rgba(255,255,255,0.05))" : "none",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 16, color: idx === 0 ? "#f59e0b" : "var(--muted)", minWidth: 20 }}>
                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                      {r.algorithm} · {r.n_qubits}q
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{r.backend}</div>
                    {/* Health bar */}
                    <div style={{ background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${r.health_score}%`,
                          height: "100%",
                          background: healthColor(r.health_score),
                          borderRadius: 4,
                          transition: "width 0.4s",
                        }}
                      />
                    </div>
                  </div>
                  <HealthBadge score={r.health_score} />
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Tab: Stats
// ------------------------------------------------------------------
function StatsTab() {
  const [data, setData] = useState<FederatedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFederatedStats()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (error) return <p style={{ color: "#ef4444" }}>{error}</p>;
  if (!data) return null;

  const kpis = [
    { label: "Total Contributions", value: data.total_contributions },
    { label: "Unique Backends", value: data.unique_backends },
    { label: "Unique Algorithms", value: data.unique_algorithms },
    { label: "Avg Health Score", value: data.avg_health_score?.toFixed(1) ?? "—" },
    { label: "Last 30 Days", value: data.contributions_last_30_days },
  ];

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
        {kpis.map(kpi => (
          <div
            key={kpi.label}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "14px 20px",
              minWidth: 130,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.value}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))", gap: 24 }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
          <BarChart
            data={data.avg_health_score_by_backend}
            title="Avg Health Score by Backend"
            color="#6366f1"
          />
        </div>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
          <BarChart
            data={data.avg_health_score_by_algorithm}
            title="Avg Health Score by Algorithm"
            color="#22c55e"
          />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Tab: Contribute
// ------------------------------------------------------------------
const EMPTY_FORM: ContributeFederatedRequest = {
  algorithm: "vqe",
  backend: "ibm_sherbrooke",
  n_qubits: 5,
  circuit_depth: 20,
  n_shots: 4096,
  success_probability: 0.85,
  health_score: 80.0,
  error_rate: 0.035,
  t1_at_runtime: undefined,
  t2_at_runtime: undefined,
  algorithm_category: "chemistry",
  noise_model: "",
  error_mitigation: "none",
  tags: [],
  contributed_by: "anonymous",
};

function ContributeTab() {
  const [form, setForm] = useState<ContributeFederatedRequest>({ ...EMPTY_FORM });
  const [tagsInput, setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FederatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof ContributeFederatedRequest>(key: K, value: ContributeFederatedRequest[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const req: ContributeFederatedRequest = {
        ...form,
        tags: tagsInput.split(",").map(t => t.trim()).filter(Boolean),
        noise_model: form.noise_model || undefined,
      };
      const res = await contributeFederated(req);
      setResult(res);
      setForm({ ...EMPTY_FORM });
      setTagsInput("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--fg)",
    fontSize: 13,
    width: "100%",
  };

  const labelStyle = {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
    fontSize: 13,
  };

  const mutedLabel = { color: "var(--muted)", fontSize: 12 };

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
        Contribute anonymized results from your quantum experiments to build the shared knowledge base.
        Only aggregate metrics are stored — no raw counts or circuit IP.
      </p>

      {result && (
        <div
          style={{
            background: "#052e16",
            border: "1px solid #16a34a",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <strong style={{ color: "#22c55e" }}>Contributed successfully!</strong>
          <br />
          Result ID: <code style={{ color: "#86efac" }}>{result.result_id}</code>
          <br />
          Health Score: <strong>{result.health_score.toFixed(1)}</strong> · Backend: {result.backend}
        </div>
      )}

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#fca5a5", fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle}>
            <span style={mutedLabel}>Algorithm *</span>
            <select value={form.algorithm} onChange={e => setField("algorithm", e.target.value)} style={inputStyle} required>
              {ALGORITHMS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Backend *</span>
            <select value={form.backend} onChange={e => setField("backend", e.target.value)} style={inputStyle} required>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Qubits *</span>
            <input type="number" min={1} max={1000} value={form.n_qubits} onChange={e => setField("n_qubits", parseInt(e.target.value) || 1)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Circuit Depth *</span>
            <input type="number" min={1} value={form.circuit_depth} onChange={e => setField("circuit_depth", parseInt(e.target.value) || 1)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Shots *</span>
            <input type="number" min={1} value={form.n_shots} onChange={e => setField("n_shots", parseInt(e.target.value) || 1024)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Algorithm Category *</span>
            <select value={form.algorithm_category} onChange={e => setField("algorithm_category", e.target.value)} style={inputStyle} required>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Success Probability * (0–1)</span>
            <input type="number" min={0} max={1} step={0.001} value={form.success_probability} onChange={e => setField("success_probability", parseFloat(e.target.value) || 0)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Health Score * (0–100)</span>
            <input type="number" min={0} max={100} step={0.1} value={form.health_score} onChange={e => setField("health_score", parseFloat(e.target.value) || 0)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Error Rate *</span>
            <input type="number" min={0} max={1} step={0.001} value={form.error_rate} onChange={e => setField("error_rate", parseFloat(e.target.value) || 0)} style={inputStyle} required />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Error Mitigation</span>
            <select value={form.error_mitigation ?? "none"} onChange={e => setField("error_mitigation", e.target.value)} style={inputStyle}>
              {MITIGATIONS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>T1 at Runtime (µs)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.t1_at_runtime ?? ""}
              onChange={e => setField("t1_at_runtime", e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="optional"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>T2 at Runtime (µs)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={form.t2_at_runtime ?? ""}
              onChange={e => setField("t2_at_runtime", e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="optional"
              style={inputStyle}
            />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Noise Model</span>
            <input type="text" value={form.noise_model ?? ""} onChange={e => setField("noise_model", e.target.value)} placeholder="e.g. ibm_noise_v2 (optional)" style={inputStyle} />
          </label>

          <label style={labelStyle}>
            <span style={mutedLabel}>Contributed By</span>
            <input type="text" value={form.contributed_by ?? "anonymous"} onChange={e => setField("contributed_by", e.target.value)} placeholder="anonymous" style={inputStyle} />
          </label>
        </div>

        <label style={{ ...labelStyle, marginTop: 14 }}>
          <span style={mutedLabel}>Tags (comma-separated)</span>
          <input type="text" value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="e.g. h2, vqe, ansatz" style={inputStyle} />
        </label>

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 20,
            padding: "9px 28px",
            borderRadius: 7,
            background: submitting ? "#4338ca" : "#6366f1",
            color: "#fff",
            border: "none",
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {submitting ? "Contributing…" : "Contribute Result"}
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------
// Main Page
// ------------------------------------------------------------------
const TABS = ["Browse", "Leaderboard", "Stats", "Contribute"] as const;
type Tab = (typeof TABS)[number];

export default function FederatedPage() {
  const [tab, setTab] = useState<Tab>("Browse");

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          Federated Quantum Benchmark Registry
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Cross-institution shared database of anonymized quantum experiment outcomes.
          The more labs contribute, the more valuable it becomes.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "9px 22px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "var(--fg)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
              marginBottom: -1,
              transition: "color 0.15s",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "Browse" && <BrowseTab />}
      {tab === "Leaderboard" && <LeaderboardTab />}
      {tab === "Stats" && <StatsTab />}
      {tab === "Contribute" && <ContributeTab />}
    </div>
  );
}
