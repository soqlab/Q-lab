"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FileText, Plus, Trash2, BarChart2, Printer, Download,
  RefreshCw, ChevronDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API helpers (inline — not importing from api.ts)
// ---------------------------------------------------------------------------

const API = "/qlab-api";

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("qlab_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Grant {
  grant_id: string;
  name: string;
  agency: string;
  grant_number: string;
  pi_name: string;
  institution: string;
  start_date: string;
  end_date: string;
  project_slugs: string[];
  budget_qpu_credits: number | null;
  created_at: string;
}

interface ReportSummary {
  total_runs: number;
  successful_runs: number;
  success_rate: number;
  total_shots: number;
  unique_backends: number;
  unique_circuits: number;
  avg_health_score: number | null;
}

interface GrantReport {
  grant: Grant;
  report_generated_at: string;
  reporting_period: { start: string; end: string };
  summary: ReportSummary;
  by_month: Array<{ month: string; runs: number; shots: number }>;
  by_project: Array<{ slug: string; runs: number; shots: number }>;
  by_backend: Array<{ backend: string; runs: number; avg_health: number | null }>;
  run_list: Array<{
    run_id: string; circuit_name: string | null; backend: string | null;
    status: string; created_at: string | null; health_score: number | null; shots: number;
  }>;
  data_management_statement: string;
  reproducibility_note: string;
}

// ---------------------------------------------------------------------------
// Agency badge colors
// ---------------------------------------------------------------------------

const AGENCY_COLORS: Record<string, { bg: string; color: string }> = {
  NSF:       { bg: "#dbeafe", color: "#1d4ed8" },
  DOE:       { bg: "#dcfce7", color: "#15803d" },
  DARPA:     { bg: "#fee2e2", color: "#dc2626" },
  NIH:       { bg: "#fef9c3", color: "#a16207" },
  "EU-H2020":{ bg: "#ede9fe", color: "#7c3aed" },
  Other:     { bg: "#f3f4f6", color: "#4b5563" },
};

function AgencyBadge({ agency }: { agency: string }) {
  const c = AGENCY_COLORS[agency] ?? AGENCY_COLORS.Other;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 10px",
      borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.color,
    }}>
      {agency}
    </span>
  );
}

function KPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 10,
      padding: "14px 18px", minWidth: 120, textAlign: "center",
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#60c5ff" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#7a96b0", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple SVG bar chart
// ---------------------------------------------------------------------------

