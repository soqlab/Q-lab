"use client";

import { useState } from "react";
import { runRandomizedBenchmarking, runSPAMCharacterization, runXEBSuite, getRBGSTReport, RBResult, SPAMResult, RBGSTXEBResult } from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ionq_aria_1", "rigetti_ankaa_2", "quantinuum_h2"];

function DecayCurve({ lengths, probs }: { lengths: number[]; probs: number[] }) {
  if (!lengths.length) return null;
  const W = 280, H = 120, PX = 30, PY = 10;
  const maxL = Math.max(...lengths);
  const xs = lengths.map(l => PX + ((l / maxL) * (W - PX - 10)));
  const ys = probs.map(p => H - PY - p * (H - PY - 10));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ marginTop: 8 }}>
      <line x1={PX} y1={10} x2={PX} y2={H - PY} stroke="#374151" strokeWidth={1} />
      <line x1={PX} y1={H - PY} x2={W - 5} y2={H - PY} stroke="#374151" strokeWidth={1} />
      <path d={d} fill="none" stroke="#6366f1" strokeWidth={2} />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r={3} fill="#6366f1" />)}
      <text x={PX - 2} y={15} fill="#6b7280" fontSize={9} textAnchor="end">1.0</text>
      <text x={PX - 2} y={H - PY + 4} fill="#6b7280" fontSize={9} textAnchor="end">0</text>
    </svg>
  );
}

