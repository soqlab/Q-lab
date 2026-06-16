"use client";
import { useEffect, useState } from "react";
import { QVResult, QVTrend, runQV, listQVResults, getQVTrend } from "../../../lib/api";
import { Cpu, Play, TrendingUp, ChevronRight, CheckCircle, XCircle } from "lucide-react";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ibm_sherbrooke", "simulator_statevector", "custom"];

function MiniBarChart({ data }: { data: { date: string; qv: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.qv), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60, marginTop: 8 }}>
      {data.slice(-20).map((d, i) => (
        <div key={i} title={`${d.date}: QV ${d.qv}`} style={{ flex: 1, background: `rgba(59,130,246,${0.3 + 0.7 * (d.qv / max)})`, borderRadius: "3px 3px 0 0", height: `${(d.qv / max) * 100}%`, minHeight: 2, transition: "height 0.3s" }} />
      ))}
    </div>
  );
}

function TrialTable({ trials }: { trials: QVResult["trial_results"] }) {
  if (!trials?.length) return null;
  return (
    <div style={{ overflowX: "auto", marginTop: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ color: "#64748b", borderBottom: "1px solid #1e293b" }}>
            {["m", "QV", "Mean HOP", "CI Low", "Std", "Pass"].map(h => (
              <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trials.map((t, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
              <td style={{ padding: "0.4rem 0.6rem", color: "#94a3b8" }}>{t.m}</td>
              <td style={{ padding: "0.4rem 0.6rem", color: "#e2e8f0", fontWeight: 700 }}>{t.qv}</td>
              <td style={{ padding: "0.4rem 0.6rem", color: "#e2e8f0" }}>{t.mean_hop?.toFixed(4)}</td>
              <td style={{ padding: "0.4rem 0.6rem", color: "#e2e8f0" }}>{t.ci_low?.toFixed(4)}</td>
              <td style={{ padding: "0.4rem 0.6rem", color: "#94a3b8" }}>{t.std?.toFixed(4)}</td>
              <td style={{ padding: "0.4rem 0.6rem" }}>
                {t.passed
                  ? <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}><CheckCircle size={13} /> Pass</span>
                  : <span style={{ color: "#ef4444", display: "flex", alignItems: "center", gap: 3 }}><XCircle size={13} /> Fail</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function QVPage() {
  const [results, setResults] = useState<QVResult[]>([]);
  const [trend, setTrend] = useState<QVTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<QVResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    backend: "ibm_brisbane", max_qubits: 5, n_trials: 100, shots: 1024, noise_level: 0.01, seed: "",
  });
  const [trendBackend, setTrendBackend] = useState("ibm_brisbane");

  const load = async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([listQVResults(), getQVTrend(trendBackend)]);
      setResults(r); setTrend(t);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [trendBackend]);

  const handleRun = async () => {
    setRunning(true); setError(null);
    try {
      const r = await runQV({
        backend: form.backend, max_qubits: form.max_qubits, n_trials: form.n_trials,
        shots: form.shots, noise_level: form.noise_level,
        seed: form.seed ? parseInt(form.seed) : undefined,
      });
      setResults(prev => [r, ...prev]);
      setSelected(r);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRunning(false); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Cpu size={28} color="#3b82f6" /> Quantum Volume Benchmark
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          QV = 2^m — largest m where heavy output probability &gt; 2/3 with 2σ confidence.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>Run Benchmark</h3>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Backend
              <select value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
                {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>

            {[
              { key: "max_qubits", label: "Max Qubits", min: 2, max: 10, step: 1 },
              { key: "n_trials", label: "Trials", min: 10, max: 500, step: 10 },
              { key: "shots", label: "Shots per trial", min: 128, max: 8192, step: 128 },
            ].map(({ key, label, min, max, step }) => (
              <label key={key} style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
                {label}: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{(form as Record<string, unknown>)[key] as number}</span>
                <input type="range" min={min} max={max} step={step} value={(form as Record<string, unknown>)[key] as number}
                  onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                  style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
              </label>
            ))}

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 10 }}>
              Noise Level: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{form.noise_level}</span>
              <input type="range" min={0} max={0.1} step={0.001} value={form.noise_level}
                onChange={e => setForm(f => ({ ...f, noise_level: Number(e.target.value) }))}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "#3b82f6" }} />
            </label>

            <label style={{ color: "#94a3b8", fontSize: "0.85rem", display: "block", marginBottom: 16 }}>
              Seed (optional)
              <input type="number" value={form.seed} onChange={e => setForm(f => ({ ...f, seed: e.target.value }))} placeholder="random"
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>

            <button onClick={handleRun} disabled={running}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.7rem", cursor: "pointer", fontWeight: 600, opacity: running ? 0.6 : 1, fontSize: "0.95rem" }}>
              <Play size={16} /> {running ? "Running…" : "Run QV Benchmark"}
            </button>
          </div>

          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem", marginTop: "1rem" }}>
            <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={16} color="#3b82f6" /> QV Trend
            </h3>
            <select value={trendBackend} onChange={e => setTrendBackend(e.target.value)}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.4rem 0.75rem", fontSize: "0.85rem", marginBottom: 8, width: "100%" }}>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            {trend && (
              <>
                <div style={{ display: "flex", gap: "1rem", marginBottom: 4 }}>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.75rem" }}>Current QV</div>
                    <div style={{ color: "#3b82f6", fontSize: "1.5rem", fontWeight: 700 }}>{trend.current_qv ?? "—"}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.75rem" }}>Peak QV</div>
                    <div style={{ color: "#10b981", fontSize: "1.5rem", fontWeight: 700 }}>{trend.peak_qv ?? "—"}</div>
                  </div>
                </div>
                <MiniBarChart data={trend.history} />
              </>
            )}
          </div>
        </div>

        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            {loading ? (
              <div style={{ color: "#64748b", padding: "2rem", gridColumn: "1/-1" }}>Loading…</div>
            ) : results.length === 0 ? (
              <div style={{ color: "#64748b", padding: "2rem", textAlign: "center", gridColumn: "1/-1" }}>
                No QV results yet. Run your first benchmark.
              </div>
            ) : (
              results.map(r => (
                <button key={r.qv_id} onClick={() => setSelected(r === selected ? null : r)}
                  style={{ background: selected?.qv_id === r.qv_id ? "#1d3a6b" : "#1e293b", borderRadius: 12, border: `1px solid ${r.passed ? "#10b981" : "#ef4444"}`, padding: "1rem", textAlign: "left", cursor: "pointer", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{r.backend}</div>
                    <span style={{ fontSize: "0.7rem", color: r.passed ? "#10b981" : "#ef4444", background: r.passed ? "#10b98122" : "#ef444422", padding: "0 6px", borderRadius: 4, fontWeight: 600 }}>
                      {r.passed ? "PASS" : "FAIL"}
                    </span>
                  </div>
                  <div style={{ color: "#3b82f6", fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>QV {r.qv_achieved}</div>
                  <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: 4 }}>
                    log₂={r.log2_qv} · HOP={r.heavy_output_prob?.toFixed(3)} · {r.n_trials} trials
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.72rem", marginTop: 2 }}>
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                  <ChevronRight size={14} color="#334155" style={{ float: "right", marginTop: -16 }} />
                </button>
              ))
            )}
          </div>

          {selected && (
            <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h3 style={{ color: "#e2e8f0", fontWeight: 600 }}>QV {selected.qv_achieved} — {selected.backend}</h3>
                <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{selected.n_qubits_tested} qubits tested</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                {[
                  { label: "QV Score", value: selected.qv_achieved, color: "#3b82f6" },
                  { label: "log₂(QV)", value: selected.log2_qv, color: "#8b5cf6" },
                  { label: "Mean HOP", value: selected.heavy_output_prob?.toFixed(4), color: "#10b981" },
                  { label: "Pass Threshold", value: selected.pass_threshold?.toFixed(3), color: "#f59e0b" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
                    <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{m.label}</div>
                    <div style={{ color: m.color, fontSize: "1.3rem", fontWeight: 700 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <h4 style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: 4 }}>Per-m Trial Results</h4>
              <TrialTable trials={selected.trial_results} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
