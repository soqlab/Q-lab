"use client";

import type { CSSProperties } from "react";

export default function RunLoading() {
  return (
    <main className="page" aria-busy="true">
      {/* Toolbar */}
      <div className="toolbar">
        {[80, 90, 70, 80, 100].map((w, i) => (
          <div key={i} style={{ height: 34, width: w, borderRadius: 7, ...shimmer }} />
        ))}
      </div>

      {/* Metric strip */}
      <div className="summary-grid">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="metric">
            <div style={{ height: 12, width: 60, borderRadius: 4, marginBottom: 8, ...shimmer }} />
            <div style={{ height: 28, width: 48, borderRadius: 6, ...shimmer }} />
          </div>
        ))}
      </div>

      {/* Two panels */}
      {[1, 2, 3].map(i => (
        <div key={i} className="panel">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ height: 16, width: 140, borderRadius: 5, ...shimmer }} />
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2, 3, 4].map(j => (
              <div key={j} style={{ height: 14, borderRadius: 4, width: `${60 + j * 8}%`, ...shimmer }} />
            ))}
          </div>
        </div>
      ))}

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </main>
  );
}

const shimmer: CSSProperties = {
  background: "linear-gradient(90deg, var(--shimmer-a) 25%, var(--shimmer-b) 50%, var(--shimmer-a) 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.4s infinite",
};