function ConfusionMatrix({ matrix }: { matrix: number[][] }) {
  if (!matrix.length) return null;
  const n = matrix.length;
  const max = Math.max(...matrix.flat());
  const cell = Math.min(52, Math.floor(180 / n));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, ${cell}px)`, gap: 2 }}>
      {matrix.map((row, i) => row.map((val, j) => {
        const intensity = max > 0 ? val / max : 0;
        const bg = i === j ? `rgba(99,102,241,${intensity})` : `rgba(239,68,68,${intensity * 0.7})`;
        return (
          <div key={`${i}-${j}`} style={{ width: cell, height: cell, background: bg, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: "white" }}>{val.toFixed(3)}</span>
          </div>
        );
      }))}
    </div>
  );
}

export default function RBGSTPage() {
  const [backend, setBackend] = useState(BACKENDS[0]);
  const [rbQubit, setRbQubit] = useState(0);
  const [rbMaxLen, setRbMaxLen] = useState(200);
  const [rbResult, setRbResult] = useState<RBResult | null>(null);
  const [rbLoading, setRbLoading] = useState(false);
  const [rbErr, setRbErr] = useState("");
  const [spamQubits, setSpamQubits] = useState(2);
  const [spamResult, setSpamResult] = useState<SPAMResult | null>(null);
  const [spamLoading, setSpamLoading] = useState(false);
  const [spamErr, setSpamErr] = useState("");
  const [xebQubits, setXebQubits] = useState(2);
  const [xebDepth, setXebDepth] = useState(20);
  const [xebResult, setXebResult] = useState<RBGSTXEBResult | null>(null);
  const [xebLoading, setXebLoading] = useState(false);
  const [xebErr, setXebErr] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  async function doRB() {
    setRbLoading(true); setRbErr("");
    try { setRbResult(await runRandomizedBenchmarking({ backend, qubit: rbQubit, max_sequence_length: rbMaxLen })); }
    catch (e: unknown) { setRbErr(e instanceof Error ? e.message : "Error"); }
    finally { setRbLoading(false); }
  }

  async function doSPAM() {
    setSpamLoading(true); setSpamErr("");
    try { setSpamResult(await runSPAMCharacterization({ backend, n_qubits: spamQubits })); }
    catch (e: unknown) { setSpamErr(e instanceof Error ? e.message : "Error"); }
    finally { setSpamLoading(false); }
  }

  async function doXEB() {
    setXebLoading(true); setXebErr("");
    try { setXebResult(await runXEBSuite({ backend, n_qubits: xebQubits, max_depth: xebDepth })); }
    catch (e: unknown) { setXebErr(e instanceof Error ? e.message : "Error"); }
    finally { setXebLoading(false); }
  }

  async function loadReport() {
    setReportLoading(true);
    try {
      const r = await getRBGSTReport(backend);
      if (r.rb) setRbResult(r.rb);
      if (r.spam) setSpamResult(r.spam);
      if (r.xeb) setXebResult(r.xeb);
    } catch { /* ignore */ }
    finally { setReportLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>RB / GST / SPAM Suite</h1>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Full hardware characterization: Randomized Benchmarking, SPAM analysis, and Cross-Entropy Benchmarking.</p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }}>
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <button onClick={loadReport} disabled={reportLoading}
            style={{ padding: "8px 16px", background: "var(--strong)", borderRadius: 6, fontSize: 13, opacity: reportLoading ? 0.5 : 1, cursor: reportLoading ? "not-allowed" : "pointer", border: "none", color: "var(--text)" }}>
            {reportLoading ? "Loading..." : "Load Full Report"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        {/* RB */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontWeight: 600, color: "var(--strong)" }}>Randomized Benchmarking</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Qubit</label>
              <input type="number" min={0} max={9} value={rbQubit} onChange={e => setRbQubit(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Max Seq Length</label>
              <input type="number" value={rbMaxLen} onChange={e => setRbMaxLen(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
            </div>
          </div>
          <button onClick={doRB} disabled={rbLoading}
            style={{ width: "100%", padding: "8px 0", background: "var(--strong)", borderRadius: 6, fontSize: 13, opacity: rbLoading ? 0.5 : 1, cursor: rbLoading ? "not-allowed" : "pointer", border: "none", color: "var(--text)" }}>
            {rbLoading ? "Running..." : "Run RB"}
          </button>
          {rbErr && <div style={{ color: "var(--danger)", fontSize: 12 }}>{rbErr}</div>}
          {rbResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["EPC", rbResult.error_per_clifford.toExponential(3)], ["EPG", rbResult.error_per_gate.toExponential(3)], ["T-infidelity", rbResult.t_gate_infidelity.toExponential(3)], ["R²", rbResult.fit_r_squared.toFixed(4)]].map(([l, v]) => (
                  <div key={l} style={{ background: "var(--surface)", borderRadius: 6, padding: 8, textAlign: "center", border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
                    <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "var(--strong)" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>95% CI: [{rbResult.confidence_interval[0].toExponential(2)}, {rbResult.confidence_interval[1].toExponential(2)}]</div>
              <DecayCurve lengths={rbResult.sequence_lengths} probs={rbResult.survival_probabilities} />
            </div>
          )}
        </div>

        {/* SPAM */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontWeight: 600, color: "#a78bfa" }}>SPAM Characterization</h2>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Qubits</label>
            <input type="number" min={1} max={4} value={spamQubits} onChange={e => setSpamQubits(Number(e.target.value))}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
          </div>
          <button onClick={doSPAM} disabled={spamLoading}
            style={{ width: "100%", padding: "8px 0", background: "#7c3aed", borderRadius: 6, fontSize: 13, opacity: spamLoading ? 0.5 : 1, cursor: spamLoading ? "not-allowed" : "pointer", border: "none", color: "white" }}>
            {spamLoading ? "Running..." : "Run SPAM"}
          </button>
          {spamErr && <div style={{ color: "var(--danger)", fontSize: 12 }}>{spamErr}</div>}
          {spamResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {[["Prep ε", spamResult.state_prep_error.toExponential(3)], ["Meas ε", spamResult.measurement_error.toExponential(3)], ["F_SPAM", (spamResult.f_spam * 100).toFixed(2) + "%"]].map(([l, v]) => (
                  <div key={l} style={{ background: "var(--surface)", borderRadius: 6, padding: 8, textAlign: "center", border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
                    <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "#a78bfa" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Confusion Matrix</div>
              <ConfusionMatrix matrix={spamResult.confusion_matrix} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(spamResult.recommendations ?? []).map((r, i) => <div key={i} style={{ fontSize: 12, color: "var(--text)" }}>• {r}</div>)}
              </div>
            </div>
          )}
        </div>

        {/* XEB */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontWeight: 600, color: "var(--ok)" }}>Cross-Entropy Benchmarking</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Qubits</label>
              <input type="number" min={1} max={6} value={xebQubits} onChange={e => setXebQubits(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Max Depth</label>
              <input type="number" value={xebDepth} onChange={e => setXebDepth(Number(e.target.value))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13 }} />
            </div>
          </div>
          <button onClick={doXEB} disabled={xebLoading}
            style={{ width: "100%", padding: "8px 0", background: "#15803d", borderRadius: 6, fontSize: 13, opacity: xebLoading ? 0.5 : 1, cursor: xebLoading ? "not-allowed" : "pointer", border: "none", color: "white" }}>
            {xebLoading ? "Running..." : "Run XEB"}
          </button>
          {xebErr && <div style={{ color: "var(--danger)", fontSize: 12 }}>{xebErr}</div>}
          {xebResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["Linear XEB/cycle", xebResult.linear_xeb_per_cycle.toFixed(5)], ["R²", xebResult.fit_r_squared.toFixed(4)]].map(([l, v]) => (
                  <div key={l} style={{ background: "var(--surface)", borderRadius: 6, padding: 8, textAlign: "center", border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
                    <div style={{ fontSize: 12, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "var(--ok)" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>XEB Fidelity by Depth</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(xebResult.circuit_depths ?? []).map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 32, color: "var(--muted)", textAlign: "right", fontFamily: "ui-monospace,monospace" }}>{d}</span>
                    <div style={{ flex: 1, height: 12, background: "var(--line)", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ height: 12, background: "#16a34a", borderRadius: 6, width: `${(xebResult.xeb_fidelities[i] ?? 0) * 100}%` }} />
                    </div>
                    <span style={{ width: 48, fontFamily: "ui-monospace,monospace", color: "var(--ok)" }}>{((xebResult.xeb_fidelities[i] ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
