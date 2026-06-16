"use client";

import { QLabRun } from "../../../../lib/api";

// ------------------------------------------------------------------
// Gate categorisation
// ------------------------------------------------------------------
const CATEGORIES: { label: string; color: string; gates: string[] }[] = [
  { label: "2Q Entangling",   color: "#6366f1", gates: ["cx","cz","cy","ecr","rzx","swap","dcx","iswap","cs","csx","cp","cu","cu1","cu3","ccx","cswap"] },
  { label: "Non-Clifford",    color: "#f59e0b", gates: ["t","tdg","s","sdg","p","rz","rx","ry","u","u1","u2","u3","r","phaseshift","rxx","ryy","rzz","rzx"] },
  { label: "Clifford 1Q",     color: "#10b981", gates: ["h","x","y","z","sx","sxdg","id","reset"] },
  { label: "Measurement",     color: "#3b82f6", gates: ["measure","barrier"] },
];

function categorise(gate: string): { label: string; color: string } {
  const g = gate.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.gates.includes(g)) return cat;
  }
  return { label: "Other", color: "#6b7280" };
}

// ------------------------------------------------------------------
// Depth contribution bar chart (horizontal stacked)
// ------------------------------------------------------------------
export default function GateFlameChart({ run }: { run: QLabRun }) {
  const gc = run.fingerprint.gate_counts ?? {};
  if (!Object.keys(gc).length) return null;

  // Build category totals
  const catMap: Record<string, { count: number; color: string; gates: string[] }> = {};
  let total = 0;
  for (const [gate, count] of Object.entries(gc)) {
    if (gate === "measure" && !catMap["Measurement"]) { catMap["Measurement"] = { count: 0, color: "#3b82f6", gates: [] }; }
    const cat = categorise(gate);
    if (!catMap[cat.label]) catMap[cat.label] = { count: 0, color: cat.color, gates: [] };
    catMap[cat.label].count += count;
    catMap[cat.label].gates.push(`${gate}×${count}`);
    total += count;
  }

  const entries = Object.entries(catMap).sort((a, b) => b[1].count - a[1].count);
  const depth = run.fingerprint.depth ?? 0;
  const size = run.fingerprint.size ?? 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Gate Composition</h2>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          {total} gates · depth {depth} · {run.fingerprint.num_qubits ?? 0} qubits
        </span>
      </div>

      <div style={{ padding: "16px 18px" }}>
        {/* Stacked bar */}
        <div style={{ display: "flex", height: 28, borderRadius: 6, overflow: "hidden", marginBottom: 14 }}>
          {entries.map(([label, { count, color }]) => (
            <div
              key={label}
              title={`${label}: ${count} gates (${((count / total) * 100).toFixed(1)}%)`}
              style={{
                width: `${(count / total) * 100}%`,
                background: color,
                transition: "width 0.5s",
              }}
            />
          ))}
        </div>

        {/* Legend + breakdown rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map(([label, { count, color, gates }]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ minWidth: 130, color: "var(--text)", fontWeight: 500 }}>{label}</span>
              {/* Bar */}
              <div style={{ flex: 1, height: 14, background: "var(--panel-2)", borderRadius: 3 }}>
                <div style={{
                  width: `${(count / total) * 100}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 3,
                  opacity: 0.7,
                  transition: "width 0.5s",
                }} />
              </div>
              <span style={{ minWidth: 36, textAlign: "right", color: "var(--text)", fontWeight: 600 }}>{count}</span>
              <span style={{ minWidth: 42, textAlign: "right", color: "var(--muted)" }}>
                {((count / total) * 100).toFixed(1)}%
              </span>
              <span style={{ color: "var(--muted)", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={gates.join(", ")}>
                {gates.slice(0, 4).join(", ")}{gates.length > 4 ? " …" : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Depth / gate ratio */}
        {depth > 0 && size > 0 && (
          <div style={{ marginTop: 14, padding: "8px 10px", background: "var(--panel-2)", borderRadius: 6, display: "flex", gap: 24, fontSize: 12, color: "var(--muted)" }}>
            <span>Depth/Gate ratio: <strong style={{ color: "var(--text)" }}>{(depth / size).toFixed(3)}</strong></span>
            <span>Parallelism: <strong style={{ color: "var(--text)" }}>{(size / Math.max(depth, 1)).toFixed(2)}×</strong></span>
            {run.fingerprint.non_clifford_ratio !== undefined && (
              <span>Non-Clifford: <strong style={{ color: (run.fingerprint.non_clifford_ratio ?? 0) > 0.3 ? "var(--warn)" : "var(--ok)" }}>
                {((run.fingerprint.non_clifford_ratio ?? 0) * 100).toFixed(1)}%
              </strong></span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
