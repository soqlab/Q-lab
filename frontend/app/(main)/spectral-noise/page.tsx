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
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
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
    <div style={{ minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 24, display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>Spectral Noise Analyzer</h1>
        <p style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>1/f noise characterization and TLS defect detection for quantum backends</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        {/* Analysis Form */}
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Run Spectral Analysis</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Qubit (0–9)</label>
              <input
                type="number"
                min={0}
                max={9}
                value={qubit}
                onChange={(e) => setQubit(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Metric</label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {METRICS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Duration (sec)</label>
              <input
                type="number"
                min={600}
                max={86400}
                step={600}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="button"
            style={{ width: "100%", opacity: analyzing ? 0.5 : 1, cursor: analyzing ? "not-allowed" : "pointer" }}
          >
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>

          {analyzeError && (
            <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>{analyzeError}</div>
          )}
        </div>

        {/* TLS Detection Panel */}
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>TLS Defect Detection</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <select
                value={tlsBackend}
                onChange={(e) => setTlsBackend(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Qubit (0–9)</label>
              <input
                type="number"
                min={0}
                max={9}
                value={tlsQubit}
                onChange={(e) => setTlsQubit(Number(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <button
            onClick={handleDetectTLS}
            disabled={detectingTLS}
            className="button"
            style={{ width: "100%", opacity: detectingTLS ? 0.5 : 1, cursor: detectingTLS ? "not-allowed" : "pointer" }}
          >
            {detectingTLS ? "Detecting…" : "Detect TLS"}
          </button>

          {tlsError && (
            <div style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>{tlsError}</div>
          )}

          {tlsReport && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>TLS Detected:</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  ...(tlsReport.n_tls_detected > 0
                    ? { background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }
                    : { background: "rgba(16,185,129,0.1)", color: "var(--ok)", border: "1px solid var(--ok)" })
                }}>
                  {tlsReport.n_tls_detected}
                </span>
              </div>

              {(tlsReport.tls_list ?? []).length > 0 && (
                <div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>TLS Defects</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {(tlsReport.tls_list ?? []).map((tls, i) => (
                      <div key={i} style={{ background: "var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                        <span><span style={{ color: "var(--muted)" }}>Freq:</span> {tls.frequency_ghz.toFixed(3)} GHz</span>
                        <span><span style={{ color: "var(--muted)" }}>Coupling:</span> {tls.coupling_strength.toExponential(2)}</span>
                        <span><span style={{ color: "var(--muted)" }}>T:</span> {tls.coherence_time_us.toFixed(1)} µs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(tlsReport.mitigation_suggestions ?? []).length > 0 && (
                <div>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Mitigation Suggestions</p>
                  <ul style={{ display: "flex", flexDirection: "column", gap: 2, listStyleType: "disc", paddingLeft: 20 }}>
                    {(tlsReport.mitigation_suggestions ?? []).map((s, i) => (
                      <li key={i} style={{ fontSize: 12, color: "var(--text)" }}>{s}</li>
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
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Power Spectral Density</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{currentPSD.backend} · Q{currentPSD.qubit} · {currentPSD.metric}</span>
          </div>

          {/* Key metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
            {[
              { label: "Noise Floor", value: currentPSD.noise_floor.toExponential(3) },
              { label: "1/f Coefficient", value: currentPSD.one_over_f_coefficient.toExponential(3) },
              { label: "1/f Exponent", value: currentPSD.one_over_f_exponent.toFixed(3) },
              { label: "White Noise", value: currentPSD.white_noise_level.toExponential(3) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</p>
                <p style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", fontWeight: 600, color: "var(--text)" }}>{value}</p>
              </div>
            ))}
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>TLS Detected</p>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                ...(currentPSD.tls_detected
                  ? { background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }
                  : { background: "rgba(16,185,129,0.1)", color: "var(--ok)", border: "1px solid var(--ok)" })
              }}>
                {currentPSD.tls_detected ? "YES" : "NO"}
              </span>
            </div>
          </div>

          {/* SVG Chart */}
          <PSDChart psd={currentPSD} />
        </div>
      )}

      {/* Analyses Table */}
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--strong)" }}>Previous Analyses</h2>

        {loadingAnalyses ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading analyses…</div>
        ) : analysesError ? (
          <div style={{ color: "var(--danger)", fontSize: 13 }}>{analysesError}</div>
        ) : analyses.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No analyses found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Backend</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Qubit</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Metric</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>TLS</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Noise Floor</th>
                  <th style={{ paddingBottom: 8, fontWeight: 500 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {(analyses ?? []).map((a) => (
                  <tr
                    key={a.analysis_id}
                    onClick={() => handleSelectAnalysis(a.analysis_id)}
                    style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "8px 16px 8px 0", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{a.backend}</td>
                    <td style={{ padding: "8px 16px 8px 0" }}>{a.qubit}</td>
                    <td style={{ padding: "8px 16px 8px 0", fontSize: 12 }}>{a.metric}</td>
                    <td style={{ padding: "8px 16px 8px 0" }}>
                      <span style={{
                        fontSize: 12, padding: "2px 6px", borderRadius: 999, fontWeight: 500,
                        ...(a.tls_detected
                          ? { background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid var(--danger)" }
                          : { background: "rgba(16,185,129,0.1)", color: "var(--ok)", border: "1px solid var(--ok)" })
                      }}>
                        {a.tls_detected ? "YES" : "NO"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 16px 8px 0", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{a.noise_floor.toExponential(3)}</td>
                    <td style={{ padding: "8px 0", fontSize: 12, color: "var(--muted)" }}>{new Date(a.created_at).toLocaleDateString()}</td>
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
