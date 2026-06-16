"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  registerAnalysis,
  listAnalysisRegistrations,
  revealAnalysis,
  AnalysisRegistration,
  RevealResult,
} from "@/lib/api";

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div style={{
      padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5",
      borderRadius: 8, fontSize: 13, color: "#b91c1c", marginBottom: 12, display: "flex", justifyContent: "space-between",
    }}>
      <span>{msg}</span>
      <button onClick={onDismiss} type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>×</button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    registered: { bg: "#dbeafe", color: "#1d4ed8" },
    revealed: { bg: "#dcfce7", color: "#15803d" },
    cancelled: { bg: "#f3f4f6", color: "#6b7280" },
  };
  const s = styles[status] ?? styles.cancelled;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11,
      fontWeight: 700, background: s.bg, color: s.color,
    }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function RevealForm({ regId, onRevealed }: { regId: string; onRevealed: (r: RevealResult) => void }) {
  const [effectSize, setEffectSize] = useState("");
  const [pValue, setPValue] = useState("");
  const [ci, setCi] = useState("");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parts = ci.split(",").map(v => parseFloat(v.trim()));
    if (parts.length !== 2 || parts.some(isNaN)) {
      setError("Confidence interval must be two numbers separated by a comma.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await revealAnalysis(regId, {
        effect_size: parseFloat(effectSize),
        p_value: parseFloat(pValue),
        confidence_interval: parts,
        result_summary: summary.trim(),
      });
      onRevealed(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <FormField label="Effect Size">
          <input className="input" type="number" step="any" value={effectSize}
            onChange={e => setEffectSize(e.target.value)} required placeholder="e.g. 0.42" style={{ height: 32 }} />
        </FormField>
        <FormField label="P-value">
          <input className="input" type="number" step="any" min={0} max={1} value={pValue}
            onChange={e => setPValue(e.target.value)} required placeholder="e.g. 0.032" style={{ height: 32 }} />
        </FormField>
        <FormField label="Confidence Interval (lower, upper)">
          <input className="input" value={ci} onChange={e => setCi(e.target.value)}
            required placeholder="0.12, 0.71" style={{ height: 32 }} />
        </FormField>
      </div>
      <FormField label="Result Summary">
        <textarea className="input" value={summary} onChange={e => setSummary(e.target.value)}
          rows={2} required style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
          placeholder="Describe the outcome of the analysis…" />
      </FormField>
      <button className="button" type="submit" disabled={loading} style={{ height: 32, marginTop: 10, fontSize: 12 }}>
        {loading ? "Revealing…" : "Reveal Results"}
      </button>
    </form>
  );
}

function RegistrationCard({
  reg,
  onUpdated,
}: {
  reg: AnalysisRegistration;
  onUpdated: (updated: AnalysisRegistration) => void;
}) {
  const [showReveal, setShowReveal] = useState(false);
  const [revealResult, setRevealResult] = useState<RevealResult | null>(null);

  function handleRevealed(r: RevealResult) {
    setRevealResult(r);
    setShowReveal(false);
    onUpdated({
      ...reg,
      status: "revealed",
      confirmed_hypothesis: r.confirmed_hypothesis,
      results_summary: r.result_summary,
    });
  }

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10,
      padding: 16, display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{reg.title}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Registered {new Date(reg.registered_at).toLocaleString()}
          </div>
        </div>
        <StatusBadge status={reg.status} />
      </div>

      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
        {reg.hypothesis.length > 180 ? reg.hypothesis.slice(0, 180) + "…" : reg.hypothesis}
      </p>

      {reg.blinded_data_hash && (
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--muted)", wordBreak: "break-all" }}>
          SHA: {reg.blinded_data_hash}
        </div>
      )}

      {/* Reveal badge after reveal */}
      {(reg.status === "revealed" || revealResult) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{
            padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700,
            background: reg.confirmed_hypothesis ? "#dcfce7" : "#fee2e2",
            color: reg.confirmed_hypothesis ? "#15803d" : "#b91c1c",
          }}>
            {reg.confirmed_hypothesis ? "✓ Confirmed" : "✗ Rejected"}
          </span>
          {revealResult && (
            <>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>ES: {revealResult.effect_size}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>p = {revealResult.p_value}</span>
            </>
          )}
        </div>
      )}

      {reg.status === "registered" && !showReveal && (
        <button
          className="button secondary"
          type="button"
          onClick={() => setShowReveal(true)}
          style={{ height: 30, fontSize: 12, alignSelf: "flex-start" }}
        >
          Reveal Results
        </button>
      )}

      {showReveal && (
        <RevealForm regId={reg.reg_id} onRevealed={handleRevealed} />
      )}
    </div>
  );
}

