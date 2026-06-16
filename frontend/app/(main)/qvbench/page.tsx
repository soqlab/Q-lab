"use client";
import { useEffect, useState } from "react";
import { QVBenchResult, QVWidthResult, runQVBench, listQVNoiseProfiles } from "../../../lib/api";
import { Award, Play, CheckCircle, XCircle } from "lucide-react";

type NoiseProfile = { id: string; noise_level: number };

const NOISE_COLORS: Record<string, string> = {
  ideal: "#10b981",
  near_term: "#3b82f6",
  noisy: "#f59e0b",
  very_noisy: "#ef4444",
};

function TrialBar({ prob, threshold }: { prob: number; threshold: number }) {
  const pass = prob >= threshold;
  const color = pass ? "#10b981" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ flex: 1, height: 10, background: "#0f172a", borderRadius: 99, position: "relative" }}>
        <div style={{ width: `${Math.min(prob, 1) * 100}%`, height: "100%", background: color + "99", borderRadius: 99 }} />
        <div style={{ position: "absolute", top: 0, left: `${threshold * 100}%`, height: "100%", width: 1.5, background: "#475569" }} />
      </div>
      <span style={{ fontSize: "0.68rem", color, width: 36, textAlign: "right" }}>{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

function WidthCard({ w, accentColor }: { w: QVWidthResult; accentColor: string }) {
  const passColor = w.certified ? "#10b981" : "#ef4444";
  return (
    <div style={{ background: "#1e293b", borderRadius: 10, border: `1px solid ${passColor}30`, padding: "0.85rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "0.9rem" }}>n={w.n_qubits}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {w.certified
            ? <CheckCircle size={14} color="#10b981" />
            : <XCircle size={14} color="#ef4444" />}
          <span style={{ color: passColor, fontSize: "0.78rem", fontWeight: 600 }}>
            {w.certified ? `QV=${w.qv_at_width}` : "Failed"}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 6 }}>
        <span style={{ color: "#64748b" }}>Heavy prob: <span style={{ color: w.mean_heavy_output_prob >= 2 / 3 ? "#10b981" : "#f59e0b", fontWeight: 700 }}>{(w.mean_heavy_output_prob * 100).toFixed(1)}%</span></span>
        <span style={{ color: "#64748b" }}>Pass rate: <span style={{ color: "#e2e8f0" }}>{(w.pass_rate * 100).toFixed(1)}%</span></span>
      </div>
      <TrialBar prob={w.mean_heavy_output_prob} threshold={2 / 3} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {w.trials.map((t, i) => (
          <div key={i} title={`Trial ${i + 1}: ${(t.hop * 100).toFixed(1)}%`}
            style={{ width: 10, height: 10, borderRadius: 2, background: t.pass ? "#10b981" : "#ef4444", opacity: 0.8 }} />
        ))}
      </div>
    </div>
  );
}

export default function QVBenchPage() {
  const [noiseProfile, setNoiseProfile] = useState("near_term");
  const [maxQubits, setMaxQubits] = useState(5);
  const [nTrials, setNTrials] = useState(100);
  const [profiles, setProfiles] = useState<NoiseProfile[]>([
    { id: "ideal", noise_level: 0 },
    { id: "near_term", noise_level: 0.002 },
    { id: "noisy", noise_level: 0.005 },
    { id: "very_noisy", noise_level: 0.015 },
  ]);
  const [result, setResult] = useState<QVBenchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listQVNoiseProfiles().then(p => setProfiles(p)).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true); setError(null);
    try { setResult(await runQVBench({ noise_profile: noiseProfile, max_qubits: maxQubits, n_trials: nTrials })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const accent = NOISE_COLORS[noiseProfile] || "#3b82f6";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Award size={28} color="#f59e0b" /> Quantum Volume Auto-Benchmarker
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Implements the IBM Quantum Volume protocol: random SU(4) square circuits, heavy output probability
          threshold 2/3, certification when pass rate − 2σ exceeds threshold.
        </p>
      </div>
      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.75rem" }}>Noise Profile</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {profiles.map(p => {
              const c = NOISE_COLORS[p.id] || "#64748b";
              return (
                <button key={p.id} onClick={() => setNoiseProfile(p.id)}
                  style={{ textAlign: "left", background: noiseProfile === p.id ? c + "22" : "#0f172a", border: `1px solid ${noiseProfile === p.id ? c : "#334155"}`, borderRadius: 7, padding: "0.5rem 0.75rem", cursor: "pointer", color: noiseProfile === p.id ? c : "#94a3b8", fontWeight: noiseProfile === p.id ? 700 : 400, fontSize: "0.82rem" }}>
                  {p.id.replace(/_/g, " ").charAt(0).toUpperCase() + p.id.replace(/_/g, " ").slice(1)}
                  <span style={{ float: "right", fontSize: "0.7rem", opacity: 0.6 }}>{(p.noise_level * 100).toFixed(1)}%</span>
                </button>
              );
            })}
          </div>
          <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: 12 }}>
            Max circuit width (n): <span style={{ color: accent, fontWeight: 700 }}>{maxQubits}</span>
            <input type="range" min={2} max={8} value={maxQubits} onChange={e => setMaxQubits(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4, accentColor: accent }} />
          </label>
          <label style={{ color: "#94a3b8", fontSize: "0.82rem", display: "block", marginBottom: 16 }}>
            Trials per width: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{nTrials}</span>
            <input type="range" min={50} max={500} step={50} value={nTrials} onChange={e => setNTrials(Number(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#64748b" }} />
          </label>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 700, opacity: loading ? 0.6 : 1 }}>
            <Play size={15} /> {loading ? "Benchmarking…" : "Run QV Benchmark"}
          </button>
        </div>

        <div>
          {result ? (
            <div>
              <div style={{ background: result.quantum_volume > 0 ? "#10b98122" : "#7f1d1d22", border: `1px solid ${result.quantum_volume > 0 ? "#10b981" : "#ef4444"}`, borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Award size={36} color={result.quantum_volume > 0 ? "#10b981" : "#ef4444"} />
                  <div>
                    <div style={{ color: result.quantum_volume > 0 ? "#10b981" : "#ef4444", fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>
                      QV = {result.quantum_volume}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginTop: 4 }}>{result.certification_message}</div>
                  </div>
                  {result.quantum_volume > 0 && (
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ color: "#64748b", fontSize: "0.72rem" }}>log₂(QV)</div>
                      <div style={{ color: "#f59e0b", fontSize: "1.5rem", fontWeight: 700 }}>{result.qv_log2}</div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "Widths Tested", value: result.per_width_results.length, color: "#64748b" },
                  { label: "Trials/Width", value: result.n_trials_per_width, color: accent },
                  { label: "QV Score", value: result.quantum_volume, color: result.quantum_volume > 0 ? "#10b981" : "#ef4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
                {result.per_width_results.map(w => (
                  <WidthCard key={w.n_qubits} w={w} accentColor={accent} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#475569" }}>
              <Award size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              <p>Run the QV benchmark to certify Quantum Volume via IBM&apos;s heavy output probability protocol.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
