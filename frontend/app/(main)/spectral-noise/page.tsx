"use client";

import { useState, useEffect, useCallback } from "react";
import {
  analyzeSpectralNoise,
  listSpectralAnalyses,
  getSpectralAnalysis,
  detectTLS,
  NoisePSD,
  TLSReport,
} from "@/lib/api";

const BACKENDS = [
  "ibm_brisbane",
  "ibm_kyoto",
  "ionq_aria_1",
  "rigetti_ankaa_2",
  "quantinuum_h2",
];

const METRICS = [
  "t1_fluctuation",
  "t2_fluctuation",
  "charge_noise",
  "flux_noise",
];

function PSDChart({ psd }: { psd: NoisePSD }) {
  const PAD = { top: 24, right: 24, bottom: 48, left: 64 };
  const W = 640;
  const H = 300;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const freqs = psd.frequencies_hz;
  const vals = psd.psd_values;

  if (!freqs || freqs.length === 0) return null;

  const logFreqs = freqs.map((f) => Math.log10(Math.max(f, 1e-12)));
  const logVals = vals.map((v) => Math.log10(Math.max(v, 1e-40)));

  const minX = Math.min(...logFreqs);
  const maxX = Math.max(...logFreqs);
  const minY = Math.min(...logVals);
  const maxY = Math.max(...logVals);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const toSvgX = (lf: number) => PAD.left + ((lf - minX) / rangeX) * innerW;
  const toSvgY = (lv: number) => PAD.top + ((maxY - lv) / rangeY) * innerH;

  const pathD = logFreqs
    .map((lf, i) => `${i === 0 ? "M" : "L"}${toSvgX(lf).toFixed(1)},${toSvgY(logVals[i]).toFixed(1)}`)
    .join(" ");

  // 1/f reference slope line
  const refY0 = maxY;
  const refY1 = maxY - psd.one_over_f_exponent * rangeX;
  const refPathD = `M${toSvgX(minX).toFixed(1)},${toSvgY(refY0).toFixed(1)} L${toSvgX(maxX).toFixed(1)},${toSvgY(refY1).toFixed(1)}`;

  // X axis ticks
  const xTicks: number[] = [];
  for (let v = Math.ceil(minX); v <= Math.floor(maxX); v++) xTicks.push(v);
  // Y axis ticks
  const yTicks: number[] = [];
  for (let v = Math.ceil(minY); v <= Math.floor(maxY); v += 2) yTicks.push(v);

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} className="block">
        {/* Background */}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="#111827" rx={4} />

        {/* Grid lines */}
        {xTicks.map((t) => (
          <line
            key={`xg-${t}`}
            x1={toSvgX(t)}
            y1={PAD.top}
            x2={toSvgX(t)}
            y2={PAD.top + innerH}
            stroke="#1f2937"
            strokeWidth={1}
          />
        ))}
        {yTicks.map((t) => (
          <line
            key={`yg-${t}`}
            x1={PAD.left}
            y1={toSvgY(t)}
            x2={PAD.left + innerW}
            y2={toSvgY(t)}
            stroke="#1f2937"
            strokeWidth={1}
          />
        ))}

        {/* TLS frequency markers */}
        {psd.tls_frequencies.map((f, i) => {
          const lf = Math.log10(Math.max(f, 1e-12));
          if (lf < minX || lf > maxX) return null;
          const x = toSvgX(lf);
          return (
            <line
              key={`tls-${i}`}
              x1={x}
              y1={PAD.top}
              x2={x}
              y2={PAD.top + innerH}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4,3"
            />
          );
        })}

        {/* 1/f reference slope */}
        <path d={refPathD} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6,4" fill="none" opacity={0.6} />

        {/* Main PSD line */}
        <path d={pathD} stroke="#34d399" strokeWidth={2} fill="none" />

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="#4b5563" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="#4b5563" strokeWidth={1} />

        {/* X ticks + labels */}
        {xTicks.map((t) => (
          <g key={`xt-${t}`}>
            <line x1={toSvgX(t)} y1={PAD.top + innerH} x2={toSvgX(t)} y2={PAD.top + innerH + 5} stroke="#6b7280" strokeWidth={1} />
            <text x={toSvgX(t)} y={PAD.top + innerH + 18} textAnchor="middle" fontSize={10} fill="#9ca3af">
              10^{t}
            </text>
          </g>
        ))}

        {/* Y ticks + labels */}
        {yTicks.map((t) => (
          <g key={`yt-${t}`}>
            <line x1={PAD.left - 5} y1={toSvgY(t)} x2={PAD.left} y2={toSvgY(t)} stroke="#6b7280" strokeWidth={1} />
            <text x={PAD.left - 8} y={toSvgY(t) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              10^{t}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={PAD.left + innerW / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="#6b7280">
          Frequency (Hz) — log scale
        </text>
        <text
          x={14}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#6b7280"
          transform={`rotate(-90, 14, ${PAD.top + innerH / 2})`}
        >
          PSD — log scale
        </text>

        {/* Legend */}
        <g transform={`translate(${PAD.left + 12}, ${PAD.top + 10})`}>
          <line x1={0} y1={0} x2={20} y2={0} stroke="#34d399" strokeWidth={2} />
          <text x={24} y={4} fontSize={10} fill="#9ca3af">PSD</text>
          <line x1={50} y1={0} x2={70} y2={0} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6,4" />
          <text x={74} y={4} fontSize={10} fill="#9ca3af">1/f ref</text>
          {psd.tls_frequencies.length > 0 && (
            <>
              <line x1={112} y1={0} x2={132} y2={0} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4,3" />
              <text x={136} y={4} fontSize={10} fill="#9ca3af">TLS</text>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}

export default function SpectralNoisePage() {
  const [backend, setBackend] = useState("ibm_brisbane");
  const [qubit, setQubit] = useState(0);
  const [metric, setMetric] = useState("t1_fluctuation");
  const [durationSec, setDurationSec] = useState(3600);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [currentPSD, setCurrentPSD] = useState<NoisePSD | null>(null);

  const [tlsBackend, setTlsBackend] = useState("ibm_brisbane");
  const [tlsQubit, setTlsQubit] = useState(0);
  const [detectingTLS, setDetectingTLS] = useState(false);
  const [tlsError, setTlsError] = useState<string | null>(null);
  const [tlsReport, setTlsReport] = useState<TLSReport | null>(null);

  const [analyses, setAnalyses] = useState<NoisePSD[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [analysesError, setAnalysesError] = useState<string | null>(null);

  const loadAnalyses = useCallback(async () => {
    setLoadingAnalyses(true);
    setAnalysesError(null);
    try {
      const data = await listSpectralAnalyses();
      setAnalyses(data);
    } catch {
      setAnalysesError("Failed to load spectral analyses.");
    } finally {
      setLoadingAnalyses(false);
    }
  }, []);

  useEffect(() => {
    loadAnalyses();
  }, [loadAnalyses]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setCurrentPSD(null);
    try {
      const result = await analyzeSpectralNoise({ backend, qubit, metric, duration_sec: durationSec });
      setCurrentPSD(result);
      loadAnalyses();
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDetectTLS = async () => {
    setDetectingTLS(true);
    setTlsError(null);
    setTlsReport(null);
    try {
      const result = await detectTLS({ backend: tlsBackend, qubit: tlsQubit });
      setTlsReport(result);
    } catch (e: unknown) {
      setTlsError(e instanceof Error ? e.message : "TLS detection failed.");
    } finally {
      setDetectingTLS(false);
    }
  };

  const handleSelectAnalysis = async (id: string) => {
    try {
      const result = await getSpectralAnalysis(id);
      setCurrentPSD(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setAnalyzeError("Failed to load analysis.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Spectral Noise Analyzer</h1>
        <p className="text-gray-400 mt-1 text-sm">1/f noise characterization and TLS defect detection for quantum backends</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Analysis Form */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-base font-semibold text-indigo-400">Run Spectral Analysis</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Qubit (0–9)</label>
              <input
                type="number"
                min={0}
                max={9}
                value={qubit}
                onChange={(e) => setQubit(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Metric</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                {METRICS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Duration (sec)</label>
              <input
                type="number"
                min={600}
                max={86400}
                step={600}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>

          {analyzeError && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{analyzeError}</div>
          )}
        </div>

        {/* TLS Detection Panel */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h2 className="text-base font-semibold text-indigo-400">TLS Defect Detection</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <select
                value={tlsBackend}
                onChange={(e) => setTlsBackend(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Qubit (0–9)</label>
              <input
                type="number"
                min={0}
                max={9}
                value={tlsQubit}
                onChange={(e) => setTlsQubit(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={handleDetectTLS}
            disabled={detectingTLS}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {detectingTLS ? "Detecting…" : "Detect TLS"}
          </button>

          {tlsError && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{tlsError}</div>
          )}

          {tlsReport && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">TLS Detected:</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${tlsReport.n_tls_detected > 0 ? "bg-red-900/40 text-red-400 border border-red-800" : "bg-green-900/40 text-green-400 border border-green-800"}`}>
                  {tlsReport.n_tls_detected}
                </span>
              </div>

              {tlsReport.tls_list.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">TLS Defects</p>
                  <div className="space-y-1">
                    {tlsReport.tls_list.map((tls, i) => (
                      <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-xs grid grid-cols-3 gap-2">
                        <span><span className="text-gray-400">Freq:</span> {tls.frequency_ghz.toFixed(3)} GHz</span>
                        <span><span className="text-gray-400">Coupling:</span> {tls.coupling_strength.toExponential(2)}</span>
                        <span><span className="text-gray-400">T:</span> {tls.coherence_time_us.toFixed(1)} µs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tlsReport.mitigation_suggestions.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Mitigation Suggestions</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {tlsReport.mitigation_suggestions.map((s, i) => (
                      <li key={i} className="text-xs text-gray-300">{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* PSD Result */}
      {currentPSD && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-indigo-400">Power Spectral Density</h2>
            <span className="text-xs text-gray-500">{currentPSD.backend} · Q{currentPSD.qubit} · {currentPSD.metric}</span>
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Noise Floor", value: currentPSD.noise_floor.toExponential(3) },
              { label: "1/f Coefficient", value: currentPSD.one_over_f_coefficient.toExponential(3) },
              { label: "1/f Exponent", value: currentPSD.one_over_f_exponent.toFixed(3) },
              { label: "White Noise", value: currentPSD.white_noise_level.toExponential(3) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800 rounded-lg px-3 py-3 text-center">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="text-sm font-mono font-semibold text-gray-100">{value}</p>
              </div>
            ))}
            <div className="bg-gray-800 rounded-lg px-3 py-3 text-center flex flex-col items-center justify-center gap-1">
              <p className="text-xs text-gray-400">TLS Detected</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${currentPSD.tls_detected ? "bg-red-900/40 text-red-400 border border-red-800" : "bg-green-900/40 text-green-400 border border-green-800"}`}>
                {currentPSD.tls_detected ? "YES" : "NO"}
              </span>
            </div>
          </div>

          {/* SVG Chart */}
          <PSDChart psd={currentPSD} />
        </div>
      )}

      {/* Analyses Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
        <h2 className="text-base font-semibold text-indigo-400">Previous Analyses</h2>

        {loadingAnalyses ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading analyses…</div>
        ) : analysesError ? (
          <div className="text-red-400 text-sm">{analysesError}</div>
        ) : analyses.length === 0 ? (
          <div className="text-sm text-gray-500">No analyses found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                  <th className="pb-2 font-medium">Backend</th>
                  <th className="pb-2 font-medium">Qubit</th>
                  <th className="pb-2 font-medium">Metric</th>
                  <th className="pb-2 font-medium">TLS</th>
                  <th className="pb-2 font-medium">Noise Floor</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((a) => (
                  <tr
                    key={a.analysis_id}
                    onClick={() => handleSelectAnalysis(a.analysis_id)}
                    className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2 pr-4 font-mono text-xs">{a.backend}</td>
                    <td className="py-2 pr-4">{a.qubit}</td>
                    <td className="py-2 pr-4 text-xs">{a.metric}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${a.tls_detected ? "bg-red-900/40 text-red-400 border border-red-800" : "bg-green-900/40 text-green-400 border border-green-800"}`}>
                        {a.tls_detected ? "YES" : "NO"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{a.noise_floor.toExponential(3)}</td>
                    <td className="py-2 text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
