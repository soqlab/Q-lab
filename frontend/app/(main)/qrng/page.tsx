"use client";
import { useEffect, useState } from "react";
import { QRNGGenResult, generateQRNG, listQRNGResults } from "../../../lib/api";
import { Shuffle, ShieldCheck, AlertTriangle, Copy, Check } from "lucide-react";

type QRNGListItem = { result_id: string; n_bits: number; chsh_value: number; is_quantum_certified: boolean; created_at: string };

const CHSH_MAX = 2 * Math.sqrt(2);

function CHSHGauge({ value }: { value: number }) {
  const W = 260; const H = 130; const R = 100; const CX = 130; const CY = 120;
  const pct = Math.min(value / CHSH_MAX, 1);
  const startAngle = Math.PI;
  const arcX = (angle: number) => CX + R * Math.cos(angle);
  const arcY = (angle: number) => CY - R * Math.sin(angle);
  const classicalPct = 2 / CHSH_MAX;
  const classicalAngle = startAngle - classicalPct * Math.PI;
  const valueAngle = startAngle - pct * Math.PI;
  const isQuantum = value > 2.0;

  // arc from startAngle to valueAngle (going clockwise = decreasing angle)
  const largeArc = pct > 0.5 ? 1 : 0;
  const vx = arcX(valueAngle);
  const vy = arcY(valueAngle);
  const cx2 = arcX(classicalAngle);
  const cy2 = arcY(classicalAngle);

  return (
    <svg width={W} height={H + 10} style={{ display: "block", margin: "0 auto" }}>
      {/* Background grey arc */}
      <path d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 0 1 ${cx2} ${cy2}`}
        fill="none" stroke="#334155" strokeWidth={14} strokeLinecap="round" />
      {/* Blue quantum region arc */}
      <path d={`M ${cx2} ${cy2} A ${R} ${R} 0 0 1 ${arcX(0)} ${arcY(0)}`}
        fill="none" stroke="#3b82f6" strokeWidth={14} strokeLinecap="round" />
      {/* Filled arc up to value */}
      {pct > 0 && (
        <path d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 ${largeArc} 1 ${vx} ${vy}`}
          fill="none" stroke={isQuantum ? "#10b981" : "#f59e0b"} strokeWidth={14} strokeLinecap="round" />
      )}
      {/* Needle */}
      <line x1={CX} y1={CY} x2={vx} y2={vy} stroke="#e2e8f0" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={CX} cy={CY} r={5} fill="#e2e8f0" />
      {/* Labels */}
      <text x={CX - R - 8} y={CY + 16} fill="#475569" fontSize={10} textAnchor="middle">0</text>
      <text x={CX} y={CY - R - 8} fill="#475569" fontSize={10} textAnchor="middle">√2</text>
      <text x={CX + R + 8} y={CY + 16} fill="#475569" fontSize={10} textAnchor="middle">2√2</text>
      <text x={CX} y={CY + 22} fill={isQuantum ? "#10b981" : "#f59e0b"} fontSize={13} fontWeight="bold" textAnchor="middle">S = {value.toFixed(3)}</text>
      {/* Classical bound marker */}
      <line x1={cx2 - 8 * Math.sin(classicalAngle)} y1={cy2 - 8 * Math.cos(classicalAngle)}
        x2={cx2 + 8 * Math.sin(classicalAngle)} y2={cy2 + 8 * Math.cos(classicalAngle)}
        stroke="#f59e0b" strokeWidth={2} />
      <text x={cx2} y={cy2 - 12} fill="#f59e0b" fontSize={9} textAnchor="middle">S=2</text>
    </svg>
  );
}

function HexDisplay({ hex }: { hex: string }) {
  const [copied, setCopied] = useState(false);
  const chunks = hex.match(/.{1,2}/g) ?? [];
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", position: "relative" }}>
      <button onClick={async () => { await navigator.clipboard.writeText(hex); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ position: "absolute", top: 8, right: 8, background: "#1e293b", border: "1px solid #334155", color: copied ? "#10b981" : "#3b82f6", borderRadius: 6, padding: "0.25rem 0.5rem", cursor: "pointer", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}>
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
      </button>
      <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#3b82f6", wordBreak: "break-all", lineHeight: 1.8 }}>
        {chunks.map((b, i) => (
          <span key={i} style={{ color: i % 2 === 0 ? "#3b82f6" : "#8b5cf6", marginRight: 2 }}>{b}</span>
        ))}
      </div>
    </div>
  );
}

