"use client";

import { useState } from "react";
import { Zap, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { zxSimplify, ZXSimplifyResult } from "../../../../lib/api";

export default function ZXSimplifyPanel({ runId, hasQasm }: { runId: string; hasQasm: boolean }) {
  const [result, setResult] = useState<ZXSimplifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQasm, setShowQasm] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!hasQasm) return null;

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await zxSimplify(runId);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simplification failed");
    } finally {
      setLoading(false);
    }
  }

  function copyQasm() {
    if (!result?.simplified_qasm) return;
    void navigator.clipboard.writeText(result.simplified_qasm);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const methodLabel = result?.method === "pyzx_full_reduce" ? "PyZX full_reduce" : "Qiskit opt-3";
  const improved = result && (result.t_count_reduction ?? 0) > 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} aria-hidden="true" />
          ZX-Calculus Simplification
        </h2>
        {!result && (
          <button
            className="button secondary"
            style={{ marginLeft: "auto", height: 30, fontSize: 12, padding: "0 12px" }}
            onClick={() => void run()}
            disabled={loading}
            type="button"
          >
            {loading ? "Simplifying…" : "Simplify Circuit"}
          </button>
        )}
        {result && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            via {methodLabel}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: "12px 18px", color: "var(--danger)", fontSize: 13 }}>{error}</div>
      )}

      {result && (
        <div style={{ padding: "12px 18px" }}>
          {/* Stats row */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label="T-count before" value={String(result.original_t_count ?? 0)} />
            <Stat label="T-count after" value={String(result.simplified_t_count ?? 0)} />
            <Stat
              label="T-count reduction"
              value={`${result.reduction_pct ?? 0}%`}
              accent={improved ? "#22c55e" : undefined}
            />
            {result.original_gate_count != null && (
              <Stat label="Gates before" value={String(result.original_gate_count)} />
            )}
            {result.simplified_gate_count != null && (
              <Stat label="Gates after" value={String(result.simplified_gate_count)} />
            )}
          </div>

          {!improved && (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
              No T-count reduction found — circuit may already be optimal.
            </p>
          )}

          {result.simplified_qasm && (
            <div>
              <button
                className="button secondary"
                style={{ height: 28, fontSize: 12, padding: "0 10px", marginBottom: 8 }}
                onClick={() => setShowQasm(v => !v)}
                type="button"
              >
                {showQasm ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showQasm ? "Hide" : "Show"} simplified QASM
              </button>
              {showQasm && (
                <div style={{ position: "relative" }}>
                  <pre className="code" style={{ maxHeight: 260, overflowY: "auto", fontSize: 12 }}>
                    {result.simplified_qasm}
                  </pre>
                  <button
                    className="button secondary"
                    style={{ position: "absolute", top: 8, right: 8, height: 26, fontSize: 11, padding: "0 8px" }}
                    onClick={copyQasm}
                    type="button"
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className="button secondary"
            style={{ height: 28, fontSize: 12, padding: "0 10px", marginTop: 4 }}
            onClick={() => void run()}
            disabled={loading}
            type="button"
          >
            Re-run
          </button>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  );
}
