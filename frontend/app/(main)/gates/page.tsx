"use client";
import { useEffect, useState } from "react";
import {
  GateCharResult, GateCharSummary, GateCharTrend,
  submitGateChar, listGateCharResults, getGateCharSummary, getGateCharTrend,
} from "../../../lib/api";
import { Activity, Plus, TrendingDown } from "lucide-react";

const CHAR_TYPES = ["t1", "t2", "rb_single", "rb_two"];
const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "simulator_statevector", "custom"];

function DecayChart({ data, fitParams, charType }: { data: { x: number; y: number }[]; fitParams: GateCharResult["fit_params"]; charType: string }) {
  if (!data.length) return null;
  const W = 340; const H = 140; const PAD = 30;
  const xs = data.map(d => d.x); const ys = data.map(d => d.y);
  const xMin = Math.min(...xs); const xMax = Math.max(...xs);
  const yMin = 0; const yMax = 1;
  const px = (x: number) => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  const py = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);
  const points = data.map(d => `${px(d.x)},${py(d.y)}`).join(" ");
  const metric = charType === "t1" ? fitParams.T1_us : charType === "t2" ? fitParams.T2_us : fitParams.gate_fidelity;
  const unit = charType === "t1" || charType === "t2" ? "µs" : "";
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" strokeWidth={1} />
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      {data.map((d, i) => <circle key={i} cx={px(d.x)} cy={py(d.y)} r={2.5} fill="#60a5fa" />)}
      {metric != null && (
        <text x={W - PAD - 2} y={PAD + 14} textAnchor="end" fill="#10b981" fontSize={12} fontWeight={700}>
          {charType.toUpperCase()} = {typeof metric === "number" ? metric.toFixed(2) : "—"}{unit}
        </text>
      )}
    </svg>
  );
}

