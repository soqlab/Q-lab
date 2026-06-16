"use client";

import { useState } from "react";
import { SyndromeDecoderResult, decodeSyndrome } from "../../../lib/api";
import { Shield, Play, AlertTriangle, CheckCircle } from "lucide-react";

const CODES = [
  { id: "surface_d3", label: "Surface d=3", color: "#3b82f6" },
  { id: "surface_d5", label: "Surface d=5", color: "#8b5cf6" },
  { id: "repetition_d3", label: "Repetition d=3", color: "#10b981" },
  { id: "repetition_d5", label: "Repetition d=5", color: "#f59e0b" },
];

export default function SyndromeDecoderPage() {
  const [code, setCode] = useState("surface_d3");
  const [errorRate, setErrorRate] = useState(0.01);
  const [decoder, setDecoder] = useState<"mwpm" | "union_find">("mwpm");
  const [nRounds, setNRounds] = useState(3);
  const [result, setResult] = useState<SyndromeDecoderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await decodeSyndrome({ code, error_rate: errorRate, decoder, n_rounds: nRounds });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const activeCode = CODES.find(c => c.id === code);

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Shield size={22} color="#3b82f6" />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>QEC Syndrome Decoder</h1>
        </div>

        {error && (
          <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Error Code</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {CODES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCode(c.id)}
                    style={{
                      border: code === c.id ? `1.5px solid ${c.color}` : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: code === c.id ? `${c.color}18` : "#0f172a",
                      color: code === c.id ? c.color : "#94a3b8",
                      fontSize: 14,
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Error Rate: <span style={{ color: "#e2e8f0" }}>{(errorRate * 100).toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0.001}
                max={0.2}
                step={0.001}
                value={errorRate}
                onChange={e => setErrorRate(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 2 }}>
                <span>0.1%</span>
                <span>20%</span>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Decoder</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {([{ id: "mwpm", label: "MWPM" }, { id: "union_find", label: "Union-Find" }] as { id: "mwpm" | "union_find"; label: string }[]).map(d => (
                  <button
                    key={d.id}
                    onClick={() => setDecoder(d.id)}
                    style={{
                      border: decoder === d.id ? "1.5px solid #3b82f6" : "1.5px solid #334155",
                      borderRadius: 8,
                      padding: "0.55rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      background: decoder === d.id ? "#3b82f618" : "#0f172a",
                      color: decoder === d.id ? "#3b82f6" : "#94a3b8",
                      fontSize: 14,
                      width: "100%",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Rounds: <span style={{ color: "#e2e8f0" }}>{nRounds}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={nRounds}
                onChange={e => setNRounds(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#3b82f6" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 2 }}>
                <span>1</span>
                <span>10</span>
              </div>
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#1e3a5f" : "#3b82f6",
                color: "#fff",
                fontSize: 15,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Play size={16} />
              {loading ? "Decoding..." : "Decode Syndrome"}
            </button>
          </div>

          <div>
            {result ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{
                    flex: 1,
                    background: "#1e293b",
                    borderRadius: 10,
                    border: `1px solid ${result.logical_error_occurred ? "#ef4444" : "#10b981"}`,
                    padding: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    {result.logical_error_occurred ? (
                      <AlertTriangle size={18} color="#ef4444" />
                    ) : (
                      <CheckCircle size={18} color="#10b981" />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 14, color: result.logical_error_occurred ? "#ef4444" : "#10b981" }}>
                      {result.logical_error_occurred ? "Logical Error Detected" : "No Logical Error"}
                    </span>
                  </div>
                  <div style={{
                    flex: 1,
                    background: "#1e293b",
                    borderRadius: 10,
                    border: `1px solid ${result.below_threshold ? "#10b981" : "#ef4444"}`,
                    padding: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: result.below_threshold ? "#10b981" : "#ef4444" }}>
                      {result.below_threshold ? "Below Threshold ✓" : "Above Threshold ✗"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
                  {[
                    { label: "Code Distance", value: String(result.code_distance), color: activeCode?.color ?? "#3b82f6" },
                    { label: "Triggered", value: String(result.n_triggered_syndromes), color: result.n_triggered_syndromes > 0 ? "#ef4444" : "#10b981" },
                    { label: "Success Rate", value: `${(result.decoder_success_rate * 100).toFixed(1)}%`, color: "#10b981" },
                    { label: "Logical Error Rate", value: result.logical_error_rate_estimate.toFixed(4), color: "#f59e0b" },
                    { label: "Threshold", value: result.threshold_estimate.toFixed(3), color: "#8b5cf6" },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                      Syndrome Pattern
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {result.syndrome_pattern.map((bit, i) => (
                        <div
                          key={i}
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background: bit === 1 ? "#ef4444" : "#1e293b",
                            border: `1px solid ${bit === 1 ? "#ef444488" : "#334155"}`,
                          }}
                          title={`Qubit ${i}: ${bit}`}
                        />
                      ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: "#64748b" }}>
                      {result.n_triggered_syndromes} triggered / {result.syndrome_pattern.length} total
                    </div>
                  </div>

                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                      Correction & Errors
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Correction Operator</div>
                      <span style={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        color: "#8b5cf6",
                        fontFamily: "monospace",
                        fontSize: 13,
                        padding: "3px 10px",
                        borderRadius: 6,
                      }}>
                        {result.correction_operator}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Error Locations</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {result.error_locations.length === 0 ? (
                          <span style={{ fontSize: 12, color: "#64748b" }}>None</span>
                        ) : (
                          result.error_locations.map(loc => (
                            <span key={loc} style={{
                              background: "#7f1d1d22",
                              border: "1px solid #ef444444",
                              color: "#f87171",
                              fontSize: 12,
                              padding: "1px 7px",
                              borderRadius: 4,
                              fontFamily: "monospace",
                            }}>
                              q{loc}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                    Code Info
                  </div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {[
                      { label: "Data Qubits", value: result.n_data_qubits },
                      { label: "Syndrome Qubits", value: result.n_syndrome_qubits },
                      { label: "Decoder", value: result.decoder_used },
                      { label: "Rounds", value: result.n_rounds },
                    ].map(i => (
                      <div key={i.label}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{i.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{i.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                background: "#1e293b",
                borderRadius: 10,
                border: "1px solid #334155",
                height: 420,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}>
                <Shield size={48} color="#334155" />
                <div style={{ color: "#64748b", fontSize: 15 }}>Configure a code and run the decoder to see syndrome analysis</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
