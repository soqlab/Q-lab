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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Research Knowledge Graph</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowAddNode(!showAddNode)}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">+ Node</button>
          <button onClick={() => setShowAddEdge(!showAddEdge)}
            className="px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm">+ Edge</button>
        </div>
      </div>
      <p className="text-gray-400">Visualize the connections between hypotheses, runs, papers, circuits, and findings in your research workflow.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showAddNode && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <select value={nodeType} onChange={e => setNodeType(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {NODE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Label" value={nodeLabel} onChange={e => setNodeLabel(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <input placeholder="Description" value={nodeDesc} onChange={e => setNodeDesc(e.target.value)}
            className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          <div className="flex gap-2">
            <button onClick={addNode} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm">Add</button>
            <button onClick={() => setShowAddNode(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {showAddEdge && graph && (
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <select value={srcId} onChange={e => setSrcId(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              <option value="">Source node...</option>
              {graph.nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.label}</option>)}
            </select>
            <select value={edgeType} onChange={e => setEdgeType(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              {EDGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={tgtId} onChange={e => setTgtId(e.target.value)}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-700">
              <option value="">Target node...</option>
              {graph.nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={addEdge} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm">Add Edge</button>
            <button onClick={() => setShowAddEdge(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-400">Loading graph...</div>}

      {graph && (
        <div className="bg-gray-900 rounded-xl overflow-hidden">
          <svg ref={svgRef} width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block" style={{ background: "#111" }}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#4b5563" />
              </marker>
            </defs>
            {(graph.edges as ResearchGraphEdge[]).map(e => {
              const src = (graph.nodes as ResearchGraphNode[]).find(n => n.node_id === e.source_id);
              const tgt = (graph.nodes as ResearchGraphNode[]).find(n => n.node_id === e.target_id);
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
            {(graph.nodes as ResearchGraphNode[]).map(n => {
              const pos = nodePos(n);
              const r = 18 * n.size;
              return (
                <g key={n.node_id} transform={`translate(${pos.x},${pos.y})`}
                  onMouseEnter={() => setHoveredNode(n)} onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer">
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
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(graph.stats.node_types).filter(([, count]) => count > 0).map(([type, count]) => (
            <div key={type} className="bg-gray-900 rounded p-3 text-sm">
              <span className="text-gray-400">{type}:</span> <span className="font-mono">{count}</span>
            </div>
          ))}
        </div>
      )}

      {hoveredNode && (
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <div className="flex gap-3 items-start">
            <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ background: hoveredNode.color }} />
            <div>
              <div className="font-semibold">{hoveredNode.label}</div>
              <div className="text-xs text-gray-500 mb-1">{hoveredNode.node_type}</div>
              <div className="text-sm text-gray-400">{hoveredNode.description}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