export default function BlindAnalysisPage() {
  // Registration form
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [methods, setMethods] = useState("");
  const [primaryOutcome, setPrimaryOutcome] = useState("");
  const [secondaryOutcomes, setSecondaryOutcomes] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [newReg, setNewReg] = useState<AnalysisRegistration | null>(null);

  // Registrations list
  const [registrations, setRegistrations] = useState<AnalysisRegistration[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const loadRegistrations = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const data = await listAnalysisRegistrations();
      setRegistrations(data);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load registrations");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { void loadRegistrations(); }, [loadRegistrations]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !hypothesis.trim()) return;
    setRegistering(true);
    setRegisterError(null);
    setNewReg(null);
    try {
      const outcomes = secondaryOutcomes.split(",").map(s => s.trim()).filter(Boolean);
      const reg = await registerAnalysis({
        title: title.trim(),
        hypothesis: hypothesis.trim(),
        methods: methods.trim(),
        primary_outcome: primaryOutcome.trim(),
        secondary_outcomes: outcomes,
      });
      setNewReg(reg);
      setTitle(""); setHypothesis(""); setMethods(""); setPrimaryOutcome(""); setSecondaryOutcomes("");
      setRegistrations(prev => [reg, ...prev]);
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  function handleUpdated(updated: AnalysisRegistration) {
    setRegistrations(prev => prev.map(r => r.reg_id === updated.reg_id ? updated : r));
  }

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Blind Analysis Mode</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
            Pre-register hypotheses before data collection for reproducible, bias-free quantum experiments
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT: Registration form */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Pre-Register Analysis</div>

          {registerError && <ErrorBanner msg={registerError} onDismiss={() => setRegisterError(null)} />}

          {newReg && (
            <div style={{
              padding: "12px 14px", background: "#dcfce7", border: "1px solid #86efac",
              borderRadius: 8, fontSize: 13, color: "#15803d", marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Registration successful</div>
              <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                ID: {newReg.reg_id}
              </div>
              {newReg.blinded_data_hash && (
                <div style={{ fontFamily: "monospace", fontSize: 11, marginTop: 4, wordBreak: "break-all", color: "#166534" }}>
                  SHA: {newReg.blinded_data_hash}
                </div>
              )}
              <button onClick={() => setNewReg(null)} type="button"
                style={{ marginTop: 8, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#15803d", textDecoration: "underline" }}>
                Dismiss
              </button>
            </div>
          )}

          <form onSubmit={(e) => void handleRegister(e)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <FormField label="Title *">
              <input className="input" value={title} onChange={e => setTitle(e.target.value)}
                required placeholder="e.g. VQE convergence on ibm_brisbane" style={{ height: 34 }} />
            </FormField>
            <FormField label="Hypothesis *">
              <textarea className="input" value={hypothesis} onChange={e => setHypothesis(e.target.value)}
                required rows={3} placeholder="State the falsifiable hypothesis to be tested…"
                style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
            </FormField>
            <FormField label="Methods">
              <textarea className="input" value={methods} onChange={e => setMethods(e.target.value)}
                rows={2} placeholder="Describe the experimental protocol and analysis approach…"
                style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
            </FormField>
            <FormField label="Primary Outcome">
              <input className="input" value={primaryOutcome} onChange={e => setPrimaryOutcome(e.target.value)}
                placeholder="e.g. ground state energy error" style={{ height: 34 }} />
            </FormField>
            <FormField label="Secondary Outcomes (comma-separated)">
              <input className="input" value={secondaryOutcomes} onChange={e => setSecondaryOutcomes(e.target.value)}
                placeholder="circuit depth, fidelity, wall time" style={{ height: 34 }} />
            </FormField>
            <button className="button" type="submit" disabled={registering} style={{ height: 36 }}>
              {registering ? "Registering…" : "Pre-Register"}
            </button>
          </form>
        </div>

        {/* RIGHT: Registrations list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Registered Analyses ({registrations.length})
          </div>

          {listError && <ErrorBanner msg={listError} onDismiss={() => setListError(null)} />}

          {loadingList ? (
            <div className="empty">Loading registrations…</div>
          ) : registrations.length === 0 ? (
            <div className="empty">No analyses registered yet. Pre-register one to get started.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {registrations.map(reg => (
                <RegistrationCard key={reg.reg_id} reg={reg} onUpdated={handleUpdated} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
