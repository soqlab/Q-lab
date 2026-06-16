"use client";

import { useState } from "react";
import { Network } from "lucide-react";

type CalibrationData = Record<string, unknown>;

// ------------------------------------------------------------------
// Parse calibration data into a topology graph
// ------------------------------------------------------------------
type QubitNode = {
  id: number;
  t1?: number;
  t2?: number;
  readout_error?: number;
  x: number;
  y: number;
};

type QubitEdge = {
  a: number;
  b: number;
  gate_error: number;
};

function buildTopology(cal: CalibrationData): { nodes: QubitNode[]; edges: QubitEdge[] } {
  const t1Map = (cal.t1_us ?? {}) as Record<string, number>;
  const t2Map = (cal.t2_us ?? {}) as Record<string, number>;
  const roMap = (cal.readout_errors ?? {}) as Record<string, number>;
  const geMap = (cal.gate_errors ?? {}) as Record<string, number>;

  // Gather all qubit indices
  const qubitSet = new Set<number>();
  for (const k of [...Object.keys(t1Map), ...Object.keys(t2Map), ...Object.keys(roMap)]) {
    const n = parseInt(k);
    if (!isNaN(n)) qubitSet.add(n);
  }

  // Extract 2Q edges from gate_errors keys like "cx_0_1" or "ecr_3_4"
  const edges: QubitEdge[] = [];
  const edgeSet = new Set<string>();
  for (const [k, v] of Object.entries(geMap)) {
    const parts = k.split("_");
    if (parts.length >= 3) {
      const a = parseInt(parts[parts.length - 2]);
      const b = parseInt(parts[parts.length - 1]);
      if (!isNaN(a) && !isNaN(b) && a !== b) {
        qubitSet.add(a);
        qubitSet.add(b);
        const key = `${Math.min(a, b)}_${Math.max(a, b)}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ a, b, gate_error: v });
        }
      }
    }
  }

  if (qubitSet.size === 0) return { nodes: [], edges: [] };

  const ids = [...qubitSet].sort((a, b) => a - b);
  const n = ids.length;

  // Layout: arrange in a grid, snake-pattern like IBM devices
  const cols = Math.min(n, Math.ceil(Math.sqrt(n * 2)));
  const PAD = 28;
  const STEP = 64;

  const posMap = new Map<number, { x: number; y: number }>();
  ids.forEach((id, i) => {
    const row = Math.floor(i / cols);
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    posMap.set(id, {
      x: PAD + col * STEP,
      y: PAD + row * STEP,
    });
  });

  const nodes: QubitNode[] = ids.map(id => ({
    id,
    t1: t1Map[String(id)],
    t2: t2Map[String(id)],
    readout_error: roMap[String(id)],
    ...(posMap.get(id) ?? { x: 0, y: 0 }),
  }));

  return { nodes, edges };
}

// ------------------------------------------------------------------
// Color scale: green (good) → yellow → red (bad)
// For T1/T2: higher = better; for errors: lower = better
// ------------------------------------------------------------------
function t1Color(t1: number | undefined): string {
  if (t1 == null) return "var(--muted)";
  if (t1 >= 200) return "#22c55e";
  if (t1 >= 100) return "#84cc16";
  if (t1 >= 50) return "#f59e0b";
  return "#ef4444";
}

function errColor(err: number | undefined): string {
  if (err == null) return "var(--line)";
  if (err < 0.005) return "#22c55e";
  if (err < 0.01) return "#84cc16";
  if (err < 0.03) return "#f59e0b";
  if (err < 0.08) return "#f97316";
  return "#ef4444";
}

// ------------------------------------------------------------------
// Tooltip
// ------------------------------------------------------------------
function Tooltip({ node }: { node: QubitNode }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6,
      padding: "8px 10px", fontSize: 11, pointerEvents: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: 140,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5 }}>Q{node.id}</div>
      {node.t1 != null && <div>T1: <strong>{node.t1.toFixed(1)} µs</strong></div>}
      {node.t2 != null && <div>T2: <strong>{node.t2.toFixed(1)} µs</strong></div>}
      {node.readout_error != null && <div>Readout err: <strong>{(node.readout_error * 100).toFixed(2)}%</strong></div>}
    </div>
  );
}

// ------------------------------------------------------------------
// Color mode selector
// ------------------------------------------------------------------
type ColorMode = "t1" | "t2" | "readout_error";

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function TopologyPanel({ calibration }: { calibration: CalibrationData }) {
  const [colorMode, setColorMode] = useState<ColorMode>("t1");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const { nodes, edges } = buildTopology(calibration);

  if (nodes.length < 2) return null;

  const maxX = Math.max(...nodes.map(n => n.x)) + 36;
  const maxY = Math.max(...nodes.map(n => n.y)) + 36;

  function getNodeColor(node: QubitNode): string {
    if (colorMode === "t1") return t1Color(node.t1);
    if (colorMode === "t2") return t1Color(node.t2);
    return errColor(node.readout_error);
  }

  const hovered = hoveredId != null ? nodes.find(n => n.id === hoveredId) : null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Network size={16} aria-hidden="true" />
          Qubit Topology
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Colour by:</span>
          {(["t1", "t2", "readout_error"] as ColorMode[]).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setColorMode(mode)}
              style={{
                fontSize: 11, padding: "3px 8px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${colorMode === mode ? "var(--strong)" : "var(--line)"}`,
                background: colorMode === mode ? "var(--strong)" : "transparent",
                color: colorMode === mode ? "#fff" : "var(--muted)",
                fontWeight: colorMode === mode ? 600 : 400,
              }}
            >
              {mode === "t1" ? "T1" : mode === "t2" ? "T2" : "Readout err"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 18px", overflowX: "auto", position: "relative" }}>
        <svg
          width={maxX}
          height={maxY}
          style={{ display: "block" }}
          onMouseLeave={() => { setHoveredId(null); setTooltipPos(null); }}
        >
          {/* Edges */}
          {edges.map((e, i) => {
            const na = nodes.find(n => n.id === e.a);
            const nb = nodes.find(n => n.id === e.b);
            if (!na || !nb) return null;
            const ec = errColor(e.gate_error);
            return (
              <line
                key={i}
                x1={na.x} y1={na.y}
                x2={nb.x} y2={nb.y}
                stroke={ec}
                strokeWidth={e.gate_error > 0.05 ? 4 : e.gate_error > 0.02 ? 3 : 2}
                opacity={0.6}
              >
                <title>Gate error: {(e.gate_error * 100).toFixed(3)}%</title>
              </line>
            );
          })}

          {/* Qubit nodes */}
          {nodes.map(node => {
            const color = getNodeColor(node);
            const isHovered = node.id === hoveredId;
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onMouseEnter={e => {
                  setHoveredId(node.id);
                  const rect = (e.currentTarget as SVGGElement).closest("svg")?.getBoundingClientRect();
                  setTooltipPos(rect ? { x: node.x + 18, y: node.y - 8 } : null);
                }}
                style={{ cursor: "default" }}
              >
                <circle
                  r={isHovered ? 15 : 12}
                  fill={color}
                  stroke={isHovered ? "var(--text)" : "var(--panel)"}
                  strokeWidth={isHovered ? 2 : 1.5}
                  style={{ transition: "r 0.15s, stroke 0.15s" }}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fontWeight={600}
                  fill="#fff"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >
                  {node.id}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating tooltip */}
        {hovered && tooltipPos && (
          <div style={{ position: "absolute", top: tooltipPos.y, left: tooltipPos.x, zIndex: 10, pointerEvents: "none" }}>
            <Tooltip node={hovered} />
          </div>
        )}

        {/* Legend */}
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--muted)" }}>
          {[
            { color: "#22c55e", label: colorMode === "readout_error" ? "<0.5%" : ">200 µs" },
            { color: "#f59e0b", label: colorMode === "readout_error" ? "0.5–3%" : "50–100 µs" },
            { color: "#ef4444", label: colorMode === "readout_error" ? ">8%" : "<50 µs" },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
              {label}
            </span>
          ))}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 20, height: 2, background: "var(--muted)", display: "inline-block" }} />
            Gate error (edge thickness = severity)
          </span>
        </div>
      </div>
    </section>
  );
}
