"use client";
import { useState, useEffect, useRef } from "react";
import { getResearchGraph, addGraphNode, addGraphEdge, ResearchGraph, ResearchGraphNode, ResearchGraphEdge } from "@/lib/api";

const NODE_TYPES = ["run", "hypothesis", "paper", "circuit", "finding", "experiment", "dataset", "method"];
const EDGE_TYPES = ["tests", "confirms", "refutes", "inspired_by", "cites", "uses", "produces", "extends"];

export default function ResearchGraphPage() {
  const [graph, setGraph] = useState<ResearchGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddNode, setShowAddNode] = useState(false);
  const [showAddEdge, setShowAddEdge] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<ResearchGraphNode | null>(null);
  const [nodeType, setNodeType] = useState("run");
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeDesc, setNodeDesc] = useState("");
  const [srcId, setSrcId] = useState("");
  const [tgtId, setTgtId] = useState("");
  const [edgeType, setEdgeType] = useState("tests");
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const g = await getResearchGraph();
      setGraph(g);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function addNode() {
    if (!nodeLabel) return;
    try {
      await addGraphNode({ node_type: nodeType, label: nodeLabel, description: nodeDesc });
      setNodeLabel(""); setNodeDesc(""); setShowAddNode(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function addEdge() {
    if (!srcId || !tgtId) return;
    try {
      await addGraphEdge({ source_id: srcId, target_id: tgtId, edge_type: edgeType });
      setSrcId(""); setTgtId(""); setShowAddEdge(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const WIDTH = 800;
  const HEIGHT = 500;
  const CX = WIDTH / 2;
  const CY = HEIGHT / 2;

  function nodePos(node: ResearchGraphNode) {
    return { x: CX + node.x, y: CY + node.y };
  }

  return (
    <div style={{ padding: 24, maxWidth: 1152, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Research Knowledge Graph</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowAddNode(!showAddNode)}
            style={{ padding: "8px 12px", background: "var(--strong)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>+ Node</button>
          <button onClick={() => setShowAddEdge(!showAddEdge)}
            style={{ padding: "8px 12px", background: "#7c3aed", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>+ Edge</button>
        </div>
      </div>
      <p style={{ color: "var(--muted)" }}>Visualize the connections between hypotheses, runs, papers, circuits, and findings in your research workflow.</p>

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{error}</span>
          <button onClick={() => { setError(""); load(); }}
            style={{ padding: "6px 14px", background: "var(--danger)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            Retry
          </button>
        </div>
      )}

      {showAddNode && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <select value={nodeType} onChange={e => setNodeType(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Label" value={nodeLabel} onChange={e => setNodeLabel(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
          </div>
          <input placeholder="Description" value={nodeDesc} onChange={e => setNodeDesc(e.target.value)}
            style={{ width: "100%", background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addNode} style={{ padding: "8px 16px", background: "rgba(16,185,129,0.8)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>Add</button>
            <button onClick={() => setShowAddNode(false)} style={{ padding: "8px 16px", background: "var(--line)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {showAddEdge && graph && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <select value={srcId} onChange={e => setSrcId(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              <option value="">Source node...</option>
              {(graph.nodes ?? []).map(n => <option key={n.node_id} value={n.node_id}>{n.label}</option>)}
            </select>
            <select value={edgeType} onChange={e => setEdgeType(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={tgtId} onChange={e => setTgtId(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
              <option value="">Target node...</option>
              {(graph.nodes ?? []).map(n => <option key={n.node_id} value={n.node_id}>{n.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addEdge} style={{ padding: "8px 16px", background: "rgba(16,185,129,0.8)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>Add Edge</button>
            <button onClick={() => setShowAddEdge(false)} style={{ padding: "8px 16px", background: "var(--line)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: "var(--muted)" }}>Loading graph...</div>}

      {graph && (
        <div style={{ background: "var(--surface)", borderRadius: 12, overflow: "hidden" }}>
          <svg ref={svgRef} width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: "block", background: "#111" }}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#4b5563" />
              </marker>
            </defs>
            {(graph.edges as ResearchGraphEdge[] ?? []).map(e => {
              const src = (graph.nodes as ResearchGraphNode[] ?? []).find(n => n.node_id === e.source_id);
              const tgt = (graph.nodes as ResearchGraphNode[] ?? []).find(n => n.node_id === e.target_id);
              if (!src || !tgt) return null;
              const sp = nodePos(src);
              const tp = nodePos(tgt);
              return (
                <g key={e.edge_id}>
                  <line x1={sp.x} y1={sp.y} x2={tp.x} y2={tp.y}
                    stroke="#374151" strokeWidth={1.5} markerEnd="url(#arrow)" />
                  <text x={(sp.x + tp.x) / 2} y={(sp.y + tp.y) / 2} fill="#6b7280" fontSize={9} textAnchor="middle">{e.edge_type}</text>
                </g>
              );
            })}
            {(graph.nodes as ResearchGraphNode[] ?? []).map(n => {
              const pos = nodePos(n);
              const r = 18 * n.size;
              return (
                <g key={n.node_id} transform={`translate(${pos.x},${pos.y})`}
                  onMouseEnter={() => setHoveredNode(n)} onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: "pointer" }}>
                  <circle r={r} fill={n.color} fillOpacity={0.85} stroke={hoveredNode?.node_id === n.node_id ? "#fff" : "transparent"} strokeWidth={2} />
                  <text y={r + 12} textAnchor="middle" fill="#d1d5db" fontSize={10}>{n.label.slice(0, 18)}</text>
                  <title>{n.label}: {n.description}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {graph && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {Object.entries(graph.stats.node_types).filter(([, count]) => count > 0).map(([type, count]) => (
            <div key={type} style={{ background: "var(--surface)", borderRadius: 6, padding: 12, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>{type}:</span> <span style={{ fontFamily: "ui-monospace,monospace" }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {hoveredNode && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, marginTop: 4, flexShrink: 0, background: hoveredNode.color }} />
            <div>
              <div style={{ fontWeight: 600 }}>{hoveredNode.label}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{hoveredNode.node_type}</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{hoveredNode.description}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
