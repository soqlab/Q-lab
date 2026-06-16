"use client";

import { useState } from "react";
import { QKDSimResult, runQKDProtocol } from "../../../lib/api";
import { Lock, Play, ShieldCheck, AlertTriangle } from "lucide-react";

const PROTOCOLS = [
  { id: "bb84", label: "BB84", color: "#3b82f6", desc: "Bennett-Brassard 1984" },
  { id: "e91", label: "E91", color: "#8b5cf6", desc: "Ekert 1991 (Bell inequality)" },
  { id: "b92", label: "B92", color: "#10b981", desc: "Bennett 1992" },
  { id: "six_state", label: "Six-State", color: "#f59e0b", desc: "3-basis protocol" },
  { id: "sarg04", label: "SARG04", color: "#ef4444", desc: "Scarani et al. 2004" },
];

export default function ProtocolSimPage() {
  const [protocol, setProtocol] = useState("bb84");
  const [nBits, setNBits] = useState(1000);
  const [eavesdropFraction, setEavesdropFraction] = useState(0);
  const [channelErrorRate, setChannelErrorRate] = useState(0.02);
  const [result, setResult] = useState<QKDSimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProtocol = PROTOCOLS.find((p) => p.id === protocol) ?? PROTOCOLS[0];

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await runQKDProtocol({
        protocol,
        n_bits: nBits,
        eavesdrop_fraction: eavesdropFraction,
        channel_error_rate: channelErrorRate,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <Lock size={28} color="#3b82f6" />
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              QKD Protocol Simulator
            </h1>
            <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
              Simulate quantum key distribution protocols with eavesdropping detection
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div
            style={{
              background: "#1e293b",
              borderRadius: 12,
              border: "1px solid #334155",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                Protocol
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {PROTOCOLS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setProtocol(p.id)}
                    style={{
                      width: "100%",
                      border: `1px solid ${protocol === p.id ? p.color : "transparent"}`,
                      borderRadius: 8,
                      padding: "0.6rem 0.75rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      textAlign: "left",
                      background: protocol === p.id ? `${p.color}22` : "#0f172a",
                      color: protocol === p.id ? p.color : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: "0.85rem" }}>{p.label}</div>
                    <div style={{ fontSize: "0.7rem", opacity: 0.75, fontWeight: 400, color: "#94a3b8" }}>{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Bits sent: {nBits.toLocaleString()}
              </label>
              <input
                type="range"
                min={100}
                max={10000}
                step={100}
                value={nBits}
                onChange={(e) => setNBits(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: activeProtocol.color }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Eavesdrop fraction: {eavesdropFraction === 0 ? "None" : `${(eavesdropFraction * 100).toFixed(0)}%`}
              </label>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={eavesdropFraction}
                onChange={(e) => setEavesdropFraction(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#ef4444" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Channel error rate: {(channelErrorRate * 100).toFixed(1)}%
              </label>
              <input
                type="range"
                min={0}
                max={0.1}
                step={0.005}
                value={channelErrorRate}
                onChange={(e) => setChannelErrorRate(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#f59e0b" }}
              />
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#1e293b" : activeProtocol.color,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontSize: "0.9rem",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Play size={16} />
              {loading ? "Simulating..." : "Run Simulation"}
            </button>

            {error && (
              <div
                style={{
                  background: "#7f1d1d22",
                  border: "1px solid #ef4444",
                  color: "#f87171",
                  borderRadius: 8,
                  padding: "0.75rem",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {!result ? (
              <div
                style={{
                  background: "#1e293b",
                  borderRadius: 12,
                  border: "1px solid #334155",
                  height: 420,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  gap: "0.75rem",
                }}
              >
                <Lock size={48} color="#334155" />
                <p style={{ margin: 0, fontSize: "0.95rem" }}>Configure protocol parameters and click Run Simulation</p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: result.eavesdropper_detected ? "#7f1d1d33" : "#052e1633",
                    border: `1px solid ${result.eavesdropper_detected ? "#ef4444" : "#10b981"}`,
                    borderRadius: 12,
                    padding: "1.25rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {result.eavesdropper_detected ? (
                      <AlertTriangle size={24} color="#ef4444" />
                    ) : (
                      <ShieldCheck size={24} color="#10b981" />
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "1.05rem", color: result.eavesdropper_detected ? "#f87171" : "#34d399" }}>
                        {result.eavesdropper_detected ? "Eavesdropper Detected!" : "Channel Secure"}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                        {result.protocol_name}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      background: result.security_level === "SECURE" ? "#10b98122" : result.security_level === "COMPROMISED" ? "#ef444422" : "#f59e0b22",
                      border: `1px solid ${result.security_level === "SECURE" ? "#10b981" : result.security_level === "COMPROMISED" ? "#ef4444" : "#f59e0b"}`,
                      color: result.security_level === "SECURE" ? "#10b981" : result.security_level === "COMPROMISED" ? "#ef4444" : "#f59e0b",
                      borderRadius: 6,
                      padding: "0.3rem 0.75rem",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                    }}
                  >
                    {result.security_level}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.3rem" }}>Raw Key Rate</div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3b82f6" }}>
                      {result.raw_key_rate.toFixed(3)}
                    </div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "1rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.3rem" }}>Secret Key Rate</div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#10b981" }}>
                      {result.secret_key_rate.toFixed(3)}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.5rem" }}>
                  {[
                    { label: "Bits Sent", value: result.n_bits_sent.toLocaleString(), color: "#3b82f6" },
                    { label: "Sifted Bits", value: result.n_sifted_bits.toLocaleString(), color: "#8b5cf6" },
                    { label: "Secret Bits", value: result.n_secret_bits.toLocaleString(), color: "#10b981" },
                    { label: "QBER", value: `${(result.qber * 100).toFixed(2)}%`, color: result.qber_acceptable ? "#10b981" : "#ef4444" },
                    { label: "Efficiency", value: `${(result.protocol_efficiency * 100).toFixed(1)}%`, color: "#f59e0b" },
                  ].map((card) => (
                    <div
                      key={card.label}
                      style={{
                        background: "#1e293b",
                        borderRadius: 10,
                        border: "1px solid #334155",
                        padding: "0.75rem",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "1.1rem", fontWeight: 700, color: card.color }}>{card.value}</div>
                      <div style={{ color: "#94a3b8", fontSize: "0.7rem", marginTop: "0.2rem" }}>{card.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                    QBER vs Threshold
                  </div>
                  <div style={{ position: "relative" }}>
                    <div style={{ background: "#0f172a", borderRadius: 6, height: 24, position: "relative", overflow: "visible" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: `${Math.min(result.qber * 1000, 100)}%`,
                          background: result.qber_acceptable ? "#10b981" : "#ef4444",
                          borderRadius: 6,
                          transition: "width 0.3s",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: `${Math.min(result.qber_threshold * 1000, 100)}%`,
                          top: -4,
                          bottom: -4,
                          width: 2,
                          background: "#f59e0b",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem", fontSize: "0.75rem", color: "#64748b" }}>
                      <span>QBER: {(result.qber * 100).toFixed(2)}%</span>
                      <span style={{ color: "#f59e0b" }}>Threshold: {(result.qber_threshold * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>

                {protocol === "e91" && result.chsh_s_value !== null && (
                  <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                      Bell Inequality (E91)
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <div>
                        <div style={{ color: "#8b5cf6", fontWeight: 700, fontSize: "1.4rem" }}>
                          S = {result.chsh_s_value.toFixed(4)}
                        </div>
                        <div style={{ color: "#64748b", fontSize: "0.8rem" }}>CHSH Value</div>
                      </div>
                      <div
                        style={{
                          background: result.bell_inequality_violated ? "#8b5cf622" : "#334155",
                          border: `1px solid ${result.bell_inequality_violated ? "#8b5cf6" : "#475569"}`,
                          borderRadius: 6,
                          padding: "0.3rem 0.75rem",
                          color: result.bell_inequality_violated ? "#8b5cf6" : "#94a3b8",
                          fontSize: "0.8rem",
                          fontWeight: 700,
                        }}
                      >
                        {result.bell_inequality_violated ? "Bell Violated" : "Not Violated"}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                    Key Budget Breakdown
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <tbody>
                      {[
                        { label: "Privacy Amplification", value: result.privacy_amplification_bits },
                        { label: "Error Correction", value: result.error_correction_bits },
                        { label: "Basis Reconciliation", value: result.basis_reconciliation },
                      ].map((row) => (
                        <tr key={row.label} style={{ borderBottom: "1px solid #334155" }}>
                          <td style={{ color: "#94a3b8", padding: "0.5rem 0" }}>{row.label}</td>
                          <td style={{ color: "#e2e8f0", fontWeight: 600, textAlign: "right", padding: "0.5rem 0" }}>
                            {row.value.toLocaleString()} bits
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
