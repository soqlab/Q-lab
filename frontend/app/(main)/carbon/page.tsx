"use client";

import { useState, useEffect } from "react";
import { Leaf, Zap, Car, Plane, Loader, Download, BarChart3, FlaskConical } from "lucide-react";
import { qlabApiPath } from "../../../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CarbonEstimate {
  backend: string;
  qpu_time_seconds: number;
  region: string;
  hardware_power_kw: number;
  energy_kwh: number;
  energy_kwh_with_pue: number;
  carbon_intensity_gco2_kwh: number;
  co2_grams: number;
  co2_grams_raw: number;
  pue_factor: number;
  comparisons: {
    car_meters: number;
    emails: number;
    led_bulb_hours: number;
  };
  methodology: string;
  uncertainty: string;
}

interface RunCarbonResult extends CarbonEstimate {
  run_metadata: {
    run_id: string;
    circuit_name: string | null;
    backend: string | null;
    project_slug: string | null;
    status: string;
    created_at: string | null;
  };
}

interface ProjectCarbonResult {
  project_slug: string;
  runs_counted: number;
  total_co2_grams: number;
  by_backend: Record<string, number>;
  by_month: Record<string, number>;
  equivalent_car_km: number;
  equivalent_transatlantic_flights: number;
  region: string;
}

interface SummaryResult {
  total_runs: number;
  total_co2_grams: number;
  equivalent_car_km: number;
  equivalent_transatlantic_flights: number;
  by_backend: Record<string, number>;
  by_month: Record<string, number>;
  cleanest_backend: string | null;
  dirtiest_backend: string | null;
  suggestions: string[];
  region: string;
}

interface BackendComparison {
  backend: string;
  co2_grams: number;
  hardware_power_kw: number;
  energy_kwh_with_pue: number;
  region_assumption: string;
  relative_to_worst: number;
}

interface CarbonCertificate {
  certificate_type: string;
  version: string;
  issued_at: string;
  experiment: {
    run_id: string;
    circuit_name: string;
    backend: string | null;
    project: string | null;
    executed_at: string | null;
  };
  carbon_footprint: {
    co2_grams: number;
    co2_kg: number;
    energy_kwh: number;
    energy_kwh_with_pue: number;
    pue_factor: number;
  };
  assumptions: {
    qpu_time_seconds: number;
    hardware_power_kw: number;
    region: string;
    carbon_intensity_gco2_kwh: number;
    methodology: string;
    uncertainty: string;
  };
  comparisons: {
    car_meters: number;
    emails: number;
    led_bulb_hours: number;
  };
  citation_text: string;
}

// ---------------------------------------------------------------------------
// Regions list
// ---------------------------------------------------------------------------

