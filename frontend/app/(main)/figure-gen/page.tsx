"use client";

import { useState } from "react";
import { FigureGenResult, generateFigure } from "../../../lib/api";
import { FileImage, Play, Download, FileText } from "lucide-react";

const FIGURE_TYPES = [
  { id: "circuit_diagram", label: "Circuit Diagram" },
  { id: "energy_landscape", label: "Energy Landscape" },
  { id: "probability_histogram", label: "Probability Histogram" },
  { id: "convergence_plot", label: "Convergence Plot" },
  { id: "bloch_sphere", label: "Bloch Sphere" },
  { id: "density_matrix_heatmap", label: "Density Matrix" },
];

const STYLES = [
  { id: "nature", label: "Nature" },
  { id: "science", label: "Science" },
  { id: "arxiv", label: "arXiv" },
];

export default function FigureGenPage() {
  const [figureType, setFigureType] = useState("probability_histogram");
  const [style, setStyle] = useState("nature");
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [qasm, setQasm] = useState(
    'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'
  );
  const [result, setResult] = useState<FigureGenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await generateFigure({ figure_type: figureType, style, qasm, width, height });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([result.svg_content], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "figure.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.75rem" }}>
          <FileImage size={28} color="#3b82f6" />
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              Publication Figure Generator
            </h1>
            <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.9rem" }}>
              Generate journal-ready figures from quantum circuit data
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
                Figure Type
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {FIGURE_TYPES.map((ft) => (
                  <button
                    key={ft.id}
                    onClick={() => setFigureType(ft.id)}
                    style={{
                      width: "calc(50% - 0.25rem)",
                      border: "none",
                      borderRadius: 8,
                      padding: "0.5rem 0.4rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      background: figureType === ft.id ? "#3b82f6" : "#0f172a",
                      color: figureType === ft.id ? "#fff" : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
                Journal Style
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    style={{
                      flex: 1,
                      border: "none",
                      borderRadius: 8,
                      padding: "0.5rem",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      background: style === s.id ? "#8b5cf6" : "#0f172a",
                      color: style === s.id ? "#fff" : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Width: {width}px
              </label>
              <input
                type="range"
                min={400}
                max={1200}
                step={100}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#3b82f6" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Height: {height}px
              </label>
              <input
                type="range"
                min={300}
                max={900}
                step={100}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                style={{ width: "100%", marginTop: "0.5rem", accentColor: "#3b82f6" }}
              />
            </div>

            <div>
              <label style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.5rem" }}>
                Input QASM (for circuit-based figures)
              </label>
              <textarea
                rows={6}
                value={qasm}
                onChange={(e) => setQasm(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#e2e8f0",
                  padding: "0.6rem",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 8,
                padding: "0.7rem",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 700,
                background: loading ? "#1e3a5f" : "#3b82f6",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                fontSize: "0.9rem",
              }}
            >
              <Play size={16} />
              {loading ? "Generating..." : "Generate Figure"}
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
                <FileImage size={48} color="#334155" />
                <p style={{ margin: 0, fontSize: "0.95rem" }}>Configure options and click Generate Figure</p>
              </div>
            ) : (
              <>
                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <span style={{ fontWeight: 700, color: "#e2e8f0" }}>
                      SVG Preview — {result.figure_type} / {result.style}
                    </span>
                    <button
                      onClick={handleDownload}
                      style={{
                        border: "none",
                        borderRadius: 8,
                        padding: "0.5rem 1rem",
                        cursor: "pointer",
                        fontWeight: 700,
                        background: "#10b981",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        fontSize: "0.85rem",
                      }}
                    >
                      <Download size={14} />
                      Download SVG
                    </button>
                  </div>
                  <div
                    dangerouslySetInnerHTML={{ __html: result.svg_content }}
                    style={{ background: "white", padding: "1rem", borderRadius: 8, maxWidth: "100%", overflow: "auto" }}
                  />
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <FileText size={16} color="#f59e0b" />
                    <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>LaTeX Caption</span>
                  </div>
                  <code
                    style={{
                      display: "block",
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "0.75rem",
                      color: "#94a3b8",
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {result.latex_caption}
                  </code>
                </div>

                <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <FileText size={16} color="#8b5cf6" />
                    <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>BibTeX Placeholder</span>
                  </div>
                  <pre
                    style={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "0.75rem",
                      color: "#94a3b8",
                      fontSize: "0.8rem",
                      fontFamily: "monospace",
                      overflow: "auto",
                      maxHeight: 200,
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {result.bibtex_placeholder}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
