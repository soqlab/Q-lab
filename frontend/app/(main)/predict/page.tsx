"use client";

import { useState } from "react";
import {
  Brain, Clock, Calculator, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Minus, Zap, Target, Activity,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const API = "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function healthColor(h: number | null): string {
  if (h === null) return "#555";
  if (h >= 80) return "#27ae60";
  if (h >= 60) return "#f39c12";
  if (h >= 40) return "#e67e22";
  return "#e74c3c";
}

function HealthGauge({ value }: { value: number }) {
  const clamp = Math.max(0, Math.min(100, value));
  const color = healthColor(clamp);
  // SVG arc gauge: center 60,60 radius 50, sweep 180° semi-circle
  const r = 50;
  const cx = 60;
  const cy = 65;
  const startX = cx - r;
  const endX = cx + r;
  const pct = clamp / 100;
  const angle = Math.PI * pct; // 0..π
  const needleX = cx + r * Math.cos(Math.PI - angle);
  const needleY = cy - r * Math.sin(Math.PI - angle);
  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 120 75" width={180} height={112}>
        {/* Track */}
        <path d={`M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`}
          fill="none" stroke="#333" strokeWidth={10} strokeLinecap="round" />
        {/* Fill */}
        {clamp > 0 && (
          <path d={`M ${startX} ${cy} A ${r} ${r} 0 0 1 ${needleX} ${needleY}`}
            fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
        )}
        {/* Needle tip circle */}
        <circle cx={needleX} cy={needleY} r={5} fill={color} />
        {/* Value text */}
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={22} fontWeight={700} fill={color}>
          {clamp.toFixed(1)}
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle" fontSize={8} fill="#aaa">/ 100</text>
      </svg>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: "#27ae60", medium: "#f39c12", low: "#e74c3c",
  };
  const c = colors[confidence] ?? "#888";
  return (
    <span style={{
      padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700,
      background: c + "22", color: c, border: `1px solid ${c}44`,
    }}>
      {confidence.toUpperCase()} CONFIDENCE
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab: Outcome Predictor
// ---------------------------------------------------------------------------
interface PredictResult {
  predicted_health: number;
  confidence: string;
  confidence_interval?: [number, number];
  n_training_runs: number;
  message?: string;
  similar_runs?: Array<{ run_id: string; circuit_name: string; health_score: number; similarity: number }>;
  recommendation?: string;
  risk_factors?: string[];
}

function OutcomePredictor() {
  const [backend, setBackend] = useState("ibm_sherbrooke");
  const [nQubits, setNQubits] = useState(5);
  const [depth, setDepth] = useState(20);
  const [shots, setShots] = useState(1024);
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [gateError, setGateError] = useState("");
  const [readoutError, setReadoutError] = useState("");
  const [optLevel, setOptLevel] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePredict(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        backend,
        n_qubits: nQubits,
        circuit_depth: depth,
        n_shots: shots,
        optimization_level: optLevel,
      };
      if (t1) body.t1_us = parseFloat(t1);
      if (t2) body.t2_us = parseFloat(t2);
      if (gateError) body.gate_error_2q = parseFloat(gateError);
      if (readoutError) body.readout_error = parseFloat(readoutError);

      const r = await apiFetch("/api/v1/predict/health-score", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "#1a1a2e", border: "1px solid #333", borderRadius: 6,
    color: "#e8e8f0", padding: "6px 10px", fontSize: 13, width: "100%",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: "#8888aa", fontWeight: 500, marginBottom: 3, display: "block",
  };

  return (
    <div>
      <p style={{ color: "#8888aa", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        ML-powered prediction using k-Nearest Neighbors trained on your run history.
        Enter circuit parameters to get a predicted health score before spending QPU credits.
      </p>
      <form onSubmit={handlePredict}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Backend</label>
            <input style={inputStyle} value={backend} onChange={e => setBackend(e.target.value)} required />
          </div>
          <div>
            <label style={labelStyle}>N Qubits (1–127)</label>
            <input style={inputStyle} type="range" min={1} max={127} value={nQubits}
              onChange={e => setNQubits(+e.target.value)} />
            <span style={{ color: "#e8e8f0", fontSize: 13 }}>{nQubits}</span>
          </div>
          <div>
            <label style={labelStyle}>Circuit Depth</label>
            <input style={inputStyle} type="number" min={1} value={depth}
              onChange={e => setDepth(+e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>N Shots</label>
            <input style={inputStyle} type="number" min={1} value={shots}
              onChange={e => setShots(+e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Optimization Level</label>
            <select style={inputStyle} value={optLevel} onChange={e => setOptLevel(+e.target.value)}>
              <option value={0}>0 — No optimization</option>
              <option value={1}>1 — Light</option>
              <option value={2}>2 — Medium (default)</option>
              <option value={3}>3 — Heavy</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#6666aa", marginBottom: 8, fontWeight: 600 }}>
            Calibration Parameters (optional — auto-inferred from history if blank)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>T1 (µs)</label>
              <input style={inputStyle} type="number" step="any" placeholder="e.g. 100" value={t1}
                onChange={e => setT1(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>T2 (µs)</label>
              <input style={inputStyle} type="number" step="any" placeholder="e.g. 80" value={t2}
                onChange={e => setT2(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Gate Error 2Q</label>
              <input style={inputStyle} type="number" step="any" placeholder="e.g. 0.01" value={gateError}
                onChange={e => setGateError(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Readout Error</label>
              <input style={inputStyle} type="number" step="any" placeholder="e.g. 0.02" value={readoutError}
                onChange={e => setReadoutError(e.target.value)} />
            </div>
          </div>
        </div>
        <button type="submit" disabled={loading} style={{
          background: loading ? "#333" : "#5b4fcf", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Brain size={15} />
          {loading ? "Predicting…" : "Predict Health Score"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 14, background: "#2a1515", border: "1px solid #c0392b",
          borderRadius: 8, padding: "10px 14px", color: "#e74c3c", fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
          {result.message ? (
            <div style={{ background: "#1e1e35", border: "1px solid #444", borderRadius: 10,
              padding: 16, color: "#aaa", fontSize: 13 }}>
              <AlertTriangle size={14} style={{ marginRight: 6 }} />
              {result.message} ({result.n_training_runs} training runs available)
            </div>
          ) : (
            <>
              {/* Main prediction card */}
              <div style={{ background: "#1e1e35", border: "1px solid #444", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                  <div>
                    <HealthGauge value={result.predicted_health} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "#e8e8f0" }}>
                        Predicted Health
                      </span>
                      {result.confidence && <ConfidenceBadge confidence={result.confidence} />}
                    </div>

                    {result.confidence_interval && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: "#8888aa", marginBottom: 4 }}>
                          Confidence Interval
                        </div>
                        <div style={{ position: "relative", height: 8, background: "#333", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            position: "absolute",
                            left: `${result.confidence_interval[0]}%`,
                            width: `${result.confidence_interval[1] - result.confidence_interval[0]}%`,
                            height: "100%",
                            background: healthColor(result.predicted_health),
                            borderRadius: 4,
                          }} />
                          <div style={{
                            position: "absolute",
                            left: `${result.predicted_health}%`,
                            transform: "translateX(-50%)",
                            width: 3, height: "100%",
                            background: "#fff",
                          }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginTop: 2 }}>
                          <span>{result.confidence_interval[0]}</span>
                          <span>{result.confidence_interval[1]}</span>
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: 13, color: "#ccc", marginBottom: 6 }}>
                      {result.recommendation}
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      Trained on {result.n_training_runs} historical runs
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk factors */}
              {result.risk_factors && result.risk_factors.length > 0 && (
                <div style={{ background: "#1e1a10", border: "1px solid #7c5500", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f39c12", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={14} /> Risk Factors
                  </div>
                  {result.risk_factors.map((rf, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#d4a018", padding: "4px 0",
                      borderLeft: "3px solid #f39c12", paddingLeft: 10, marginBottom: 4 }}>
                      {rf}
                    </div>
                  ))}
                </div>
              )}

              {/* Similar runs */}
              {result.similar_runs && result.similar_runs.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#aaa", marginBottom: 8 }}>
                    Similar Historical Runs
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {result.similar_runs.map((sr) => (
                      <div key={sr.run_id} style={{ background: "#1e1e35", border: "1px solid #333",
                        borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, color: "#666", marginBottom: 4, fontFamily: "monospace" }}>
                          {sr.run_id.slice(0, 12)}…
                        </div>
                        <div style={{ fontSize: 13, color: "#ccc", marginBottom: 6,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sr.circuit_name}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: healthColor(sr.health_score) }}>
                            {sr.health_score.toFixed(1)}
                          </span>
                          <span style={{ fontSize: 11, color: "#666" }}>
                            {(sr.similarity * 100).toFixed(0)}% similar
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Timing Advisor
// ---------------------------------------------------------------------------
interface TimingResult {
  backend: string;
  analysis_runs: number;
  best_times: Array<{ day: string; hour_utc: number; avg_health: number; n_runs: number }>;
  worst_times: Array<{ day: string; hour_utc: number; avg_health: number; n_runs: number }>;
  heatmap: Array<Array<number | null>>;
  recommendation: string;
  timezone_note: string;
}

interface NowResult {
  should_run_now: boolean;
  current_slot_avg_health: number | null;
  recommendation: string;
  next_good_window: string;
}

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function HeatmapGrid({ heatmap }: { heatmap: Array<Array<number | null>> }) {
  const allVals = heatmap.flat().filter((v): v is number => v !== null);
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 100;
  const range = maxV - minV || 1;

  function cellColor(v: number | null): string {
    if (v === null) return "#1a1a2e";
    const t = (v - minV) / range;
    // Interpolate red → yellow → green
    if (t < 0.5) {
      const tt = t * 2;
      const r = Math.round(231 + (243 - 231) * tt);
      const g = Math.round(76 + (156 - 76) * tt);
      const b = Math.round(60 + (18 - 60) * tt);
      return `rgb(${r},${g},${b})`;
    } else {
      const tt = (t - 0.5) * 2;
      const r = Math.round(243 + (39 - 243) * tt);
      const g = Math.round(156 + (174 - 156) * tt);
      const b = Math.round(18 + (96 - 18) * tt);
      return `rgb(${r},${g},${b})`;
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 600 }}>
        {/* Hour labels */}
        <div style={{ display: "flex", marginLeft: 36 }}>
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} style={{ width: 24, fontSize: 8, color: "#555", textAlign: "center", flexShrink: 0 }}>
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {heatmap.map((row, dayIdx) => (
          <div key={dayIdx} style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
            <div style={{ width: 30, fontSize: 10, color: "#666", flexShrink: 0 }}>
              {DAYS_SHORT[dayIdx]}
            </div>
            {row.map((val, hourIdx) => (
              <div
                key={hourIdx}
                title={val !== null ? `${DAYS_SHORT[dayIdx]} ${hourIdx}:00 UTC — avg health: ${val.toFixed(1)}` : "No data"}
                style={{
                  width: 22, height: 16, borderRadius: 2,
                  background: cellColor(val),
                  flexShrink: 0, marginRight: 2,
                  cursor: "default", opacity: val === null ? 0.2 : 1,
                }}
              />
            ))}
          </div>
        ))}
        {/* Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 36 }}>
          <span style={{ fontSize: 10, color: "#555" }}>Low</span>
          <div style={{ display: "flex", gap: 1 }}>
            {Array.from({ length: 20 }).map((_, i) => {
              const t = i / 19;
              return <div key={i} style={{ width: 14, height: 8, borderRadius: 1, background: cellColor(minV + t * range) }} />;
            })}
          </div>
          <span style={{ fontSize: 10, color: "#555" }}>High</span>
        </div>
      </div>
    </div>
  );
}

function TimingAdvisor() {
  const [backend, setBackend] = useState("ibm_sherbrooke");
  const [loading, setLoading] = useState(false);
  const [nowLoading, setNowLoading] = useState(false);
  const [result, setResult] = useState<TimingResult | null>(null);
  const [nowResult, setNowResult] = useState<NowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    background: "#1a1a2e", border: "1px solid #333", borderRadius: 6,
    color: "#e8e8f0", padding: "6px 10px", fontSize: 13, outline: "none",
  };

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNowLoading(true);
    setError(null);
    setResult(null);
    setNowResult(null);
    try {
      const [r, nr] = await Promise.all([
        apiFetch(`/api/v1/timing/best-time/${encodeURIComponent(backend)}`),
        apiFetch(`/api/v1/timing/best-time/${encodeURIComponent(backend)}/now`),
      ]);
      setResult(r);
      setNowResult(nr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
      setNowLoading(false);
    }
  }

  return (
    <div>
      <p style={{ color: "#8888aa", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Mines historical run data to find when your backend performs best.
        Timing patterns reveal hardware maintenance windows and optimal run slots.
      </p>
      <form onSubmit={handleAnalyze} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "#8888aa", display: "block", marginBottom: 3 }}>Backend</label>
          <input style={{ ...inputStyle, width: "100%" }} value={backend}
            onChange={e => setBackend(e.target.value)} required />
        </div>
        <button type="submit" disabled={loading} style={{
          background: loading ? "#333" : "#0f7b4c", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        }}>
          <Clock size={14} />
          {loading ? "Analyzing…" : "Analyze Timing"}
        </button>
      </form>

      {error && (
        <div style={{ background: "#2a1515", border: "1px solid #c0392b",
          borderRadius: 8, padding: "10px 14px", color: "#e74c3c", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* Run Now? */}
      {nowResult && (
        <div style={{
          background: nowResult.should_run_now ? "#0d2a1d" : "#2a0d0d",
          border: `1px solid ${nowResult.should_run_now ? "#27ae60" : "#e74c3c"}`,
          borderRadius: 10, padding: 14, marginBottom: 14,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          {nowResult.should_run_now
            ? <CheckCircle size={20} color="#27ae60" style={{ flexShrink: 0, marginTop: 1 }} />
            : <AlertTriangle size={20} color="#e74c3c" style={{ flexShrink: 0, marginTop: 1 }} />
          }
          <div>
            <div style={{ fontWeight: 700, fontSize: 14,
              color: nowResult.should_run_now ? "#27ae60" : "#e74c3c", marginBottom: 4 }}>
              {nowResult.should_run_now ? "Good time to run now" : "Consider waiting"}
            </div>
            <div style={{ fontSize: 13, color: "#ccc", marginBottom: 4 }}>{nowResult.recommendation}</div>
            {!nowResult.should_run_now && (
              <div style={{ fontSize: 12, color: "#888" }}>
                Next good window: {nowResult.next_good_window}
              </div>
            )}
            {nowResult.current_slot_avg_health !== null && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                Current slot avg health: {nowResult.current_slot_avg_health.toFixed(1)}
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Best / Worst times */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "#1e1e35", border: "1px solid #333", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#27ae60", marginBottom: 10,
                display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={14} /> Best Times
              </div>
              {result.best_times.length === 0 && (
                <div style={{ color: "#666", fontSize: 12 }}>No data available</div>
              )}
              {result.best_times.map((t, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: "#ccc" }}>
                      {t.day} {String(t.hour_utc).padStart(2, "0")}:00 UTC
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: healthColor(t.avg_health) }}>
                      {t.avg_health.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "#333", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${t.avg_health}%`,
                      background: healthColor(t.avg_health), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{t.n_runs} runs</div>
                </div>
              ))}
            </div>
            <div style={{ background: "#1e1e35", border: "1px solid #333", borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e74c3c", marginBottom: 10,
                display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingDown size={14} /> Worst Times
              </div>
              {result.worst_times.length === 0 && (
                <div style={{ color: "#666", fontSize: 12 }}>No data available</div>
              )}
              {result.worst_times.map((t, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: "#ccc" }}>
                      {t.day} {String(t.hour_utc).padStart(2, "0")}:00 UTC
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: healthColor(t.avg_health) }}>
                      {t.avg_health.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "#333", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${t.avg_health}%`,
                      background: healthColor(t.avg_health), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{t.n_runs} runs</div>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly heatmap */}
          <div style={{ background: "#1e1e35", border: "1px solid #333", borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#aaa", marginBottom: 10,
              display: "flex", alignItems: "center", gap: 6 }}>
              <Activity size={14} /> Weekly Heatmap (UTC hours)
            </div>
            <HeatmapGrid heatmap={result.heatmap} />
            <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>{result.timezone_note}</div>
          </div>

          {/* Recommendation */}
          <div style={{ background: "#1a1a2e", border: "1px solid #444", borderRadius: 8,
            padding: "12px 14px", fontSize: 13, color: "#bbb", lineHeight: 1.6 }}>
            {result.recommendation}
            <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
              Analysis based on {result.analysis_runs} runs with recorded health scores.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Shot Calculator
// ---------------------------------------------------------------------------
interface ShotResult {
  mode: string;
  recommended_shots: number;
  minimum_shots: number;
  generous_shots: number;
  formula_used: string;
  interpretation: string;
  shot_noise_at_recommended: number;
  readout_error_adjustment: number;
  comparison: Record<string, { margin: number; confidence: number }>;
  cost_estimate: { ibm_shots_cost_usd: number; ionq_credit_cost: number };
  error?: string;
}

function ShotCalculator() {
  const [mode, setMode] = useState("estimate_probability");
  const [expectedProb, setExpectedProb] = useState(0.5);
  const [marginOfError, setMarginOfError] = useState(0.05);
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [baselineProb, setBaselineProb] = useState(0.5);
  const [expectedChange, setExpectedChange] = useState(0.1);
  const [statPower, setStatPower] = useState(0.80);
  const [nQubits, setNQubits] = useState(3);
  const [energyPrec, setEnergyPrec] = useState(1.0);
  const [nTerms, setNTerms] = useState(50);
  const [readoutError, setReadoutError] = useState(0.02);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ShotResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    background: "#1a1a2e", border: "1px solid #333", borderRadius: 6,
    color: "#e8e8f0", padding: "6px 10px", fontSize: 13, width: "100%", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: "#8888aa", fontWeight: 500, marginBottom: 3, display: "block",
  };

  async function handleCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        mode,
        readout_error: readoutError,
      };
      if (mode === "estimate_probability") {
        body.expected_probability = expectedProb;
        body.margin_of_error = marginOfError;
        body.confidence_level = confidenceLevel;
      } else if (mode === "detect_change") {
        body.baseline_probability = baselineProb;
        body.expected_change = expectedChange;
        body.confidence_level = confidenceLevel;
        body.statistical_power = statPower;
      } else if (mode === "tomography") {
        body.n_qubits = nQubits;
        body.confidence_level = confidenceLevel;
      } else if (mode === "vqe_energy") {
        body.energy_precision_mhartree = energyPrec;
        body.n_terms_hamiltonian = nTerms;
        body.confidence_level = confidenceLevel;
      }
      const r = await apiFetch("/api/v1/shots/calculate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setLoading(false);
    }
  }

  const MODES = [
    { value: "estimate_probability", label: "Estimate Probability" },
    { value: "detect_change", label: "Detect Change" },
    { value: "tomography", label: "State Tomography" },
    { value: "vqe_energy", label: "VQE Energy" },
  ];

  return (
    <div>
      <p style={{ color: "#8888aa", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Statistical power calculator. Computes the minimum shots needed to achieve
        your desired precision, based on the measurement mode and error rates.
      </p>
      <form onSubmit={handleCalculate}>
        {/* Mode selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              style={{
                padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: `1px solid ${mode === m.value ? "#5b4fcf" : "#333"}`,
                background: mode === m.value ? "#5b4fcf22" : "#1a1a2e",
                color: mode === m.value ? "#a090ff" : "#888",
                cursor: "pointer",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Conditional fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          {(mode === "estimate_probability") && (
            <>
              <div>
                <label style={labelStyle}>Expected Probability</label>
                <input style={inputStyle} type="number" step="0.01" min={0} max={1} value={expectedProb}
                  onChange={e => setExpectedProb(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Margin of Error (±)</label>
                <input style={inputStyle} type="number" step="0.01" min={0.001} max={0.5} value={marginOfError}
                  onChange={e => setMarginOfError(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Confidence Level</label>
                <select style={inputStyle} value={confidenceLevel} onChange={e => setConfidenceLevel(+e.target.value)}>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                  <option value={0.999}>99.9%</option>
                </select>
              </div>
            </>
          )}

          {mode === "detect_change" && (
            <>
              <div>
                <label style={labelStyle}>Baseline Probability</label>
                <input style={inputStyle} type="number" step="0.01" min={0} max={1} value={baselineProb}
                  onChange={e => setBaselineProb(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Expected Change</label>
                <input style={inputStyle} type="number" step="0.01" min={0.001} value={expectedChange}
                  onChange={e => setExpectedChange(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Confidence Level</label>
                <select style={inputStyle} value={confidenceLevel} onChange={e => setConfidenceLevel(+e.target.value)}>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Statistical Power</label>
                <select style={inputStyle} value={statPower} onChange={e => setStatPower(+e.target.value)}>
                  <option value={0.80}>80% (standard)</option>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                </select>
              </div>
            </>
          )}

          {mode === "tomography" && (
            <>
              <div>
                <label style={labelStyle}>N Qubits (1–12)</label>
                <input style={inputStyle} type="number" min={1} max={12} value={nQubits}
                  onChange={e => setNQubits(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Confidence Level</label>
                <select style={inputStyle} value={confidenceLevel} onChange={e => setConfidenceLevel(+e.target.value)}>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                </select>
              </div>
            </>
          )}

          {mode === "vqe_energy" && (
            <>
              <div>
                <label style={labelStyle}>Energy Precision (mHartree)</label>
                <input style={inputStyle} type="number" step="0.1" min={0.01} value={energyPrec}
                  onChange={e => setEnergyPrec(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>N Pauli Terms in Hamiltonian</label>
                <input style={inputStyle} type="number" min={1} value={nTerms}
                  onChange={e => setNTerms(+e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Confidence Level</label>
                <select style={inputStyle} value={confidenceLevel} onChange={e => setConfidenceLevel(+e.target.value)}>
                  <option value={0.90}>90%</option>
                  <option value={0.95}>95%</option>
                  <option value={0.99}>99%</option>
                </select>
              </div>
            </>
          )}

          {/* Readout error always shown */}
          <div>
            <label style={labelStyle}>Readout Error</label>
            <input style={inputStyle} type="number" step="0.001" min={0} max={1} value={readoutError}
              onChange={e => setReadoutError(+e.target.value)} />
          </div>
        </div>

        <button type="submit" disabled={loading} style={{
          background: loading ? "#333" : "#1a6b9a", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Calculator size={15} />
          {loading ? "Calculating…" : "Calculate Shots"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 14, background: "#2a1515", border: "1px solid #c0392b",
          borderRadius: 8, padding: "10px 14px", color: "#e74c3c", fontSize: 13 }}>
          {error}
        </div>
      )}

      {result && !result.error && (
        <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
          {/* Big shot count */}
          <div style={{ background: "#1e1e35", border: "1px solid #5b4fcf66", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#8888aa", marginBottom: 4 }}>RECOMMENDED</div>
                <div style={{ fontSize: 44, fontWeight: 900, color: "#a090ff", lineHeight: 1 }}>
                  {result.recommended_shots.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>shots</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6, marginBottom: 8 }}>
                  {result.interpretation}
                </div>
                <div style={{ fontSize: 11, color: "#666" }}>Formula: {result.formula_used}</div>
                <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    Minimum: <strong style={{ color: "#ccc" }}>{result.minimum_shots.toLocaleString()}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    Generous: <strong style={{ color: "#ccc" }}>{result.generous_shots.toLocaleString()}</strong>
                  </div>
                  {result.readout_error_adjustment !== result.recommended_shots && (
                    <div style={{ fontSize: 12, color: "#f39c12" }}>
                      Readout-adjusted: <strong>{result.readout_error_adjustment.toLocaleString()}</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Comparison table */}
          <div style={{ background: "#1e1e35", border: "1px solid #333", borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#aaa", marginBottom: 10,
              display: "flex", alignItems: "center", gap: 6 }}>
              <Target size={14} /> Shot Count Comparison
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: "#666", fontWeight: 500 }}>Shots</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: "#666", fontWeight: 500 }}>Margin of Error</th>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: "#666", fontWeight: 500 }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.comparison).map(([shots, stats]) => (
                  <tr key={shots} style={{ borderBottom: "1px solid #222" }}>
                    <td style={{ padding: "6px 10px", color: "#ccc" }}>{parseInt(shots).toLocaleString()}</td>
                    <td style={{ padding: "6px 10px", color: "#a090ff" }}>±{(stats.margin * 100).toFixed(2)}%</td>
                    <td style={{ padding: "6px 10px", color: "#27ae60" }}>{(stats.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cost estimate */}
          <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8,
            padding: 12, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Zap size={14} color="#f39c12" />
              <span style={{ fontSize: 12, color: "#888" }}>Cost Estimates</span>
            </div>
            <div style={{ fontSize: 13, color: "#ccc" }}>
              IBM: <strong style={{ color: "#f39c12" }}>${result.cost_estimate.ibm_shots_cost_usd.toFixed(4)}</strong>
            </div>
            <div style={{ fontSize: 13, color: "#ccc" }}>
              IonQ: <strong style={{ color: "#f39c12" }}>{result.cost_estimate.ionq_credit_cost.toFixed(4)} credits</strong>
            </div>
            <div style={{ fontSize: 11, color: "#555" }}>
              Shot noise at {result.recommended_shots.toLocaleString()} shots: σ={result.shot_noise_at_recommended}
            </div>
          </div>
        </div>
      )}

      {result?.error && (
        <div style={{ marginTop: 14, background: "#2a1515", border: "1px solid #c0392b",
          borderRadius: 8, padding: "10px 14px", color: "#e74c3c", fontSize: 13 }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const TABS = [
  { id: "predict", label: "Outcome Predictor", icon: Brain },
  { id: "timing", label: "Timing Advisor", icon: Clock },
  { id: "shots", label: "Shot Calculator", icon: Calculator },
];

export default function PredictPage() {
  const [activeTab, setActiveTab] = useState("predict");

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, color: "#e8e8f0" }}>
            <Brain size={17} color="#a090ff" /> Pre-Run Intelligence
          </h2>
          <span style={{ fontSize: 12, color: "#888" }}>
            Know what will happen before spending QPU credits
          </span>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #2a2a3e",
          padding: "0 18px", background: "#13131f" }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "11px 20px", border: "none", background: "none",
                  borderBottom: active ? "2px solid #5b4fcf" : "2px solid transparent",
                  color: active ? "#a090ff" : "#666",
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
                  transition: "color 0.15s",
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ padding: "20px 20px" }}>
          {activeTab === "predict" && <OutcomePredictor />}
          {activeTab === "timing" && <TimingAdvisor />}
          {activeTab === "shots" && <ShotCalculator />}
        </div>
      </section>
    </main>
  );
}
