"use client";

type CircuitStats = {
  num_qubits?: number;
  depth?: number;
  size?: number;
  gate_counts?: Record<string, number>;
};

type TranspilerData = {
  settings?: {
    optimization_level?: number;
    routing_method?: string;
    layout_method?: string;
    basis_gates?: string[];
    seed_transpiler?: number;
    approximation_degree?: number;
  };
  before?: CircuitStats;
  after?: CircuitStats;
  duration_ms?: number;
  start_time?: string;
  end_time?: string;
};

function overhead(before?: number, after?: number): { label: string; worse: boolean } | null {
  if (before === undefined || after === undefined || before === 0) return null;
  const delta = ((after - before) / before) * 100;
  const sign = delta > 0 ? "+" : "";
  return { label: `${sign}${delta.toFixed(0)}%`, worse: delta > 0 };
}

function ChangeBadge({ before, after }: { before?: number; after?: number }) {
  const result = overhead(before, after);
  if (!result) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
      background: result.worse ? "var(--danger-bg)" : "var(--ok-bg)",
      color: result.worse ? "var(--danger-text)" : "var(--ok-text)",
      whiteSpace: "nowrap",
    }}>
      {result.label}
    </span>
  );
}

function DepthBar({ label, value, max, worse }: { label: string; value: number; max: number; worse: boolean }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", width: 56, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: worse ? "var(--warn)" : "var(--ok)",
          borderRadius: 4, transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 12, width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text)", fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

export default function TranspilerPanel({ transpiler }: { transpiler: Record<string, unknown> }) {
  const data = transpiler as TranspilerData;
  const { settings = {}, before, after, duration_ms } = data;
  const hasBeforeAfter = !!(before && after && Object.keys(before).length > 0 && Object.keys(after).length > 0);
  const hasSettings = Object.keys(settings).length > 0;

  const maxDepth = Math.max(before?.depth ?? 0, after?.depth ?? 0);
  const maxGates = Math.max(before?.size ?? 0, after?.size ?? 0);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Transpilation Report</h2>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {duration_ms !== undefined && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {duration_ms < 1000 ? `${duration_ms} ms` : `${(duration_ms / 1000).toFixed(2)} s`}
            </span>
          )}
        </div>
      </div>

      {/* Settings badges */}
      {hasSettings && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
          {settings.optimization_level !== undefined && (
            <span style={{ background: "var(--info-bg)", color: "var(--info-text)", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>
              Optimization O{settings.optimization_level}
            </span>
          )}
          {settings.routing_method && (
            <span style={{ background: "var(--panel-2)", color: "var(--text)", fontSize: 12, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
              routing: <strong>{settings.routing_method}</strong>
            </span>
          )}
          {settings.layout_method && (
            <span style={{ background: "var(--panel-2)", color: "var(--text)", fontSize: 12, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
              layout: <strong>{settings.layout_method}</strong>
            </span>
          )}
          {settings.basis_gates && settings.basis_gates.length > 0 && (
            <span style={{ background: "var(--panel-2)", color: "var(--muted)", fontSize: 12, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
              basis: {settings.basis_gates.join(", ")}
            </span>
          )}
          {settings.seed_transpiler !== undefined && (
            <span style={{ background: "var(--panel-2)", color: "var(--muted)", fontSize: 12, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--line)" }}>
              seed: {settings.seed_transpiler}
            </span>
          )}
        </div>
      )}

      {hasBeforeAfter ? (
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Before / After comparison table */}
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Circuit Overhead
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Metric", "Before", "After", "Change"].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i === 0 ? "left" : "right",
                      color: "var(--muted)", fontWeight: 600,
                      padding: "6px 8px 10px", borderBottom: "2px solid var(--line)",
                      fontSize: 12,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  { label: "Circuit Depth", key: "depth" as const },
                  { label: "Total Gates", key: "size" as const },
                  { label: "Qubit Count", key: "num_qubits" as const },
                ] as { label: string; key: "depth" | "size" | "num_qubits" }[]).map(({ label, key }) => (
                  <tr key={label}>
                    <td style={{ padding: "8px", borderBottom: "1px solid var(--line)", color: "var(--text)" }}>{label}</td>
                    <td style={{ padding: "8px", borderBottom: "1px solid var(--line)", textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      {before?.[key] ?? "—"}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid var(--line)", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                      {after?.[key] ?? "—"}
                    </td>
                    <td style={{ padding: "8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>
                      <ChangeBadge before={before?.[key]} after={after?.[key]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Depth bar chart */}
          {before?.depth !== undefined && after?.depth !== undefined && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Depth Comparison
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <DepthBar label="Before" value={before.depth} max={maxDepth} worse={false} />
                <DepthBar label="After" value={after.depth} max={maxDepth} worse={(after.depth ?? 0) > (before.depth ?? 0)} />
              </div>
              {before.size !== undefined && after.size !== undefined && (
                <>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 10 }}>
                    Gate Count Comparison
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <DepthBar label="Before" value={before.size} max={maxGates} worse={false} />
                    <DepthBar label="After" value={after.size} max={maxGates} worse={(after.size ?? 0) > (before.size ?? 0)} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Native gate set after transpilation */}
          {after?.gate_counts && Object.keys(after.gate_counts).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Native Gate Set (Post-Transpile)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(after.gate_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([gate, count]) => (
                    <span key={gate} style={{
                      background: "var(--panel-2)", border: "1px solid var(--line)",
                      fontSize: 12, padding: "4px 10px", borderRadius: 6,
                      color: "var(--text)", fontFamily: "monospace",
                    }}>
                      {gate} <span style={{ color: "var(--muted)", fontSize: 11 }}>×{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Before gate set if different */}
          {before?.gate_counts && Object.keys(before.gate_counts).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Logical Gate Set (Pre-Transpile)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(before.gate_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([gate, count]) => (
                    <span key={gate} style={{
                      background: "var(--code-bg, var(--panel-2))", border: "1px solid var(--line)",
                      fontSize: 12, padding: "4px 10px", borderRadius: 6,
                      color: "var(--muted)", fontFamily: "monospace",
                    }}>
                      {gate} <span style={{ fontSize: 11 }}>×{count}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        hasSettings && (
          <p style={{ padding: "12px 18px 16px", fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Before/after statistics not captured. Use Q-Lab SDK ≥ 0.3 to track transpilation overhead automatically.
          </p>
        )
      )}

      {!hasSettings && !hasBeforeAfter && (
        <p style={{ padding: "12px 18px 16px", fontSize: 13, color: "var(--muted)", margin: 0 }}>
          No transpiler data available for this run.
        </p>
      )}
    </section>
  );
}