function CsvInput({ onChange }: { onChange: (data: { x: number; y: number }[]) => void }) {
  const [raw, setRaw] = useState("");
  const handleParse = () => {
    const rows = raw.trim().split("\n").map(r => r.split(/[,\s]+/)).filter(r => r.length >= 2);
    const parsed = rows.map(r => ({ x: parseFloat(r[0]), y: parseFloat(r[1]) })).filter(d => !isNaN(d.x) && !isNaN(d.y));
    onChange(parsed);
  };
  return (
    <div>
      <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={4} placeholder={"0,1.0\n10,0.85\n20,0.72\n…"}
        style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem", boxSizing: "border-box", resize: "vertical" }} />
      <button onClick={handleParse}
        style={{ marginTop: 6, background: "#0f172a", border: "1px solid #334155", color: "#3b82f6", borderRadius: 6, padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.8rem" }}>
        Parse x,y data
      </button>
    </div>
  );
}

export default function GatesPage() {
  const [results, setResults] = useState<GateCharResult[]>([]);
  const [summary, setSummary] = useState<GateCharSummary | null>(null);
  const [trend, setTrend] = useState<GateCharTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterBackend, setFilterBackend] = useState("ibm_brisbane");
  const [filterType, setFilterType] = useState("t1");
  const [curveData, setCurveData] = useState<{ x: number; y: number }[]>([]);
  const [form, setForm] = useState({ backend: "ibm_brisbane", char_type: "t1", qubit: 0, n_qubits: 1 });
  const [activeTab, setActiveTab] = useState<"results" | "summary" | "trend">("results");

  const load = async () => {
    setLoading(true);
    try {
      const [r, s, t] = await Promise.all([
        listGateCharResults({ backend: filterBackend, char_type: filterType }),
        getGateCharSummary(filterBackend),
        getGateCharTrend(filterBackend, filterType),
      ]);
      setResults(r); setSummary(s); setTrend(t);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterBackend, filterType]);

  const handleSubmit = async () => {
    if (!curveData.length) { setError("Add curve data first"); return; }
    setSaving(true); setError(null);
    try {
      await submitGateChar({ backend: form.backend, char_type: form.char_type, qubit: form.qubit, curve_data: curveData, n_qubits: form.n_qubits });
      setShowForm(false); setCurveData([]);
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const metricLabel = (r: GateCharResult) => {
    if (r.metric_value == null) return "—";
    return `${r.metric_value.toFixed(3)} ${r.metric_unit ?? ""}`;
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <Activity size={28} color="#3b82f6" /> Gate Characterization
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            T1/T2 decay fitting, randomized benchmarking, per-qubit fidelity tracking.
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Submit Curve
        </button>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      {showForm && (
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Submit Characterization Curve</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            {[
              { k: "backend", label: "Backend", type: "select", opts: BACKENDS },
              { k: "char_type", label: "Type", type: "select", opts: CHAR_TYPES },
              { k: "qubit", label: "Qubit Index", type: "number" },
              { k: "n_qubits", label: "n_qubits (for RB)", type: "number" },
            ].map(({ k, label, type, opts }) => (
              <label key={k} style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                {label}
                {type === "select" ? (
                  <select value={(form as Record<string, unknown>)[k] as string} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
                    {(opts ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="number" value={(form as Record<string, unknown>)[k] as number} onChange={e => setForm(f => ({ ...f, [k]: parseInt(e.target.value) || 0 }))}
                    style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
                )}
              </label>
            ))}
          </div>
          <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Curve Data (x,y pairs — one per line)
            <CsvInput onChange={setCurveData} />
            {curveData.length > 0 && <span style={{ color: "#10b981", fontSize: "0.78rem" }}>{curveData.length} points parsed</span>}
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
            <button onClick={handleSubmit} disabled={saving}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer", fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Fitting…" : "Submit & Fit"}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <select value={filterBackend} onChange={e => setFilterBackend(e.target.value)}
          style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "0.45rem 0.9rem", fontSize: "0.85rem" }}>
          {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "0.45rem 0.9rem", fontSize: "0.85rem" }}>
          {CHAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: "1rem", borderBottom: "1px solid #1e293b" }}>
        {(["results", "summary", "trend"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: "0.6rem 1.2rem", background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab ? "#3b82f6" : "transparent"}`, color: activeTab === tab ? "#e2e8f0" : "#64748b", cursor: "pointer", fontWeight: 600, textTransform: "capitalize" }}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "results" && (
        loading ? <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>Loading…</div> :
        results.length === 0 ? (
          <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>
            <Activity size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
            <p>No characterization results. Submit your first curve above.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "1rem" }}>
            {results.map(r => (
              <div key={r.char_id} style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{r.char_type.toUpperCase()}</span>
                    <span style={{ color: "#64748b", fontSize: "0.8rem", marginLeft: 8 }}>Q{r.qubit ?? "?"}</span>
                  </div>
                  <span style={{ color: "#10b981", fontWeight: 700 }}>{metricLabel(r)}</span>
                </div>
                {r.fit_params.r2 != null && (
                  <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: 8 }}>R² = {r.fit_params.r2.toFixed(4)}</div>
                )}
                <DecayChart data={r.curve_data} fitParams={r.fit_params} charType={r.char_type} />
                <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 6 }}>{new Date(r.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === "summary" && summary && (
        <div>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>{summary.backend} — per-qubit summary</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ color: "#64748b", borderBottom: "1px solid #1e293b" }}>
                {["Qubit", "Type", "Metric", "Unit", "R²", "Date"].map(h => (
                  <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.qubits.map(r => (
                <tr key={r.char_id} style={{ borderBottom: "1px solid #0f172a" }}>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8" }}>Q{r.qubit ?? "?"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{r.char_type}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#10b981", fontWeight: 600 }}>
                    {r.metric_value != null ? r.metric_value.toFixed(4) : "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{r.metric_unit ?? "—"}</td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8" }}>
                    {r.fit_params.r2 != null ? r.fit_params.r2.toFixed(3) : "—"}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", color: "#475569", fontSize: "0.78rem" }}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "trend" && trend && (
        <div>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingDown size={18} color="#3b82f6" /> {filterType.toUpperCase()} trend — {filterBackend}
          </h3>
          {trend.series.length === 0 ? (
            <p style={{ color: "#64748b" }}>No trend data available for this backend/type.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ color: "#64748b", borderBottom: "1px solid #1e293b" }}>
                  {["Date", "Qubit", "Value", "Unit"].map(h => (
                    <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trend.series.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#94a3b8" }}>{new Date(s.date).toLocaleString()}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>Q{s.qubit ?? "?"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#10b981", fontWeight: 600 }}>{s.value?.toFixed(4) ?? "—"}</td>
                    <td style={{ padding: "0.5rem 0.75rem", color: "#64748b" }}>{s.unit ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