const REGIONS = [
  { value: "us-east", label: "US East (386 gCO2/kWh)" },
  { value: "us-west", label: "US West (210 gCO2/kWh)" },
  { value: "eu-west", label: "EU West (233 gCO2/kWh)" },
  { value: "eu-north", label: "EU North / Nordic (45 gCO2/kWh)" },
  { value: "asia-pacific", label: "Asia-Pacific (520 gCO2/kWh)" },
  { value: "canada", label: "Canada (140 gCO2/kWh)" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function co2Color(grams: number): string {
  if (grams < 0.01) return "#27ae60";
  if (grams < 0.1) return "#2ecc71";
  if (grams < 1) return "#f39c12";
  if (grams < 10) return "#e67e22";
  return "#e74c3c";
}

function fmt(n: number, decimals = 4): string {
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(2);
  return n.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub, icon, color = "#1d6f8f" }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color?: string;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 160,
      border: "1px solid var(--border)", borderRadius: 8,
      padding: "16px 18px", background: "var(--panel)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar chart (SVG)
// ---------------------------------------------------------------------------

function MonthlyBarChart({ data, height = 160 }: { data: Record<string, number>; height?: number }) {
  const entries = Object.entries(data);
  if (!entries.length) return <div style={{ color: "var(--muted)", fontSize: 13, padding: 16 }}>No monthly data</div>;

  const W = 600, H = height, PL = 50, PR = 10, PT = 10, PB = 34;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const maxVal = Math.max(...entries.map(([, v]) => v), 0.0001);
  const barW = Math.max(6, chartW / entries.length - 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="Monthly CO2">
      {/* Y axis */}
      {[0, 0.5, 1].map(f => {
        const y = PT + (1 - f) * chartH;
        const v = maxVal * f;
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={PL + chartW} y2={y} stroke="#edf0f3" strokeWidth={1} />
            <text x={PL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9aa8b6">
              {v < 0.001 ? v.toExponential(1) : v.toFixed(3)}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {entries.map(([month, val], i) => {
        const barH = (val / maxVal) * chartH;
        const x = PL + (i / entries.length) * chartW + 2;
        const y = PT + chartH - barH;
        return (
          <g key={month}>
            <rect x={x} y={y} width={barW} height={barH} fill="#1d6f8f" rx={2} opacity={0.85} />
            <text x={x + barW / 2} y={H - PB + 14} textAnchor="middle" fontSize={9} fill="#9aa8b6">
              {month.slice(5)}
            </text>
          </g>
        );
      })}
      {/* Axis labels */}
      <text x={PL - 30} y={PT + chartH / 2} textAnchor="middle" fontSize={9} fill="#9aa8b6"
        transform={`rotate(-90 ${PL - 30} ${PT + chartH / 2})`}>
        gCO2
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Backend comparison table
// ---------------------------------------------------------------------------

function BackendComparisonTable({ backends }: { backends: BackendComparison[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "var(--panel-2, #f7f8fa)", borderBottom: "1px solid var(--border)" }}>
          <th style={{ padding: "9px 12px", textAlign: "left" }}>Rank</th>
          <th style={{ padding: "9px 12px", textAlign: "left" }}>Backend</th>
          <th style={{ padding: "9px 12px", textAlign: "right" }}>CO2 (g)</th>
          <th style={{ padding: "9px 12px", textAlign: "right" }}>Power (kW)</th>
          <th style={{ padding: "9px 12px", textAlign: "right" }}>Relative</th>
          <th style={{ padding: "9px 12px", textAlign: "left" }}>Footprint</th>
        </tr>
      </thead>
      <tbody>
        {backends.map((b, i) => {
          const relPct = b.relative_to_worst * 100;
          const color = co2Color(b.co2_grams);
          return (
            <tr key={b.backend} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--panel-2, #f7f8fa)" }}>
              <td style={{ padding: "8px 12px", fontWeight: 700, color: i === 0 ? "#27ae60" : "var(--muted)" }}>
                #{i + 1} {i === 0 && "✓"}
              </td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{b.backend}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color }}>{fmt(b.co2_grams)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--muted)" }}>{b.hardware_power_kw}</td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                  <div style={{ width: 60, height: 6, background: "#e8ecf0", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${relPct}%`, background: color, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 32 }}>{(relPct).toFixed(0)}%</span>
                </div>
              </td>
              <td style={{ padding: "8px 12px" }}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", background: `${color}18`, color, borderRadius: 4, fontWeight: 600 }}>
                    {b.co2_grams < 0.001 ? "ultra-low" : b.co2_grams < 0.01 ? "very low" : b.co2_grams < 0.1 ? "low" : b.co2_grams < 1 ? "medium" : "high"}
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CarbonPage() {
  const [region, setRegion] = useState("us-east");

  // Run-level
  const [runId, setRunId] = useState("");
  const [runResult, setRunResult] = useState<RunCarbonResult | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<CarbonCertificate | null>(null);
  const [certLoading, setCertLoading] = useState(false);

  // Project-level
  const [projectSlug, setProjectSlug] = useState("");
  const [projectResult, setProjectResult] = useState<ProjectCarbonResult | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  // Lab summary
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Backend comparison
  const [comparison, setComparison] = useState<BackendComparison[] | null>(null);
  const [compLoading, setCompLoading] = useState(false);

  // Load summary + comparison on mount
  useEffect(() => {
    void loadSummary();
    void loadComparison();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const res = await fetch(qlabApiPath(`/api/v1/carbon/summary?region=${region}`), { cache: "no-store" });
      if (res.ok) setSummary(await res.json());
    } catch {
      // non-critical
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadComparison() {
    setCompLoading(true);
    try {
      const res = await fetch(qlabApiPath(`/api/v1/carbon/comparison/backends?region=${region}`), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setComparison(data.backends);
      }
    } catch {
      // non-critical
    } finally {
      setCompLoading(false);
    }
  }

  async function handleRunCheck() {
    if (!runId.trim()) return;
    setRunLoading(true);
    setRunError(null);
    setRunResult(null);
    setCertificate(null);
    try {
      const res = await fetch(qlabApiPath(`/api/v1/carbon/run/${runId.trim()}?region=${region}`), { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      setRunResult(await res.json());
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunLoading(false);
    }
  }

  async function handleProjectCheck() {
    if (!projectSlug.trim()) return;
    setProjectLoading(true);
    setProjectError(null);
    setProjectResult(null);
    try {
      const res = await fetch(qlabApiPath(`/api/v1/carbon/project/${projectSlug.trim()}?region=${region}`), { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      setProjectResult(await res.json());
    } catch (e: unknown) {
      setProjectError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setProjectLoading(false);
    }
  }

  async function handleCertificate() {
    if (!runId.trim()) return;
    setCertLoading(true);
    try {
      const res = await fetch(qlabApiPath(`/api/v1/carbon/certificate/${runId.trim()}?region=${region}`), { cache: "no-store" });
      if (res.ok) setCertificate(await res.json());
    } catch {
      // ignore
    } finally {
      setCertLoading(false);
    }
  }

  function downloadCert() {
    if (!certificate) return;
    const blob = new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carbon-certificate-${certificate.experiment.run_id?.slice(0, 8) ?? "run"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page">
      {/* Header */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Leaf size={18} style={{ color: "#27ae60" }} /> Circuit Carbon Footprint
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Grid region:</label>
            <select
              className="input"
              value={region}
              onChange={e => setRegion(e.target.value)}
              style={{ fontSize: 12, height: 30, width: 220 }}
            >
              {REGIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Lab-wide KPI strip */}
      {summary && (
        <section className="panel">
          <div className="panel-header">
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart3 size={16} /> Lab-Wide Carbon Summary
            </h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{summary.total_runs} total runs</span>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard
              label="Total CO2"
              value={`${fmt(summary.total_co2_grams, 2)} g`}
              sub="grams CO2-equivalent"
              icon={<Leaf size={16} />}
              color="#27ae60"
            />
            <KpiCard
              label="Equivalent Car Distance"
              value={`${fmt(summary.equivalent_car_km, 2)} km`}
              sub="at 0.21 kg CO2/km"
              icon={<Car size={16} />}
              color="#e67e22"
            />
            <KpiCard
              label="Transatlantic Flights"
              value={summary.equivalent_transatlantic_flights.toExponential(2)}
              sub="passenger equivalents"
              icon={<Plane size={16} />}
              color="#9b59b6"
            />
            <KpiCard
              label="Cleanest Backend"
              value={summary.cleanest_backend ?? "—"}
              sub="lowest CO2 per run"
              icon={<Zap size={16} />}
              color="#1d6f8f"
            />
          </div>
          {summary.suggestions.length > 0 && (
            <div style={{ padding: "0 18px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {summary.suggestions.map((s, i) => (
                <div key={i} style={{ fontSize: 12, color: "#7d5a00", background: "#fffbea", border: "1px solid #f39c12", borderRadius: 6, padding: "8px 12px", display: "flex", gap: 8 }}>
                  <Leaf size={13} style={{ color: "#27ae60", flexShrink: 0, marginTop: 1 }} />
                  {s}
                </div>
              ))}
            </div>
          )}
          {Object.keys(summary.by_month).length > 0 && (
            <div style={{ padding: "0 18px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>Monthly CO2 Trend</div>
              <MonthlyBarChart data={summary.by_month} />
            </div>
          )}
          {Object.keys(summary.by_backend).length > 0 && (
            <div style={{ padding: "0 18px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>By Backend</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {Object.entries(summary.by_backend).slice(0, 8).map(([backend, co2]) => {
                  const total = summary.total_co2_grams || 1;
                  const pct = (co2 / total) * 100;
                  return (
                    <div key={backend} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                      <span style={{ fontFamily: "monospace", minWidth: 160, color: "var(--muted)" }}>{backend}</span>
                      <div style={{ flex: 1, height: 8, background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: co2Color(co2 / (summary.total_runs || 1)), borderRadius: 4 }} />
                      </div>
                      <span style={{ minWidth: 70, textAlign: "right", color: "var(--muted)" }}>{fmt(co2, 3)} g ({pct.toFixed(1)}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
      {summaryLoading && (
        <div className="panel" style={{ padding: "24px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          <Loader size={16} style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 8 }} />
          Loading lab summary…
        </div>
      )}

      {/* Run-level calculator */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FlaskConical size={16} /> Run Carbon Calculator
          </h2>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: 400 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Run ID</label>
              <input
                className="input"
                value={runId}
                onChange={e => setRunId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRunCheck()}
                placeholder="e.g. abc12345-..."
                style={{ width: "100%" }}
              />
            </div>
            <button
              className="button"
              onClick={handleRunCheck}
              disabled={runLoading || !runId.trim()}
              style={{ height: 36 }}
            >
              {runLoading ? <Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> : "Estimate Footprint"}
            </button>
          </div>

          {runError && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef5f5", border: "1px solid #e74c3c", borderRadius: 6, fontSize: 13, color: "#e74c3c" }}>
              {runError}
            </div>
          )}

          {runResult && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <KpiCard
                  label="CO2 Emitted"
                  value={`${fmt(runResult.co2_grams)} g`}
                  sub={`raw: ${fmt(runResult.co2_grams_raw)} g + PUE`}
                  icon={<Leaf size={16} />}
                  color={co2Color(runResult.co2_grams)}
                />
                <KpiCard
                  label="Energy Used"
                  value={`${fmt(runResult.energy_kwh_with_pue, 6)} kWh`}
                  sub={`${runResult.hardware_power_kw} kW × ${runResult.qpu_time_seconds.toFixed(3)}s`}
                  icon={<Zap size={16} />}
                  color="#e67e22"
                />
                <KpiCard
                  label="Equivalent to"
                  value={`${runResult.comparisons.car_meters.toFixed(1)} m`}
                  sub="driven by car"
                  icon={<Car size={16} />}
                  color="#9b59b6"
                />
                <KpiCard
                  label="Or"
                  value={`${runResult.comparisons.emails.toFixed(0)} emails`}
                  sub={`${runResult.comparisons.led_bulb_hours.toFixed(2)} hr LED bulb`}
                  icon={<Leaf size={16} />}
                  color="#1d6f8f"
                />
              </div>

              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.7, padding: "10px 14px", background: "var(--panel-2, #f7f8fa)", borderRadius: 6, border: "1px solid var(--border)" }}>
                <strong>Methodology:</strong> {runResult.methodology}<br />
                <strong>Uncertainty:</strong> {runResult.uncertainty}<br />
                <strong>Backend:</strong> {runResult.backend} | <strong>Region:</strong> {runResult.region} | <strong>PUE:</strong> {runResult.pue_factor} | <strong>Grid:</strong> {runResult.carbon_intensity_gco2_kwh} gCO2/kWh
              </div>

              {/* Carbon Certificate */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="button secondary"
                  onClick={handleCertificate}
                  disabled={certLoading}
                  style={{ height: 30, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {certLoading
                    ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />
                    : <Download size={13} />
                  }
                  Generate Carbon Certificate
                </button>
                {certificate && (
                  <button
                    className="button"
                    onClick={downloadCert}
                    style={{ height: 30, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Download size={13} /> Download JSON
                  </button>
                )}
              </div>

              {certificate && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>
                    Carbon Certificate — Supplementary Materials Text
                  </div>
                  <div style={{
                    fontFamily: "monospace", fontSize: 11, lineHeight: 1.7,
                    background: "#f4f6f8", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "12px 14px", color: "#17202a",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {certificate.citation_text}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Project-level */}
      <section className="panel">
        <div className="panel-header">
          <h2>Project Carbon Footprint</h2>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: 400 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Project Slug</label>
              <input
                className="input"
                value={projectSlug}
                onChange={e => setProjectSlug(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleProjectCheck()}
                placeholder="e.g. my-qpu-experiment"
                style={{ width: "100%" }}
              />
            </div>
            <button
              className="button"
              onClick={handleProjectCheck}
              disabled={projectLoading || !projectSlug.trim()}
              style={{ height: 36 }}
            >
              {projectLoading ? <Loader size={15} style={{ animation: "spin 1s linear infinite" }} /> : "Analyze Project"}
            </button>
          </div>

          {projectError && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef5f5", border: "1px solid #e74c3c", borderRadius: 6, fontSize: 13, color: "#e74c3c" }}>
              {projectError}
            </div>
          )}

          {projectResult && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <KpiCard
                  label="Total CO2"
                  value={`${fmt(projectResult.total_co2_grams, 2)} g`}
                  sub={`${projectResult.runs_counted} runs`}
                  icon={<Leaf size={16} />}
                  color={co2Color(projectResult.total_co2_grams)}
                />
                <KpiCard
                  label="Car Distance"
                  value={`${fmt(projectResult.equivalent_car_km, 3)} km`}
                  sub="driven equivalent"
                  icon={<Car size={16} />}
                  color="#e67e22"
                />
                <KpiCard
                  label="Flights"
                  value={projectResult.equivalent_transatlantic_flights.toExponential(2)}
                  sub="transatlantic equiv."
                  icon={<Plane size={16} />}
                  color="#9b59b6"
                />
              </div>

              {Object.keys(projectResult.by_month).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>Monthly Trend</div>
                  <MonthlyBarChart data={projectResult.by_month} />
                </div>
              )}

              {Object.keys(projectResult.by_backend).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>By Backend</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {Object.entries(projectResult.by_backend).map(([backend, co2]) => {
                      const total = projectResult.total_co2_grams || 1;
                      const pct = (co2 / total) * 100;
                      return (
                        <div key={backend} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                          <span style={{ fontFamily: "monospace", minWidth: 160, color: "var(--muted)" }}>{backend}</span>
                          <div style={{ flex: 1, height: 8, background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: co2Color(co2 / (projectResult.runs_counted || 1)), borderRadius: 4 }} />
                          </div>
                          <span style={{ minWidth: 100, textAlign: "right", color: "var(--muted)" }}>{fmt(co2, 3)} g ({pct.toFixed(1)}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Backend comparison */}
      <section className="panel">
        <div className="panel-header">
          <h2>Backend Carbon Comparison</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Standard 5-qubit, 100-shot, 1-second run</span>
        </div>
        <div style={{ padding: "16px 18px" }}>
          {compLoading && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Loader size={16} style={{ animation: "spin 1s linear infinite", display: "inline-block", marginRight: 8 }} />
              Loading comparison…
            </div>
          )}
          {comparison && (
            <div style={{ overflowX: "auto" }}>
              <BackendComparisonTable backends={comparison} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
                Note: Power figures are estimates from published vendor data. Actual values depend on system utilization, cooling infrastructure, and facility-specific PUE.
                Region assumption: <strong>{region}</strong>.
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