function MonthlyBarChart({ data }: { data: Array<{ month: string; runs: number; shots: number }> }) {
  if (!data.length) return <div style={{ color: "#7a96b0", fontSize: 13 }}>No monthly data.</div>;
  const maxRuns = Math.max(...data.map(d => d.runs), 1);
  const W = 560, H = 140, PAD = 40, BAR_GAP = 4;
  const barW = Math.max(10, (W - PAD * 2) / data.length - BAR_GAP);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 30}`} style={{ display: "block" }}>
      {data.map((d, i) => {
        const bh = Math.max(2, ((d.runs / maxRuns) * H));
        const x = PAD + i * ((W - PAD * 2) / data.length);
        const y = H - bh + 4;
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={barW} height={bh} rx={3} fill="#1d6f8f" opacity={0.85} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="#60c5ff">{d.runs}</text>
            <text x={x + barW / 2} y={H + 20} textAnchor="middle" fontSize={9} fill="#7a96b0"
              transform={`rotate(-35, ${x + barW / 2}, ${H + 20})`}>
              {d.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tab: My Grants
// ---------------------------------------------------------------------------

function MyGrantsTab({
  grants, loading, error,
  onDelete, onReport,
}: {
  grants: Grant[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
  onReport: (g: Grant) => void;
}) {
  if (loading) return <div style={{ color: "#7a96b0", padding: 24 }}>Loading grants…</div>;
  if (error) return <div style={{ color: "#f87171", padding: 24 }}>{error}</div>;
  if (!grants.length) return (
    <div style={{ color: "#7a96b0", padding: 40, textAlign: "center" }}>
      No grants yet. Create one in the "Create Grant" tab.
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #2d3f55" }}>
            {["Name", "Agency", "Grant #", "PI", "Period", "Projects", "Actions"].map(h => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#7a96b0", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grants.map((g, i) => (
            <tr key={g.grant_id} style={{ borderBottom: "1px solid #1e2d3d", background: i % 2 === 0 ? "transparent" : "#111d2b" }}>
              <td style={{ padding: "10px 14px", fontWeight: 600, maxWidth: 220 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.name}>{g.name}</div>
              </td>
              <td style={{ padding: "10px 14px" }}><AgencyBadge agency={g.agency} /></td>
              <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#60c5ff" }}>{g.grant_number}</td>
              <td style={{ padding: "10px 14px" }}>{g.pi_name}</td>
              <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#7a96b0" }}>
                {g.start_date?.slice(0, 10)} — {g.end_date?.slice(0, 10)}
              </td>
              <td style={{ padding: "10px 14px" }}>
                <span style={{ background: "#1a2535", color: "#60c5ff", borderRadius: 12, padding: "1px 8px", fontSize: 12 }}>
                  {g.project_slugs.length} project{g.project_slugs.length !== 1 ? "s" : ""}
                </span>
              </td>
              <td style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => onReport(g)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, border: "1px solid #1d6f8f", background: "transparent", color: "#60c5ff", cursor: "pointer", fontSize: 12 }}
                  >
                    <BarChart2 size={13} /> Report
                  </button>
                  <button
                    onClick={() => onDelete(g.grant_id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid #3f1f1f", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 12 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Create Grant
// ---------------------------------------------------------------------------

function CreateGrantTab({ onCreated }: { onCreated: () => void }) {
  const AGENCIES = ["NSF", "DOE", "DARPA", "NIH", "EU-H2020", "Other"] as const;
  const [form, setForm] = useState({
    name: "", agency: "NSF" as typeof AGENCIES[number], grant_number: "",
    pi_name: "", institution: "", start_date: "", end_date: "",
    project_slugs_raw: "", budget_qpu_credits: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function set(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setSuccess(false);
    try {
      const slugs = form.project_slugs_raw
        .split(",").map(s => s.trim()).filter(Boolean);
      await apiFetch("/api/v1/grants", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          agency: form.agency,
          grant_number: form.grant_number,
          pi_name: form.pi_name,
          institution: form.institution,
          start_date: form.start_date,
          end_date: form.end_date,
          project_slugs: slugs,
          budget_qpu_credits: form.budget_qpu_credits ? parseInt(form.budget_qpu_credits) : null,
        }),
      });
      setSuccess(true);
      setForm({ name: "", agency: "NSF", grant_number: "", pi_name: "", institution: "", start_date: "", end_date: "", project_slugs_raw: "", budget_qpu_credits: "" });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create grant");
    } finally { setSaving(false); }
  }

  const inputStyle = {
    width: "100%", background: "#0d1b2a", border: "1px solid #2d3f55",
    borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13,
  };
  const labelStyle = { fontSize: 12, color: "#7a96b0", display: "block" as const, marginBottom: 4 };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Grant Title *</label>
          <input style={inputStyle} value={form.name} onChange={e => set("name", e.target.value)} required placeholder="e.g. NSF-2045678: Quantum Error Correction Study" />
        </div>

        <div>
          <label style={labelStyle}>Agency *</label>
          <select style={inputStyle} value={form.agency} onChange={e => set("agency", e.target.value)} required>
            {AGENCIES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Grant Number *</label>
          <input style={inputStyle} value={form.grant_number} onChange={e => set("grant_number", e.target.value)} required placeholder="2045678" />
        </div>

        <div>
          <label style={labelStyle}>Principal Investigator *</label>
          <input style={inputStyle} value={form.pi_name} onChange={e => set("pi_name", e.target.value)} required placeholder="Dr. Jane Smith" />
        </div>

        <div>
          <label style={labelStyle}>Institution *</label>
          <input style={inputStyle} value={form.institution} onChange={e => set("institution", e.target.value)} required placeholder="MIT" />
        </div>

        <div>
          <label style={labelStyle}>Start Date *</label>
          <input style={inputStyle} type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} required />
        </div>

        <div>
          <label style={labelStyle}>End Date *</label>
          <input style={inputStyle} type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} required />
        </div>

        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Project Slugs (comma-separated)</label>
          <input style={inputStyle} value={form.project_slugs_raw} onChange={e => set("project_slugs_raw", e.target.value)} placeholder="vqe-study, qaoa-maxcut, error-correction" />
        </div>

        <div>
          <label style={labelStyle}>Budget (QPU Credits)</label>
          <input style={inputStyle} type="number" value={form.budget_qpu_credits} onChange={e => set("budget_qpu_credits", e.target.value)} placeholder="Optional" />
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: "10px 14px", background: "#2a1515", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ marginTop: 14, padding: "10px 14px", background: "#0f2a1a", border: "1px solid #14532d", borderRadius: 6, color: "#4ade80", fontSize: 13 }}>
          Grant created successfully!
        </div>
      )}

      <button
        type="submit" disabled={saving}
        style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#1d6f8f", color: "#fff", border: "none", borderRadius: 7, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 }}
      >
        <Plus size={15} /> {saving ? "Creating…" : "Create Grant"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tab: Compliance Reports
// ---------------------------------------------------------------------------

function ComplianceReportsTab({ grants }: { grants: Grant[] }) {
  const [selectedId, setSelectedId] = useState("");
  const [report, setReport] = useState<GrantReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport(grantId: string) {
    if (!grantId) return;
    setLoading(true); setError(null); setReport(null);
    try {
      const data = await apiFetch(`/api/v1/grants/${grantId}/report`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally { setLoading(false); }
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedId(e.target.value);
    loadReport(e.target.value);
  }

  function exportJSON() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `grant-report-${selectedId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function printReport() { window.print(); }

  const s = report?.summary;
  const selectStyle = {
    background: "#0d1b2a", border: "1px solid #2d3f55",
    borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13,
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <select style={{ ...selectStyle, minWidth: 280 }} value={selectedId} onChange={handleSelectChange}>
          <option value="">-- Select a grant --</option>
          {grants.map(g => (
            <option key={g.grant_id} value={g.grant_id}>{g.name} ({g.agency})</option>
          ))}
        </select>
        {report && (
          <>
            <button onClick={printReport} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontSize: 13 }}>
              <Printer size={14} /> Print Report
            </button>
            <button onClick={exportJSON} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontSize: 13 }}>
              <Download size={14} /> Export JSON
            </button>
            <a href={`/qlab-api/api/v1/grants/${selectedId}/report.pdf`} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a2535", border: "1px solid #2d3f55", borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontSize: 13, textDecoration: "none" }}>
              <FileText size={14} /> HTML/Print View
            </a>
          </>
        )}
      </div>

      {loading && <div style={{ color: "#7a96b0", padding: 24 }}>Loading report…</div>}
      {error && <div style={{ color: "#f87171", padding: 12, background: "#2a1515", borderRadius: 6 }}>{error}</div>}

      {report && s && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Header */}
          <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "18px 22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{report.grant.name}</h3>
                <div style={{ color: "#7a96b0", fontSize: 13, marginTop: 4 }}>
                  <AgencyBadge agency={report.grant.agency} />
                  <span style={{ marginLeft: 10 }}>{report.grant.grant_number}</span>
                  <span style={{ marginLeft: 10 }}>PI: {report.grant.pi_name}</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#4a6f8f" }}>
                Generated {new Date(report.report_generated_at).toLocaleString()}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KPI label="Total Runs" value={s.total_runs} />
            <KPI label="Successful" value={s.successful_runs} />
            <KPI label="Success Rate" value={`${(s.success_rate * 100).toFixed(1)}%`} />
            <KPI label="Total Shots" value={s.total_shots.toLocaleString()} />
            <KPI label="Backends" value={s.unique_backends} />
            <KPI label="Circuits" value={s.unique_circuits} />
            <KPI label="Avg Health" value={s.avg_health_score ?? "—"} />
          </div>

          {/* Monthly chart */}
          <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "18px 22px" }}>
            <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Monthly Activity</h4>
            <MonthlyBarChart data={report.by_month} />
          </div>

          {/* By backend table */}
          <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "18px 22px" }}>
            <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Backend Utilization</h4>
            {report.by_backend.length === 0 ? (
              <div style={{ color: "#7a96b0", fontSize: 13 }}>No backend data.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2d3f55" }}>
                    {["Backend", "Runs", "Avg Health Score"].map(h => (
                      <th key={h} style={{ padding: "7px 12px", textAlign: "left", color: "#7a96b0", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.by_backend.map(b => (
                    <tr key={b.backend} style={{ borderBottom: "1px solid #1a2535" }}>
                      <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>{b.backend}</td>
                      <td style={{ padding: "7px 12px" }}>{b.runs}</td>
                      <td style={{ padding: "7px 12px", color: b.avg_health != null ? (b.avg_health >= 70 ? "#4ade80" : b.avg_health >= 40 ? "#fbbf24" : "#f87171") : "#7a96b0" }}>
                        {b.avg_health != null ? b.avg_health.toFixed(1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Run list */}
          <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "18px 22px" }}>
            <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>
              Recent Runs {report.run_list.length >= 20 ? "(first 20 shown)" : ""}
            </h4>
            {report.run_list.length === 0 ? (
              <div style={{ color: "#7a96b0", fontSize: 13 }}>No runs in reporting period.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2d3f55" }}>
                      {["Run ID", "Circuit", "Backend", "Status", "Health", "Date"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#7a96b0", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.run_list.slice(0, 20).map(r => (
                      <tr key={r.run_id} style={{ borderBottom: "1px solid #1a2535" }}>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: "#60c5ff" }}>{r.run_id.slice(0, 16)}…</td>
                        <td style={{ padding: "6px 10px" }}>{r.circuit_name ?? "—"}</td>
                        <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>{r.backend ?? "—"}</td>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{
                            padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                            background: r.status === "completed" ? "#14532d" : r.status === "failed" ? "#7f1d1d" : "#1e3a5f",
                            color: r.status === "completed" ? "#4ade80" : r.status === "failed" ? "#f87171" : "#60c5ff",
                          }}>
                            {r.status}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", color: r.health_score != null ? (r.health_score >= 70 ? "#4ade80" : r.health_score >= 40 ? "#fbbf24" : "#f87171") : "#7a96b0" }}>
                          {r.health_score ?? "—"}
                        </td>
                        <td style={{ padding: "6px 10px", color: "#7a96b0", whiteSpace: "nowrap" }}>
                          {r.created_at ? r.created_at.slice(0, 10) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Statements */}
          <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderRadius: 10, padding: "16px 22px", fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
            <p><strong style={{ color: "#e2e8f0" }}>Data Management:</strong> {report.data_management_statement}</p>
            <p style={{ marginTop: 10 }}><strong style={{ color: "#e2e8f0" }}>Reproducibility:</strong> {report.reproducibility_note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = "grants" | "create" | "reports";

export default function GrantsPage() {
  const [tab, setTab] = useState<Tab>("grants");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiFetch("/api/v1/grants");
      setGrants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grants");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(grantId: string) {
    if (!confirm("Delete this grant?")) return;
    try {
      await apiFetch(`/api/v1/grants/${grantId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function handleReport(g: Grant) {
    setTab("reports");
    // Slight delay to let the tab switch render, then set dropdown
    setTimeout(() => {
      const sel = document.querySelector<HTMLSelectElement>("#grant-select");
      if (sel) {
        sel.value = g.grant_id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, 50);
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "grants", label: "My Grants", icon: FileText },
    { id: "create", label: "Create Grant", icon: Plus },
    { id: "reports", label: "Compliance Reports", icon: BarChart2 },
  ];

  const tabBtnStyle = (active: boolean) => ({
    display: "flex", alignItems: "center", gap: 6,
    padding: "8px 18px", borderRadius: "6px 6px 0 0", cursor: "pointer",
    border: "1px solid #2d3f55", borderBottom: active ? "none" : "1px solid #2d3f55",
    background: active ? "#0d1b2a" : "transparent",
    color: active ? "#60c5ff" : "#7a96b0",
    fontWeight: active ? 700 : 400, fontSize: 13,
    marginBottom: active ? -1 : 0,
  });

  return (
    <main style={{ padding: "24px 28px", background: "#070f1a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <FileText size={22} color="#60c5ff" />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Grant Compliance</h1>
        <button onClick={load} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "transparent", border: "1px solid #2d3f55", borderRadius: 6, color: "#7a96b0", cursor: "pointer", fontSize: 12 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #2d3f55", marginBottom: 0 }}>
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={tabBtnStyle(tab === t.id)}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ background: "#0d1b2a", border: "1px solid #2d3f55", borderTop: "none", borderRadius: "0 6px 6px 6px", padding: "22px" }}>
        {tab === "grants" && (
          <MyGrantsTab grants={grants} loading={loading} error={error} onDelete={handleDelete} onReport={handleReport} />
        )}
        {tab === "create" && (
          <CreateGrantTab onCreated={() => { void load(); setTab("grants"); }} />
        )}
        {tab === "reports" && (
          <ComplianceReportsTab grants={grants} />
        )}
      </div>
    </main>
  );
}
