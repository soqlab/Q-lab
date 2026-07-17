"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Lock, FileText, CheckCircle, XCircle, HelpCircle, Ban,
  Plus, ChevronRight, ShieldCheck, AlertTriangle, Trash2,
  Link2, RefreshCw, ClipboardList,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hypothesis {
  metric: string;
  operator: string;
  expected_value: number;
  expected_value_upper?: number | null;
  confidence: number;
  rationale: string;
}

interface HypothesisResult extends Hypothesis {
  actual_value: number | null;
  passed: boolean | null;
  result: "confirmed" | "refuted" | "inconclusive";
}

interface Prereg {
  prereg_id: string;
  title: string;
  description: string;
  researcher_name: string;
  institution?: string | null;
  circuit_description: string;
  backend: string;
  n_qubits: number;
  n_shots: number;
  algorithm: string;
  hypotheses: Hypothesis[];
  alpha: number;
  minimum_effect_size?: number | null;
  planned_run_date?: string | null;
  status: "draft" | "locked" | "run_completed" | "abandoned";
  locked_at?: string | null;
  run_id?: string | null;
  outcome?: {
    hypothesis_results?: HypothesisResult[];
    abandon_reason?: string;
    analyzed_at?: string;
    results_snapshot?: Record<string, number | null>;
  } | null;
  verdict?: "confirmed" | "refuted" | "inconclusive" | null;
  created_at: string;
  fingerprint?: string | null;
}

// ---------------------------------------------------------------------------
// API helpers (inline fetch — no api.ts)
// ---------------------------------------------------------------------------

