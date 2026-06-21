"use client";

import { useState, useEffect } from "react";
import { ComplexityResult, ComplexityFit, analyzeComplexity } from "../../../lib/api";
import { BarChart3, Play, TrendingUp, Zap } from "lucide-react";

const PRESETS = [
  { label: "Exponential (2^n)", sizes: "2,4,6,8,10,12", values: "4,16,64,256,1024,4096", param: "n_qubits", metric: "statevector_dim" },
  { label: "Quadratic (n²)", sizes: "10,20,30,40,50,60", values: "100,400,900,1600,2500,3600", param: "n_gates", metric: "circuit_depth" },
  { label: "N log N", sizes: "8,16,32,64,128,256", values: "24,64,160,384,896,2048", param: "n", metric: "ops" },
];

const CLASS_COLORS: Record<string, string> = {
  exponential: "#ef4444",
  polynomial: "#3b82f6",
  linear: "#10b981",
  log: "#8b5cf6",
};

function getClassColor(cls: string): string {
  const lower = cls.toLowerCase();
  for (const key of Object.keys(CLASS_COLORS)) {
    if (lower.includes(key)) return CLASS_COLORS[key];
  }
  return "#94a3b8";
}

export default function ComplexityPage() {
  const [sizesText, setSizesText] = useState("2,4,8,16,32,64");
  const [valuesText, setValuesText] = useState("4,16,64,256,1024,4096");
  const [paramName, setParamName] = useState("n_qubits");
  const [metricName, setMetricName] = useState("circuit_depth");
  const [result, setResult] = useState<ComplexityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function applyPreset(p: typeof PRESETS[0]) {
    setSizesText(p.sizes);
    setValuesText(p.values);
    setParamName(p.param);
    setMetricName(p.metric);
  }

  async function handleAnalyze() {
    setParseError(null);
    setError(null);

    let parsedSizes: number[];
    let parsedValues: number[];
    try {
      parsedSizes = sizesText.split(",").map((s) => {
        const n = Number(s.trim());
        if (isNaN(n)) throw new Error(`Invalid size: "${s.trim()}"`);
        return n;
      });
      parsedValues = valuesText.split(",").map((s) => {
        const n = Number(s.trim());
        if (isNaN(n)) throw new Error(`Invalid value: "${s.trim()}"`);
        return n;
      });
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }

    setLoading(true);
    try {
      const res = await analyzeComplexity({ sizes: parsedSizes, values: parsedValues, param_name: paramName, metric_name: metricName });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void handleAnalyze(); }, []);

  const sortedFits: ComplexityFit[] = result
    ? [...result.all_fits].sort((a, b) => b.r_squared - a.r_squared)
    : [];

  const isExponential = result?.best_fit_class?.toLowerCase().includes("exponential");

  const plotData = result?.scaling_plot_data ?? [];
  const W = 560;
  const H = 200;
  const PAD = 40;

  let yVals = plotData.flatMap((d) => [d.measured, d.fit]).filter((v) => v > 0);
  let xVals = plotData.map((d) => d.n);

  const xMin = xVals.length ? Math.min(...xVals) : 0;
  const xMax = xVals.length ? Math.max(...xVals) : 1;

  let transformY = (v: number) => v;
  let yLabel = metricName;
  if (isExponential) {
    transformY = (v: number) => (v > 0 ? Math.log10(v) : 0);
    yVals = yVals.map(transformY);
    yLabel = "log₁₀(value)";
  }

  const yMin = yVals.length ? Math.min(...yVals) : 0;
  const yMax = yVals.length ? Math.max(...yVals) : 1;
  const yRange = yMax - yMin || 1;
  const xRange = xMax - xMin || 1;

  function px(n: number) {
    return PAD + ((n - xMin) / xRange) * (W - PAD * 2);
  }
  function py(v: number) {
    const tv = isExponential ? transformY(v) : v;
    return H - PAD - ((tv - yMin) / yRange) * (H - PAD * 2);
  }

  const measuredPoints = plotData.map((d) => `${px(d.n)},${py(d.measured)}`).join(" ");
  const fitPoints = plotData.map((d) => `${px(d.n)},${py(d.fit)}`).join(" ");

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <BarChart3 size={28} color="#3b82f6" />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>Complexity Analyzer</h1>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Fit scaling data to complexity classes and visualize growth</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1.5rem" }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Presets</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    style={{ width: "100%", border: "1px solid #334155", borderRadius: 8, padding: "0.5rem 0.75rem", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", background: "#0f172a", color: "#94a3b8", textAlign: "left" }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>Sizes (comma-separated)</div>
              <input
                value={sizesText}
                onChange={(e) => setSizesText(e.target.value)}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", color: "#e2e8f0", fontSize: "0.85rem", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>Values (comma-separated)</div>
              <input
                value={valuesText}
                onChange={(e) => setValuesText(e.target.value)}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", color: "#e2e8f0", fontSize: "0.85rem", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>Parameter Name</div>
              <input
                value={paramName}
                onChange={(e) => setParamName(e.target.value)}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", color: "#e2e8f0", fontSize: "0.85rem", boxSizing: "border-box" }}
              />
            </div>

            <div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>Metric Name</div>
              <input
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.5rem", color: "#e2e8f0", fontSize: "0.85rem", boxSizing: "border-box" }}
              />
            </div>

            <button
              onClick={handleAnalyze}
              disabled={loading}
              style={{ width: "100%", border: "none", borderRadius: 8, padding: "0.7rem", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, background: loading ? "#1e3a5f" : "#3b82f6", color: "#fff", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
            >
              <Play size={16} />
              {loading ? "Analyzing..." : "Analyze Complexity"}
            </button>

            {parseError && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.7rem", fontSize: "0.82rem" }}>{parseError}</div>
            )}
            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.7rem", fontSize: "0.82rem" }}>{error}</div>
            )}
          </div>

          <div>
            {!result ? (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 420, color: "#64748b" }}>
                <TrendingUp size={48} color="#334155" />
                <div style={{ marginTop: "1rem", fontSize: "1rem" }}>Enter scaling data and run analysis to see complexity fit</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{
                  background: "#1e293b",
                  border: `1px solid ${getClassColor(result.best_fit_class)}`,
                  borderRadius: 12,
                  padding: "1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.3rem" }}>Best Fit Class</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color: getClassColor(result.best_fit_class) }}>{result.best_fit_class}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700, marginBottom: "0.3rem" }}>Fit Quality</div>
                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#e2e8f0" }}>R²={result.best_fit_r_squared.toFixed(4)}</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1rem" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center", flex: 1 }}>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f59e0b" }}>n = {result.practical_limit_n}</div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem" }}>Practical Compute Limit</div>
                  </div>
                  {result.predicted_at_100 !== undefined && (
                    <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#3b82f6" }}>{result.predicted_at_100?.toExponential(2)}</div>
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem" }}>Prediction at n=100</div>
                    </div>
                  )}
                  {result.predicted_at_1000 !== undefined && (
                    <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#8b5cf6" }}>{result.predicted_at_1000?.toExponential(2)}</div>
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem" }}>Prediction at n=1000</div>
                    </div>
                  )}
                </div>

                {plotData.length > 0 && (
                  <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                    <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem", display: "flex", gap: "1.5rem" }}>
                      <span><span style={{ color: "#3b82f6" }}>—</span> Measured</span>
                      <span><span style={{ color: "#f59e0b" }}>- -</span> Best Fit</span>
                    </div>
                    <svg width={W} height={H} style={{ overflow: "visible" }}>
                      <text x={PAD} y={H - 8} fill="#64748b" fontSize={11}>{xMin}</text>
                      <text x={W - PAD} y={H - 8} fill="#64748b" fontSize={11} textAnchor="end">{xMax}</text>
                      <text x={8} y={PAD} fill="#64748b" fontSize={10} writingMode="vertical-rl" transform={`rotate(-90,8,${H / 2})`}>{yLabel}</text>
                      {plotData.length > 1 && (
                        <>
                          <polyline points={measuredPoints} fill="none" stroke="#3b82f6" strokeWidth={2} />
                          {plotData.map((d, i) => (
                            <circle key={i} cx={px(d.n)} cy={py(d.measured)} r={3} fill="#3b82f6" />
                          ))}
                          <polyline points={fitPoints} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6,3" />
                        </>
                      )}
                    </svg>
                  </div>
                )}

                <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "1.25rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.75rem" }}>All Complexity Fits</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #334155" }}>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 700 }}>Class</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 700 }}>R²</th>
                        <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#64748b", fontWeight: 700 }}>Formula</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFits.map((fit, i) => {
                        const isWinner = fit.complexity_class === result.best_fit_class;
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid #1e293b", background: isWinner ? "#1e3a5f33" : "transparent" }}>
                            <td style={{ padding: "0.5rem 0.75rem", color: getClassColor(fit.complexity_class), fontWeight: isWinner ? 800 : 500 }}>
                              {fit.complexity_class} {isWinner && "★"}
                            </td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#e2e8f0" }}>{fit.r_squared.toFixed(4)}</td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#a5f3fc", fontFamily: "monospace", fontSize: "0.8rem" }}>{fit.formula}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
