"use client";

import { useState } from "react";
import { Cpu, CheckCircle, AlertTriangle, XCircle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { fetchHardwareRec, type CircuitSpec, type BackendRecommendation, type HardwareRecResult } from "../../../lib/api";

const GRADE_COLOR: Record<string, string> = {
  "A+": "#1f8a5b", A: "#27ae60", "B+": "#2ecc71", B: "#f39c12",
  "C+": "#e67e22", C: "#e67e22", D: "#e74c3c", F: "#c0392b",
};

function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const color = GRADE_COLOR[grade] ?? "#888";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700,
      background: color + "22", color,
    }}>
      {grade} <span style={{ fontWeight: 400, fontSize: 11 }}>({score})</span>
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "#27ae60" : score >= 60 ? "#f39c12" : score >= 40 ? "#e67e22" : "#e74c3c";
  return (
    <div style={{ height: 6, width: "100%", background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 4, transition: "width 0.5s" }} />
    </div>
  );
}

function BackendCard({ rec, rank }: { rec: BackendRecommendation; rank: number }) {
  const [open, setOpen] = useState(rank <= 2);

  if (rec.ineligible) {
    return (
      <div style={{ border: "1px solid rgba(231,76,60,0.3)", borderRadius: 10, padding: "14px 18px", background: "rgba(231,76,60,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
        <XCircle size={18} color="#e74c3c" />
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{rec.backend}</span>
          <span style={{ marginLeft: 10, fontSize: 13, color: "#e74c3c" }}>{rec.ineligible_reason}</span>
        </div>
      </div>
    );
  }

  const calAge = rec.calibration_age_days !== null
    ? rec.calibration_age_days < 1 ? "today" : `${rec.calibration_age_days}d ago`
    : "unknown";

  return (
    <div style={{
      border: rank === 1 ? "2px solid #27ae60" : "1px solid var(--line)",
      borderRadius: 10, background: "var(--panel)", overflow: "hidden",
    }}>
      <button
        style={{ width: "100%", padding: "14px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}
        onClick={() => setOpen(o => !o)}
      >
        {rank === 1 ? <CheckCircle size={18} color="#27ae60" /> : rec.warnings.length > 0 ? <AlertTriangle size={18} color="#e67e22" /> : <HelpCircle size={18} color="#bbb" />}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>#{rank} {rec.backend}</span>
            {rank === 1 && <span style={{ fontSize: 11, background: "#eaf6ef", color: "#1f8a5b", padding: "1px 8px", borderRadius: 999, fontWeight: 600 }}>Recommended</span>}
            <GradeBadge grade={rec.grade} score={rec.score} />
          </div>
          <ScoreBar score={rec.score} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 8 }}>
          <span style={{ fontSize: 12, color: "#888" }}>Cal: {calAge}</span>
          <span style={{ fontSize: 12, color: "#888" }}>{rec.total_runs_on_backend} runs</span>
        </div>
        {open ? <ChevronUp size={16} color="#888" /> : <ChevronDown size={16} color="#888" />}
      </button>

      {open && (
        <div style={{ padding: "0 18px 16px", display: "grid", gap: 12 }}>
          {rec.reasons.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#5f6f80", marginBottom: 6 }}>Analysis</div>
              {rec.reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 13, color: "#4f5f70", padding: "3px 0", borderLeft: "3px solid #27ae60", paddingLeft: 10, marginBottom: 4 }}>{r}</div>
              ))}
            </div>
          )}
          {rec.warnings.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e67e22", marginBottom: 6 }}>Warnings</div>
              {rec.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: "#7c5500", padding: "3px 0", borderLeft: "3px solid #f39c12", paddingLeft: 10, marginBottom: 4 }}>{w}</div>
              ))}
            </div>
          )}
          {Object.keys(rec.calibration_summary).length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {rec.calibration_summary.avg_ge_2q !== undefined && rec.calibration_summary.avg_ge_2q !== null && (
                <div style={{ background: "var(--panel-2, #f7f8fa)", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5f6f80" }}>2Q gate err</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{(rec.calibration_summary.avg_ge_2q * 100).toFixed(3)}%</div>
                </div>
              )}
              {rec.calibration_summary.avg_t1_us !== undefined && rec.calibration_summary.avg_t1_us !== null && (
                <div style={{ background: "var(--panel-2, #f7f8fa)", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5f6f80" }}>Avg T1</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{rec.calibration_summary.avg_t1_us.toFixed(0)} µs</div>
                </div>
              )}
              {rec.calibration_summary.avg_ro !== undefined && rec.calibration_summary.avg_ro !== null && (
                <div style={{ background: "var(--panel-2, #f7f8fa)", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5f6f80" }}>Readout err</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{(rec.calibration_summary.avg_ro * 100).toFixed(2)}%</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_SPEC: CircuitSpec = {
  num_qubits: 5,
  depth: 20,
  size: 40,
  two_qubit_gate_count: 8,
  circuit_time_us: 10,
  non_clifford_ratio: 0.1,
};

function NumInput({ label, value, onChange, min, max, step, note }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; note?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 13, color: "var(--muted, #5f6f80)", fontWeight: 500 }}>{label}</label>
      <input
        className="input"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      {note && <span style={{ fontSize: 11, color: "#aaa" }}>{note}</span>}
    </div>
  );
}

export default function HardwarePage() {
  const [spec, setSpec] = useState<CircuitSpec>(DEFAULT_SPEC);
  const [result, setResult] = useState<HardwareRecResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof CircuitSpec) {
    return (v: number) => setSpec(s => ({ ...s, [key]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetchHardwareRec(spec);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get recommendation");
    } finally {
      setLoading(false);
    }
  }

  const eligible = result?.backends.filter(b => !b.ineligible) ?? [];
  const ineligible = result?.backends.filter(b => b.ineligible) ?? [];

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Cpu size={17} /> Hardware Recommendation
          </h2>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--muted, #5f6f80)", lineHeight: 1.6 }}>
            Enter your circuit parameters and Q-Lab will rank all backends with recent calibration data by their expected fidelity for your circuit. Scores account for 2Q gate fidelity, coherence time, readout error, and qubit availability.
          </p>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
              <NumInput label="Qubits" value={spec.num_qubits} onChange={update("num_qubits")} min={1} max={200} />
              <NumInput label="Depth" value={spec.depth} onChange={update("depth")} min={1} />
              <NumInput label="Gate count (size)" value={spec.size} onChange={update("size")} min={1} />
              <NumInput label="2Q gates" value={spec.two_qubit_gate_count} onChange={update("two_qubit_gate_count")} min={0} note="CX, ECR, CZ…" />
              <NumInput label="Circuit time (µs)" value={spec.circuit_time_us} onChange={update("circuit_time_us")} min={0} step={0.1} />
              <NumInput label="Non-Clifford ratio" value={spec.non_clifford_ratio} onChange={update("non_clifford_ratio")} min={0} max={1} step={0.01} note="T/Tdg fraction" />
            </div>
            <button className="button" type="submit" disabled={loading}>
              <Cpu size={15} /> {loading ? "Analyzing backends…" : "Get Recommendation"}
            </button>
          </form>
          {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </section>

      {result && (
        <>
          {result.recommendation && (
            <section className="panel" style={{ border: "2px solid #27ae60" }}>
              <div className="panel-header" style={{ background: "#eaf6ef" }}>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: "#1f8a5b" }}>
                  <CheckCircle size={17} /> Best Backend: {result.recommendation}
                </h2>
                <span style={{ fontSize: 12, color: "#1f8a5b" }}>
                  {result.eligible_count} of {result.backend_count} backends eligible
                </span>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-header">
              <h2>Ranked Backends ({eligible.length} eligible)</h2>
            </div>
            <div style={{ padding: "12px 16px", display: "grid", gap: 10 }}>
              {eligible.map((b, i) => (
                <BackendCard key={b.backend} rec={b} rank={i + 1} />
              ))}
              {eligible.length === 0 && (
                <div className="empty">No backends have sufficient calibration data. Run experiments on IBM/IonQ/Rigetti backends to populate recommendations.</div>
              )}
            </div>
          </section>

          {ineligible.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <h2>Ineligible Backends ({ineligible.length})</h2>
              </div>
              <div style={{ padding: "12px 16px", display: "grid", gap: 8 }}>
                {ineligible.map(b => (
                  <BackendCard key={b.backend} rec={b} rank={999} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
