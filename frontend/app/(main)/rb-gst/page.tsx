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
    <svg width={W} height={H} className="mt-2">
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">RB / GST / SPAM Suite</h1>
          <p className="text-gray-400 text-sm">Full hardware characterization: Randomized Benchmarking, SPAM analysis, and Cross-Entropy Benchmarking.</p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Backend</label>
            <select value={backend} onChange={e => setBackend(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm">
              {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <button onClick={loadReport} disabled={reportLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">
            {reportLoading ? "Loading..." : "Load Full Report"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RB */}
        <div className="bg-gray-900 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-indigo-400">Randomized Benchmarking</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">Qubit</label>
              <input type="number" min={0} max={9} value={rbQubit} onChange={e => setRbQubit(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Max Seq Length</label>
              <input type="number" value={rbMaxLen} onChange={e => setRbMaxLen(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
            </div>
          </div>
          <button onClick={doRB} disabled={rbLoading}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">
            {rbLoading ? "Running..." : "Run RB"}
          </button>
          {rbErr && <div className="text-red-400 text-xs">{rbErr}</div>}
          {rbResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[["EPC", rbResult.error_per_clifford.toExponential(3)], ["EPG", rbResult.error_per_gate.toExponential(3)], ["T-infidelity", rbResult.t_gate_infidelity.toExponential(3)], ["R²", rbResult.fit_r_squared.toFixed(4)]].map(([l, v]) => (
                  <div key={l} className="bg-gray-800 rounded p-2 text-center">
                    <div className="text-xs text-gray-400">{l}</div>
                    <div className="text-xs font-mono font-bold text-indigo-300">{v}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-500">95% CI: [{rbResult.confidence_interval[0].toExponential(2)}, {rbResult.confidence_interval[1].toExponential(2)}]</div>
              <DecayCurve lengths={rbResult.sequence_lengths} probs={rbResult.survival_probabilities} />
            </div>
          )}
        </div>

        {/* SPAM */}
        <div className="bg-gray-900 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-purple-400">SPAM Characterization</h2>
          <div>
            <label className="text-xs text-gray-400">Qubits</label>
            <input type="number" min={1} max={4} value={spamQubits} onChange={e => setSpamQubits(Number(e.target.value))}
              className="w-full mt-1 bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
          </div>
          <button onClick={doSPAM} disabled={spamLoading}
            className="w-full py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm disabled:opacity-50">
            {spamLoading ? "Running..." : "Run SPAM"}
          </button>
          {spamErr && <div className="text-red-400 text-xs">{spamErr}</div>}
          {spamResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[["Prep ε", spamResult.state_prep_error.toExponential(3)], ["Meas ε", spamResult.measurement_error.toExponential(3)], ["F_SPAM", (spamResult.f_spam * 100).toFixed(2) + "%"]].map(([l, v]) => (
                  <div key={l} className="bg-gray-800 rounded p-2 text-center">
                    <div className="text-xs text-gray-400">{l}</div>
                    <div className="text-xs font-mono font-bold text-purple-300">{v}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 mb-1">Confusion Matrix</div>
              <ConfusionMatrix matrix={spamResult.confusion_matrix} />
              <div className="space-y-1">
                {spamResult.recommendations.map((r, i) => <div key={i} className="text-xs text-gray-300">• {r}</div>)}
              </div>
            </div>
          )}
        </div>

        {/* XEB */}
        <div className="bg-gray-900 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-green-400">Cross-Entropy Benchmarking</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400">Qubits</label>
              <input type="number" min={1} max={6} value={xebQubits} onChange={e => setXebQubits(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-400">Max Depth</label>
              <input type="number" value={xebDepth} onChange={e => setXebDepth(Number(e.target.value))}
                className="w-full mt-1 bg-gray-800 text-white px-2 py-1.5 rounded border border-gray-700 text-sm" />
            </div>
          </div>
          <button onClick={doXEB} disabled={xebLoading}
            className="w-full py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">
            {xebLoading ? "Running..." : "Run XEB"}
          </button>
          {xebErr && <div className="text-red-400 text-xs">{xebErr}</div>}
          {xebResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[["Linear XEB/cycle", xebResult.linear_xeb_per_cycle.toFixed(5)], ["R²", xebResult.fit_r_squared.toFixed(4)]].map(([l, v]) => (
                  <div key={l} className="bg-gray-800 rounded p-2 text-center">
                    <div className="text-xs text-gray-400">{l}</div>
                    <div className="text-xs font-mono font-bold text-green-300">{v}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 mb-1">XEB Fidelity by Depth</div>
              <div className="space-y-1">
                {xebResult.circuit_depths.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-gray-500 text-right font-mono">{d}</span>
                    <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                      <div className="h-3 bg-green-600 rounded" style={{ width: `${(xebResult.xeb_fidelities[i] ?? 0) * 100}%` }} />
                    </div>
                    <span className="w-12 font-mono text-green-300">{((xebResult.xeb_fidelities[i] ?? 0) * 100).toFixed(1)}%</span>
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