export default function QRNGPage() {
  const [nBits, setNBits] = useState(128);
  const [result, setResult] = useState<QRNGGenResult | null>(null);
  const [history, setHistory] = useState<QRNGListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listQRNGResults().then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true); setError(null);
    try {
      const r = await generateQRNG({ n_bits: nBits });
      setResult(r);
      setHistory(prev => [{ result_id: r.result_id, n_bits: r.n_bits, chsh_value: r.chsh_value, is_quantum_certified: r.is_quantum_certified, created_at: r.created_at }, ...prev]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGenerating(false); }
  };

  const tests = result?.randomness_tests;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Shuffle size={28} color="#8b5cf6" /> Quantum-Certified Random Number Generator
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Generates random bits from simulated Bell pair measurements. CHSH inequality certification: S &gt; 2.0 proves quantum origin of randomness.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginBottom: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Generator Settings</h3>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 12 }}>
              Bits to generate: <span style={{ color: "#8b5cf6", fontWeight: 700 }}>{nBits}</span>
              <input type="range" min={16} max={1024} step={16} value={nBits} onChange={e => setNBits(Number(e.target.value))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#8b5cf6" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#475569", marginTop: 2 }}>
                <span>16</span><span>1024</span>
              </div>
            </label>
            <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.6rem", marginBottom: 12, fontSize: "0.78rem", color: "#64748b" }}>
              → {Math.ceil(nBits / 8)} bytes · {Math.ceil(nBits / 64)} 64-bit integers
            </div>
            <button onClick={handleGenerate} disabled={generating}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: generating ? 0.6 : 1 }}>
              <Shuffle size={16} /> {generating ? "Generating…" : "Generate Random Bits"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>History</h3>
            {loading ? <div style={{ color: "#475569", fontSize: "0.8rem" }}>Loading…</div> :
              history.slice(0, 8).map(r => (
                <div key={r.result_id}
                  style={{ padding: "0.5rem 0.6rem", borderRadius: 6, marginBottom: 4, cursor: "pointer", background: result?.result_id === r.result_id ? "#0f172a" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#e2e8f0", fontSize: "0.82rem" }}>{r.n_bits} bits</span>
                    <span style={{ fontSize: "0.72rem" }}>
                      {r.is_quantum_certified
                        ? <span style={{ color: "#10b981" }}>✓ Certified</span>
                        : <span style={{ color: "#f59e0b" }}>◆ Classical</span>}
                    </span>
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.7rem" }}>S={r.chsh_value.toFixed(3)} · {new Date(r.created_at).toLocaleString()}</div>
                </div>
              ))
            }
          </div>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${result.is_quantum_certified ? "#10b98140" : "#f59e0b40"}`, padding: "1.5rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  {result.is_quantum_certified
                    ? <ShieldCheck size={28} color="#10b981" />
                    : <AlertTriangle size={28} color="#f59e0b" />}
                  <div>
                    <div style={{ color: result.is_quantum_certified ? "#10b981" : "#f59e0b", fontWeight: 700, fontSize: "1.2rem" }}>
                      {result.is_quantum_certified ? "Quantum-Certified Randomness" : "Classical-Grade Randomness"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.82rem" }}>{result.certification_message}</div>
                  </div>
                </div>
                <CHSHGauge value={result.chsh_value} />
                <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 8, fontSize: "0.75rem", color: "#64748b" }}>
                  <span>Classical bound: <span style={{ color: "#f59e0b" }}>{result.classical_bound.toFixed(3)}</span></span>
                  <span>Quantum max: <span style={{ color: "#3b82f6" }}>{result.quantum_bound.toFixed(3)}</span></span>
                </div>
              </div>

              {tests && (
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem", marginBottom: "1rem" }}>
                  <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>Randomness Tests</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {([
                      { key: "frequency_test", label: "Frequency Test", t: tests.frequency_test },
                      { key: "runs_test", label: "Runs Test", t: tests.runs_test },
                      { key: "block_frequency_test", label: "Block Frequency", t: tests.block_frequency_test },
                    ] as const).map(({ key, label, t }) => (
                      <div key={key} style={{ background: "#0f172a", borderRadius: 8, padding: "0.6rem 0.75rem" }}>
                        <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{label}</div>
                        <div style={{ color: t.pass ? "#10b981" : "#ef4444", fontWeight: 700, fontSize: "0.85rem" }}>{t.pass ? "✓ Pass" : "✗ Fail"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, color: tests.overall_pass ? "#10b981" : "#ef4444", fontSize: "0.82rem", fontWeight: 600 }}>
                    {tests.overall_pass ? "✓ All statistical tests pass" : "✗ Some tests failed — not suitable for cryptographic use"}
                  </div>
                </div>
              )}

              <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem", marginBottom: 8 }}>
                  Hex Output — {result.n_bits} bits ({Math.ceil(result.n_bits / 8)} bytes)
                </h3>
                <HexDisplay hex={result.hex_output} />
                {result.first_32_bits && (
                  <div style={{ marginTop: 8, color: "#64748b", fontSize: "0.75rem", fontFamily: "monospace" }}>First 32 bits: <span style={{ color: "#8b5cf6" }}>{result.first_32_bits}</span></div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <Shuffle size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Click Generate to produce quantum-certified random bits.</p>
              <p style={{ fontSize: "0.85rem", marginTop: 4 }}>CHSH test certifies that bits originate from quantum measurements.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