const BASE = "/qlab-api/api/v1/prereg";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const api = {
  list: (filters?: { status?: string; researcher_name?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.researcher_name) params.set("researcher_name", filters.researcher_name);
    return apiFetch<Prereg[]>(`${BASE}?${params}`);
  },
  get: (id: string) => apiFetch<Prereg>(`${BASE}/${id}`),
  create: (body: object) => apiFetch<Prereg>(BASE, { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: object) => apiFetch<Prereg>(`${BASE}/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  lock: (id: string) => apiFetch<Prereg>(`${BASE}/${id}/lock`, { method: "POST" }),
  linkRun: (id: string, runId: string) => apiFetch<Prereg>(`${BASE}/${id}/link-run/${runId}`, { method: "POST" }),
  verify: (id: string) =>
    apiFetch<{ valid: boolean; stored_fingerprint: string; computed_fingerprint: string; locked_at: string }>(
      `${BASE}/${id}/verify`
    ),
  abandon: (id: string, reason: string) =>
    apiFetch<Prereg>(`${BASE}/${id}/abandon`, { method: "POST", body: JSON.stringify({ reason }) }),
};

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CFG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  draft:         { label: "Draft",        icon: FileText,      color: "#6b7280", bg: "rgba(107,114,128,0.15)" },
  locked:        { label: "Locked",       icon: Lock,          color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  run_completed: { label: "Completed",    icon: CheckCircle,   color: "#10b981", bg: "rgba(16,185,129,0.15)" },
  abandoned:     { label: "Abandoned",    icon: Ban,           color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const VERDICT_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  confirmed:    { label: "CONFIRMED",    color: "#10b981", bg: "rgba(16,185,129,0.18)", icon: CheckCircle },
  refuted:      { label: "REFUTED",      color: "#ef4444", bg: "rgba(239,68,68,0.16)",  icon: XCircle },
  inconclusive: { label: "INCONCLUSIVE", color: "#f59e0b", bg: "rgba(245,158,11,0.16)", icon: HelpCircle },
};

const ALGORITHMS = [
  "VQE", "QAOA", "QFT", "Grover", "Bernstein-Vazirani",
  "Quantum Phase Estimation", "QSVM", "Variational Quantum Classifier",
  "HHL", "Random Circuit Sampling", "Other",
];

const METRICS = [
  { value: "success_probability", label: "Success Probability" },
  { value: "health_score",        label: "Health Score" },
  { value: "gate_fidelity",       label: "Gate Fidelity" },
  { value: "readout_fidelity",    label: "Readout Fidelity" },
  { value: "custom",              label: "Custom metric…" },
];

const OPERATORS = [">", "<", ">=", "<=", "==", "between"];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33`,
    }}>
      <Icon size={11} />{cfg.label}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const cfg = VERDICT_CFG[verdict] ?? VERDICT_CFG.inconclusive;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 14px", borderRadius: 999, fontSize: 13, fontWeight: 800,
      background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.color}55`,
      letterSpacing: "0.04em",
    }}>
      <Icon size={14} />{cfg.label}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>
      {children}
    </label>
  );
}

function FormInput({
  label, value, onChange, type = "text", placeholder, required, min, max, step, rows,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
  min?: number; max?: number; step?: number; rows?: number;
}) {
  const style: React.CSSProperties = {
    width: "100%", padding: "6px 10px", borderRadius: 6, fontSize: 13,
    background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)",
    color: "var(--text, #e2e8f0)", outline: "none",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <FieldLabel>{label}{required && " *"}</FieldLabel>
      {rows ? (
        <textarea
          style={{ ...style, resize: "vertical", fontFamily: "inherit", minHeight: rows * 22 }}
          value={String(value)}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={rows}
        />
      ) : (
        <input
          className="input"
          style={style}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          min={min}
          max={max}
          step={step}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hypothesis editor row
// ---------------------------------------------------------------------------

function HypothesisRow({
  hyp, index, onChange, onRemove, canRemove,
}: {
  hyp: Hypothesis & { _metric_custom?: string };
  index: number;
  onChange: (i: number, field: string, val: string | number | null) => void;
  onRemove: (i: number) => void;
  canRemove: boolean;
}) {
  const isCustom = !METRICS.slice(0, -1).some(m => m.value === hyp.metric);
  const displayMetric = isCustom ? "custom" : hyp.metric;

  const cell: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: 3,
  };
  const sel: React.CSSProperties = {
    width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 12,
    background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)",
    color: "var(--text, #e2e8f0)", cursor: "pointer",
  };
  const inp: React.CSSProperties = {
    width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 12,
    background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)",
    color: "var(--text, #e2e8f0)",
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "160px 90px 100px 90px 90px 1fr auto",
      gap: 8, alignItems: "start",
      padding: "10px 12px", borderRadius: 8,
      background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)",
      marginBottom: 6,
    }}>
      {/* Metric */}
      <div style={cell}>
        <FieldLabel>Metric</FieldLabel>
        <select style={sel} value={displayMetric}
          onChange={e => {
            const v = e.target.value;
            if (v === "custom") onChange(index, "metric", hyp._metric_custom ?? "");
            else onChange(index, "metric", v);
          }}>
          {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {isCustom && (
          <input style={{ ...inp, marginTop: 4, fontSize: 11 }} placeholder="metric name"
            value={hyp.metric}
            onChange={e => onChange(index, "metric", e.target.value)} />
        )}
      </div>

      {/* Operator */}
      <div style={cell}>
        <FieldLabel>Operator</FieldLabel>
        <select style={sel} value={hyp.operator}
          onChange={e => onChange(index, "operator", e.target.value)}>
          {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
      </div>

      {/* Expected value */}
      <div style={cell}>
        <FieldLabel>Expected</FieldLabel>
        <input style={inp} type="number" step="any"
          value={hyp.expected_value}
          onChange={e => onChange(index, "expected_value", parseFloat(e.target.value) || 0)} />
      </div>

      {/* Upper bound (only for "between") */}
      <div style={cell}>
        <FieldLabel>Upper (between)</FieldLabel>
        <input style={{ ...inp, opacity: hyp.operator === "between" ? 1 : 0.35 }}
          type="number" step="any" disabled={hyp.operator !== "between"}
          value={hyp.expected_value_upper ?? ""}
          onChange={e => onChange(index, "expected_value_upper", e.target.value ? parseFloat(e.target.value) : null)} />
      </div>

      {/* Confidence */}
      <div style={cell}>
        <FieldLabel>Confidence %</FieldLabel>
        <input style={inp} type="number" step="1" min={0} max={100}
          value={Math.round(hyp.confidence * 100)}
          onChange={e => onChange(index, "confidence", parseFloat(e.target.value) / 100 || 0)} />
      </div>

      {/* Rationale */}
      <div style={cell}>
        <FieldLabel>Rationale</FieldLabel>
        <input style={inp} placeholder="Why you expect this…"
          value={hyp.rationale}
          onChange={e => onChange(index, "rationale", e.target.value)} />
      </div>

      {/* Remove */}
      <div style={{ paddingTop: 18 }}>
        {canRemove && (
          <button type="button" onClick={() => onRemove(index)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger, #ef4444)", padding: 4 }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-step wizard
// ---------------------------------------------------------------------------

const BLANK_HYP = (): Hypothesis => ({
  metric: "success_probability",
  operator: ">",
  expected_value: 0.5,
  expected_value_upper: null,
  confidence: 0.95,
  rationale: "",
});

interface WizardState {
  title: string;
  description: string;
  researcher_name: string;
  institution: string;
  circuit_description: string;
  backend: string;
  n_qubits: string;
  n_shots: string;
  algorithm: string;
  hypotheses: Hypothesis[];
  alpha: string;
  minimum_effect_size: string;
  planned_run_date: string;
}

const BLANK_WIZARD = (): WizardState => ({
  title: "", description: "", researcher_name: "", institution: "",
  circuit_description: "", backend: "", n_qubits: "2", n_shots: "1024",
  algorithm: "VQE",
  hypotheses: [BLANK_HYP()],
  alpha: "0.05", minimum_effect_size: "", planned_run_date: "",
});

function CreateWizard({
  onSave, onLock, onCancel, initial,
}: {
  onSave: (data: WizardState) => Promise<void>;
  onLock: (data: WizardState) => Promise<void>;
  onCancel: () => void;
  initial?: Partial<WizardState>;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardState>({ ...BLANK_WIZARD(), ...initial });
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lockConfirm, setLockConfirm] = useState(false);

  const set = (field: keyof WizardState) => (val: string) =>
    setData(d => ({ ...d, [field]: val }));

  function updateHyp(i: number, field: string, val: string | number | null) {
    setData(d => ({
      ...d,
      hypotheses: d.hypotheses.map((h, idx) => idx === i ? { ...h, [field]: val } : h),
    }));
  }

  function addHyp() {
    if (data.hypotheses.length >= 5) return;
    setData(d => ({ ...d, hypotheses: [...d.hypotheses, BLANK_HYP()] }));
  }

  function removeHyp(i: number) {
    setData(d => ({ ...d, hypotheses: d.hypotheses.filter((_, idx) => idx !== i) }));
  }

  const STEPS = ["Basics", "Experiment Plan", "Hypotheses", "Statistics", "Review & Lock"];

  async function handleSave() {
    setSaving(true); setErr(null);
    try { await onSave(data); } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function handleLock() {
    setLocking(true); setErr(null);
    try { await onLock(data); } catch (e) { setErr(e instanceof Error ? e.message : "Lock failed"); }
    finally { setLocking(false); setLockConfirm(false); }
  }

  const panelStyle: React.CSSProperties = {
    background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)",
    borderRadius: 10, padding: "18px 20px",
  };

  return (
    <div style={panelStyle}>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line, #2a3348)" }}>
        {STEPS.map((s, i) => (
          <button key={s} type="button"
            onClick={() => setStep(i)}
            style={{
              flex: 1, padding: "8px 4px", fontSize: 11, fontWeight: 600, border: "none",
              cursor: "pointer", transition: "background 0.15s",
              background: i === step ? "var(--strong, #3b82f6)" : "var(--panel-2, #1e2535)",
              color: i === step ? "#fff" : "var(--muted, #64748b)",
              borderRight: i < STEPS.length - 1 ? "1px solid var(--line, #2a3348)" : "none",
            }}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {err && (
        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#ef4444", marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Step 0: Basics */}
      {step === 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          <FormInput label="Title" value={data.title} onChange={set("title")} required placeholder="e.g. VQE Hydrogen Molecule Ground State" />
          <FormInput label="Description" value={data.description} onChange={set("description")} rows={3} placeholder="What is the scientific question you're investigating?" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormInput label="Researcher name" value={data.researcher_name} onChange={set("researcher_name")} required placeholder="Dr. Jane Smith" />
            <FormInput label="Institution (optional)" value={data.institution} onChange={set("institution")} placeholder="MIT Quantum Lab" />
          </div>
        </div>
      )}

      {/* Step 1: Experiment Plan */}
      {step === 1 && (
        <div style={{ display: "grid", gap: 12 }}>
          <FormInput label="Circuit description" value={data.circuit_description} onChange={set("circuit_description")} rows={3} placeholder="Describe the circuit you plan to run in plain language…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormInput label="Backend" value={data.backend} onChange={set("backend")} required placeholder="ibm_brisbane" />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <FieldLabel>Algorithm *</FieldLabel>
              <select
                value={data.algorithm}
                onChange={e => set("algorithm")(e.target.value)}
                style={{
                  padding: "7px 10px", borderRadius: 6, fontSize: 13,
                  background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)",
                  color: "var(--text, #e2e8f0)", cursor: "pointer",
                }}>
                {ALGORITHMS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormInput label="Number of qubits" value={data.n_qubits} onChange={set("n_qubits")} type="number" min={1} max={10000} required />
            <FormInput label="Number of shots" value={data.n_shots} onChange={set("n_shots")} type="number" min={1} max={10000000} required />
          </div>
        </div>
      )}

      {/* Step 2: Hypotheses */}
      {step === 2 && (
        <div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
            Define up to 5 hypotheses. Each declares what you expect to observe and why.
          </div>
          {data.hypotheses.map((h, i) => (
            <HypothesisRow key={i} hyp={h} index={i} onChange={updateHyp} onRemove={removeHyp} canRemove={data.hypotheses.length > 1} />
          ))}
          {data.hypotheses.length < 5 && (
            <button type="button" onClick={addHyp}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: "none", border: "1px dashed var(--line, #2a3348)",
                color: "var(--muted, #64748b)", cursor: "pointer", marginTop: 4,
              }}>
              <Plus size={13} /> Add another hypothesis
            </button>
          )}
        </div>
      )}

      {/* Step 3: Statistics */}
      {step === 3 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text)" }}>Statistical parameters</strong> — Alpha (α) is the significance threshold.
            A value of 0.05 means you accept a 5% chance of a false positive.
            Minimum effect size is the smallest practically meaningful change.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <FormInput label="Alpha (α) — significance level" value={data.alpha} onChange={set("alpha")} type="number" step={0.01} min={0} max={1} placeholder="0.05" />
            <FormInput label="Minimum effect size (optional)" value={data.minimum_effect_size} onChange={set("minimum_effect_size")} type="number" step={0.01} min={0} placeholder="e.g. 0.1" />
            <FormInput label="Planned run date (optional)" value={data.planned_run_date} onChange={set("planned_run_date")} type="date" />
          </div>
        </div>
      )}

      {/* Step 4: Review & Lock */}
      {step === 4 && (
        <div>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            <ReviewSection title="Basics">
              <KV label="Title" value={data.title || "—"} />
              <KV label="Researcher" value={data.researcher_name || "—"} />
              <KV label="Institution" value={data.institution || "—"} />
            </ReviewSection>
            <ReviewSection title="Experiment Plan">
              <KV label="Backend" value={data.backend || "—"} />
              <KV label="Algorithm" value={data.algorithm} />
              <KV label="Qubits" value={data.n_qubits} />
              <KV label="Shots" value={Number(data.n_shots).toLocaleString()} />
            </ReviewSection>
            <ReviewSection title="Hypotheses">
              {data.hypotheses.map((h, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--line, #2a3348)" }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>H{i + 1}: </span>
                  <code style={{ fontSize: 12 }}>{h.metric} {h.operator} {h.expected_value}{h.operator === "between" ? ` ↔ ${h.expected_value_upper}` : ""}</code>
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>(conf. {Math.round(h.confidence * 100)}%)</span>
                  {h.rationale && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{h.rationale}</div>}
                </div>
              ))}
            </ReviewSection>
            <ReviewSection title="Statistics">
              <KV label="Alpha" value={data.alpha} />
              <KV label="Min effect size" value={data.minimum_effect_size || "—"} />
              <KV label="Planned date" value={data.planned_run_date || "—"} />
            </ReviewSection>
          </div>

          {lockConfirm ? (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>
                Are you sure? This action is IRREVERSIBLE.
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
                Locking creates a SHA-256 fingerprint of your hypothesis. Once locked, the record
                cannot be edited and any future changes would be detectable via the verify endpoint.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => void handleLock()} disabled={locking}
                  style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer" }}>
                  {locking ? "Locking…" : "Yes, lock permanently"}
                </button>
                <button type="button" onClick={() => setLockConfirm(false)}
                  style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, background: "var(--panel-2, #1e2535)", color: "var(--text)", border: "1px solid var(--line, #2a3348)", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        {step > 0 && (
          <button type="button" onClick={() => setStep(s => s - 1)}
            style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)", color: "var(--text)", cursor: "pointer" }}>
            ← Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button type="button" onClick={() => setStep(s => s + 1)}
            style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, background: "var(--strong, #3b82f6)", color: "#fff", border: "none", cursor: "pointer" }}>
            Next →
          </button>
        )}
        {step === STEPS.length - 1 && (
          <>
            <button type="button" onClick={() => void handleSave()} disabled={saving}
              style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)", color: "var(--text)", cursor: "pointer" }}>
              {saving ? "Saving…" : "Save Draft"}
            </button>
            {!lockConfirm && (
              <button type="button" onClick={() => setLockConfirm(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>
                <Lock size={13} /> Lock Pre-registration (irreversible)
              </button>
            )}
          </>
        )}
        <button type="button" onClick={onCancel}
          style={{ padding: "7px 16px", borderRadius: 6, fontSize: 13, background: "none", border: "1px solid var(--line, #2a3348)", color: "var(--muted)", cursor: "pointer", marginLeft: "auto" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--panel-2, #1e2535)", borderRadius: 8, border: "1px solid var(--line, #2a3348)", padding: "10px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 12, marginBottom: 3 }}>
      <span style={{ color: "var(--muted)", minWidth: 120 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  prereg, onRefresh,
}: {
  prereg: Prereg;
  onRefresh: (updated: Prereg) => void;
}) {
  const [linkRunId, setLinkRunId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; stored_fingerprint: string; computed_fingerprint: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [abandonReason, setAbandonReason] = useState("");
  const [abandoning, setAbandoning] = useState(false);
  const [showAbandon, setShowAbandon] = useState(false);
  const [abandonErr, setAbandonErr] = useState<string | null>(null);

  async function handleLinkRun() {
    if (!linkRunId.trim()) return;
    setLinking(true); setLinkErr(null);
    try {
      const updated = await api.linkRun(prereg.prereg_id, linkRunId.trim());
      onRefresh(updated);
      setLinkRunId("");
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : "Link failed");
    } finally { setLinking(false); }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const r = await api.verify(prereg.prereg_id);
      setVerifyResult(r);
    } catch { setVerifyResult(null); }
    finally { setVerifying(false); }
  }

  async function handleAbandon() {
    if (!abandonReason.trim()) return;
    setAbandoning(true); setAbandonErr(null);
    try {
      const updated = await api.abandon(prereg.prereg_id, abandonReason.trim());
      onRefresh(updated);
      setShowAbandon(false);
    } catch (e) {
      setAbandonErr(e instanceof Error ? e.message : "Abandon failed");
    } finally { setAbandoning(false); }
  }

  const sectionHead = (title: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, marginTop: 16 }}>
      {title}
    </div>
  );

  const cellStyle: React.CSSProperties = {
    padding: "8px 10px", borderBottom: "1px solid var(--line, #2a3348)", fontSize: 12,
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>{prereg.title}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={prereg.status} />
            {prereg.verdict && <VerdictBadge verdict={prereg.verdict} />}
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{ background: "var(--panel-2, #1e2535)", borderRadius: 8, border: "1px solid var(--line, #2a3348)", padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <KV label="Researcher" value={prereg.researcher_name} />
          {prereg.institution && <KV label="Institution" value={prereg.institution} />}
          <KV label="Backend" value={prereg.backend} />
          <KV label="Algorithm" value={prereg.algorithm} />
          <KV label="Qubits" value={prereg.n_qubits} />
          <KV label="Shots" value={prereg.n_shots.toLocaleString()} />
          <KV label="Alpha (α)" value={prereg.alpha} />
          {prereg.planned_run_date && <KV label="Planned date" value={prereg.planned_run_date} />}
        </div>
        {prereg.description && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            {prereg.description}
          </div>
        )}
      </div>

      {/* Circuit description */}
      {prereg.circuit_description && (
        <>
          {sectionHead("Circuit Description")}
          <div style={{ background: "var(--panel-2, #1e2535)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.6, border: "1px solid var(--line, #2a3348)", marginBottom: 12 }}>
            {prereg.circuit_description}
          </div>
        </>
      )}

      {/* Hypotheses table */}
      {sectionHead("Hypotheses")}
      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--line, #2a3348)", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--panel-2, #1e2535)" }}>
              {["#", "Metric", "Expected", "Confidence", "Rationale",
                ...(prereg.status === "run_completed" ? ["Actual", "Result"] : [])
              ].map(h => (
                <th key={h} style={{ ...cellStyle, fontWeight: 700, color: "var(--muted)", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prereg.hypotheses.map((h, i) => {
              const hr = prereg.outcome?.hypothesis_results?.[i];
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--line, #2a3348)" }}>
                  <td style={cellStyle}>{i + 1}</td>
                  <td style={{ ...cellStyle, fontFamily: "monospace" }}>{h.metric}</td>
                  <td style={{ ...cellStyle, fontFamily: "monospace" }}>
                    {h.operator} {h.expected_value}
                    {h.operator === "between" && h.expected_value_upper != null && ` ↔ ${h.expected_value_upper}`}
                  </td>
                  <td style={cellStyle}>{Math.round(h.confidence * 100)}%</td>
                  <td style={{ ...cellStyle, color: "var(--muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{h.rationale || "—"}</td>
                  {prereg.status === "run_completed" && (
                    <>
                      <td style={{ ...cellStyle, fontFamily: "monospace" }}>
                        {hr?.actual_value != null ? hr.actual_value.toFixed(4) : "—"}
                      </td>
                      <td style={cellStyle}>
                        {hr ? (
                          <span style={{
                            padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                            background: hr.result === "confirmed" ? "rgba(16,185,129,0.18)" : hr.result === "refuted" ? "rgba(239,68,68,0.16)" : "rgba(245,158,11,0.16)",
                            color: hr.result === "confirmed" ? "#10b981" : hr.result === "refuted" ? "#ef4444" : "#f59e0b",
                          }}>
                            {hr.result.toUpperCase()}
                          </span>
                        ) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Fingerprint section */}
      {prereg.fingerprint && (
        <>
          {sectionHead("Integrity")}
          <div style={{ background: "var(--panel-2, #1e2535)", borderRadius: 8, border: "1px solid var(--line, #2a3348)", padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>SHA-256 Fingerprint</div>
            <code style={{ fontSize: 10, wordBreak: "break-all", color: "#94a3b8", lineHeight: 1.7 }}>
              {prereg.fingerprint}
            </code>
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void handleVerify()} disabled={verifying}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "none", border: "1px solid var(--line, #2a3348)", color: "var(--muted)", cursor: "pointer" }}>
                <ShieldCheck size={12} />{verifying ? "Verifying…" : "Verify integrity"}
              </button>
            </div>
            {verifyResult && (
              <div style={{
                marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: 12,
                background: verifyResult.valid ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                color: verifyResult.valid ? "#10b981" : "#ef4444",
                border: `1px solid ${verifyResult.valid ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>
                {verifyResult.valid
                  ? "Fingerprint verified — record has not been tampered with."
                  : "FINGERPRINT MISMATCH — record may have been tampered with!"}
              </div>
            )}
          </div>
        </>
      )}

      {/* Timeline */}
      {sectionHead("Timeline")}
      <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
        {[
          { label: "Created", date: prereg.created_at, done: true },
          { label: "Locked", date: prereg.locked_at, done: !!prereg.locked_at },
          { label: "Run date", date: prereg.planned_run_date, done: !!prereg.run_id },
          { label: "Analysed", date: prereg.outcome?.analyzed_at, done: !!prereg.outcome?.analyzed_at },
        ].map((t, i) => (
          <div key={t.label} style={{ flex: 1, textAlign: "center", position: "relative" }}>
            {i > 0 && (
              <div style={{
                position: "absolute", left: 0, top: 14, width: "50%", height: 2,
                background: t.done ? "#3b82f6" : "var(--line, #2a3348)",
              }} />
            )}
            {i < 3 && (
              <div style={{
                position: "absolute", right: 0, top: 14, width: "50%", height: 2,
                background: t.done ? "#3b82f6" : "var(--line, #2a3348)",
              }} />
            )}
            <div style={{
              width: 28, height: 28, borderRadius: "50%", margin: "0 auto 6px",
              background: t.done ? "#3b82f6" : "var(--panel-2, #1e2535)",
              border: `2px solid ${t.done ? "#3b82f6" : "var(--line, #2a3348)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", zIndex: 1,
            }}>
              {t.done && <CheckCircle size={14} color="#fff" />}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: t.done ? "var(--text)" : "var(--muted)" }}>{t.label}</div>
            {t.date && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>{new Date(t.date).toLocaleDateString()}</div>}
          </div>
        ))}
      </div>

      {/* Abandoned reason */}
      {prereg.status === "abandoned" && prereg.outcome?.abandon_reason && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#ef4444" }}>
          <strong>Abandoned:</strong> {prereg.outcome.abandon_reason}
        </div>
      )}

      {/* Action panel */}
      {prereg.status === "locked" && (
        <div style={{ background: "var(--panel-2, #1e2535)", borderRadius: 8, border: "1px solid var(--line, #2a3348)", padding: "12px 14px" }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Link a Run</div>
          {linkErr && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 6 }}>{linkErr}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{
                flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)", color: "var(--text)",
              }}
              placeholder="Enter run ID…"
              value={linkRunId}
              onChange={e => setLinkRunId(e.target.value)}
            />
            <button type="button" onClick={() => void handleLinkRun()} disabled={linking || !linkRunId.trim()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>
              <Link2 size={12} />{linking ? "Linking…" : "Link Run"}
            </button>
          </div>
        </div>
      )}

      {/* Abandon */}
      {(prereg.status === "draft" || prereg.status === "locked") && (
        <div style={{ marginTop: 12 }}>
          {showAbandon ? (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", marginBottom: 6 }}>Abandon this pre-registration</div>
              {abandonErr && <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 6 }}>{abandonErr}</div>}
              <textarea
                style={{ width: "100%", padding: "6px 10px", borderRadius: 6, fontSize: 12, background: "var(--panel, #151c2c)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--text)", fontFamily: "inherit", resize: "vertical" }}
                rows={2} placeholder="Reason for abandoning…"
                value={abandonReason}
                onChange={e => setAbandonReason(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => void handleAbandon()} disabled={abandoning || !abandonReason.trim()}
                  style={{ padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#ef4444", color: "#fff", border: "none", cursor: "pointer" }}>
                  {abandoning ? "Abandoning…" : "Confirm Abandon"}
                </button>
                <button type="button" onClick={() => setShowAbandon(false)}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12, background: "none", border: "1px solid var(--line, #2a3348)", color: "var(--muted)", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowAbandon(true)}
              style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, background: "none", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", cursor: "pointer" }}>
              Abandon
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------

function PreregListItem({
  prereg, selected, onSelect,
}: {
  prereg: Prereg; selected: boolean; onSelect: () => void;
}) {
  const cfg = STATUS_CFG[prereg.status] ?? STATUS_CFG.draft;
  const Icon = cfg.icon;
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 12px", borderRadius: 8, cursor: "pointer",
        background: selected ? "rgba(59,130,246,0.12)" : "transparent",
        border: `1px solid ${selected ? "#3b82f688" : "transparent"}`,
        transition: "background 0.12s",
        display: "flex", alignItems: "flex-start", gap: 8,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ marginTop: 2, color: cfg.color, flexShrink: 0 }}><Icon size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {prereg.title || "Untitled"}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {prereg.researcher_name} · {new Date(prereg.created_at).toLocaleDateString()}
        </div>
        {prereg.verdict && (
          <span style={{
            display: "inline-block", marginTop: 3,
            padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700,
            background: VERDICT_CFG[prereg.verdict]?.bg,
            color: VERDICT_CFG[prereg.verdict]?.color,
          }}>
            {prereg.verdict.toUpperCase()}
          </span>
        )}
      </div>
      <ChevronRight size={13} style={{ color: "var(--muted)", flexShrink: 0, marginTop: 4 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PreregisterPage() {
  const [list, setList] = useState<Prereg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Prereg | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await api.list(statusFilter ? { status: statusFilter } : undefined);
      setList(items);
      // Refresh selected if it's in the new list
      if (selected) {
        const refreshed = items.find(p => p.prereg_id === selected.prereg_id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, [statusFilter, selected]);

  useEffect(() => { void load(); }, [statusFilter]);

  // Group by status for the list panel
  const grouped: Record<string, Prereg[]> = {};
  list.forEach(p => { (grouped[p.status] ??= []).push(p); });
  const ORDER = ["draft", "locked", "run_completed", "abandoned"];

  async function handleSaveDraft(data: WizardState) {
    const body = {
      title: data.title, description: data.description,
      researcher_name: data.researcher_name, institution: data.institution || undefined,
      circuit_description: data.circuit_description, backend: data.backend,
      n_qubits: parseInt(data.n_qubits) || 2, n_shots: parseInt(data.n_shots) || 1024,
      algorithm: data.algorithm, hypotheses: data.hypotheses,
      alpha: parseFloat(data.alpha) || 0.05,
      minimum_effect_size: data.minimum_effect_size ? parseFloat(data.minimum_effect_size) : undefined,
      planned_run_date: data.planned_run_date || undefined,
    };

    let updated: Prereg;
    if (editDraftId) {
      updated = await api.update(editDraftId, body);
    } else {
      updated = await api.create(body);
    }
    setShowCreate(false);
    setEditDraftId(null);
    await load();
    setSelected(updated);
  }

  async function handleLockDraft(data: WizardState) {
    // Save first, then lock
    const body = {
      title: data.title, description: data.description,
      researcher_name: data.researcher_name, institution: data.institution || undefined,
      circuit_description: data.circuit_description, backend: data.backend,
      n_qubits: parseInt(data.n_qubits) || 2, n_shots: parseInt(data.n_shots) || 1024,
      algorithm: data.algorithm, hypotheses: data.hypotheses,
      alpha: parseFloat(data.alpha) || 0.05,
      minimum_effect_size: data.minimum_effect_size ? parseFloat(data.minimum_effect_size) : undefined,
      planned_run_date: data.planned_run_date || undefined,
    };

    let draft: Prereg;
    if (editDraftId) {
      draft = await api.update(editDraftId, body);
    } else {
      draft = await api.create(body);
    }

    const locked = await api.lock(draft.prereg_id);
    setShowCreate(false);
    setEditDraftId(null);
    await load();
    setSelected(locked);
  }

  const sidebarStyle: React.CSSProperties = {
    width: 280, flexShrink: 0, display: "flex", flexDirection: "column",
    background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)",
    borderRadius: 10, overflow: "hidden",
  };

  const centerStyle: React.CSSProperties = {
    flex: 1, background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)",
    borderRadius: 10, padding: "18px 20px", overflow: "auto",
  };

  return (
    <main className="page" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <ClipboardList size={20} style={{ color: "#3b82f6" }} />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, flex: 1 }}>Pre-registration</h2>
        <button type="button" onClick={() => void load()} title="Refresh"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
          <RefreshCw size={14} />
        </button>
        <button type="button" onClick={() => { setShowCreate(true); setEditDraftId(null); setSelected(null); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}>
          <Plus size={14} /> New Pre-registration
        </button>
      </div>

      {/* Philosophy card */}
      <div style={{ margin: "0 20px 14px", padding: "10px 14px", borderRadius: 8, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
        <AlertTriangle size={12} style={{ color: "#3b82f6", marginRight: 5, verticalAlign: "middle" }} />
        <strong style={{ color: "var(--text)" }}>Pre-registration</strong> creates a tamper-evident record of your hypothesis before data collection.
        It prevents <strong style={{ color: "var(--text)" }}>HARKing</strong> (Hypothesizing After Results are Known) —
        a major reproducibility crisis issue in quantum research.
      </div>

      {error && (
        <div style={{ margin: "0 20px 12px", padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 13, color: "#ef4444" }}>
          {error}
          <button type="button" onClick={() => setError(null)} style={{ marginLeft: 10, background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 12, textDecoration: "underline" }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Create / Edit wizard */}
      {showCreate && (
        <div style={{ margin: "0 20px 16px" }}>
          <CreateWizard
            onSave={(data) => handleSaveDraft(data)}
            onLock={(data) => handleLockDraft(data)}
            onCancel={() => { setShowCreate(false); setEditDraftId(null); }}
            initial={editDraftId && selected?.prereg_id === editDraftId ? {
              title: selected.title,
              description: selected.description,
              researcher_name: selected.researcher_name,
              institution: selected.institution ?? "",
              circuit_description: selected.circuit_description,
              backend: selected.backend,
              n_qubits: String(selected.n_qubits),
              n_shots: String(selected.n_shots),
              algorithm: selected.algorithm,
              hypotheses: selected.hypotheses,
              alpha: String(selected.alpha),
              minimum_effect_size: selected.minimum_effect_size != null ? String(selected.minimum_effect_size) : "",
              planned_run_date: selected.planned_run_date ?? "",
            } : undefined}
          />
        </div>
      )}

      {/* 3-column layout */}
      <div style={{ display: "flex", gap: 12, padding: "0 20px 20px", minHeight: 500 }}>
        {/* Left — list */}
        <div style={sidebarStyle}>
          {/* Filter tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--line, #2a3348)", padding: "8px 8px 0", gap: 2, flexWrap: "wrap" }}>
            {["", "draft", "locked", "run_completed", "abandoned"].map(s => (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                style={{
                  padding: "4px 10px", borderRadius: "6px 6px 0 0", fontSize: 11, fontWeight: 600,
                  border: "none", cursor: "pointer", marginBottom: -1,
                  background: statusFilter === s ? "var(--panel, #151c2c)" : "transparent",
                  borderBottom: statusFilter === s ? "2px solid #3b82f6" : "2px solid transparent",
                  color: statusFilter === s ? "#3b82f6" : "var(--muted, #64748b)",
                }}>
                {s === "" ? "All" : STATUS_CFG[s]?.label ?? s}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "8px 6px" }}>
            {loading ? (
              <div style={{ padding: "20px 12px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Loading…</div>
            ) : list.length === 0 ? (
              <div style={{ padding: "20px 12px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                No pre-registrations yet.
              </div>
            ) : (
              <>
                {ORDER.map(status => {
                  const items = grouped[status];
                  if (!items?.length) return null;
                  return (
                    <div key={status}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 6px 4px" }}>
                        {STATUS_CFG[status]?.label ?? status} ({items.length})
                      </div>
                      {items.map(p => (
                        <PreregListItem
                          key={p.prereg_id}
                          prereg={p}
                          selected={selected?.prereg_id === p.prereg_id}
                          onSelect={() => { setSelected(p); setShowCreate(false); }}
                        />
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Center — detail */}
        <div style={centerStyle}>
          {selected ? (
            <DetailPanel
              prereg={selected}
              onRefresh={updated => {
                setSelected(updated);
                setList(prev => prev.map(p => p.prereg_id === updated.prereg_id ? updated : p));
              }}
            />
          ) : showCreate ? null : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)", gap: 10 }}>
              <ClipboardList size={40} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 14 }}>Select a pre-registration or create a new one</div>
            </div>
          )}
        </div>

        {/* Right — quick stats panel */}
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Stats */}
          <div style={{ background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Overview</div>
            <div style={{ display: "grid", gap: 10 }}>
              {ORDER.map(s => {
                const count = grouped[s]?.length ?? 0;
                const cfg = STATUS_CFG[s];
                const Icon = cfg.icon;
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: cfg.color }}><Icon size={13} /></span>
                    <span style={{ fontSize: 12, flex: 1, color: "var(--muted)" }}>{cfg.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: count > 0 ? "var(--text)" : "var(--muted)" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verdicts panel */}
          {list.some(p => p.verdict) && (
            <div style={{ background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Verdicts</div>
              {(["confirmed", "refuted", "inconclusive"] as const).map(v => {
                const count = list.filter(p => p.verdict === v).length;
                const cfg = VERDICT_CFG[v];
                const Icon = cfg.icon;
                return (
                  <div key={v} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ color: cfg.color }}><Icon size={13} /></span>
                    <span style={{ fontSize: 12, flex: 1, color: "var(--muted)", textTransform: "capitalize" }}>{v}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: count > 0 ? cfg.color : "var(--muted)" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected prereg quick actions */}
          {selected && (
            <div style={{ background: "var(--panel, #151c2c)", border: "1px solid var(--line, #2a3348)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Selected</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selected.title}
              </div>
              <StatusBadge status={selected.status} />
              {selected.run_id && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                  Run: <code style={{ fontSize: 10 }}>{selected.run_id}</code>
                </div>
              )}
              {selected.status === "draft" && (
                <button type="button" onClick={() => { setShowCreate(true); setEditDraftId(selected.prereg_id); }}
                  style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 10, padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "var(--panel-2, #1e2535)", border: "1px solid var(--line, #2a3348)", color: "var(--text)", cursor: "pointer" }}>
                  <FileText size={11} /> Edit Draft
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
