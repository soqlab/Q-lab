import type { CSSProperties } from "react";

const shimmer: CSSProperties = {
  background: "linear-gradient(90deg, var(--shimmer-a) 25%, var(--shimmer-b) 50%, var(--shimmer-a) 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.4s infinite",
};

export default function Loading() {
  return (
    <main className="page" aria-busy="true" aria-label="Loading">
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Toolbar / heading row */}
        <div style={{ display: "flex", gap: 10 }}>
          {[160, 100, 80, 120].map((w, i) => (
            <div key={i} style={{ height: 36, width: w, borderRadius: 7, flexShrink: 0, ...shimmer }} />
          ))}
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="panel" style={{ padding: "18px 20px" }}>
              <div style={{ height: 30, width: "55%", borderRadius: 6, ...shimmer }} />
              <div style={{ height: 12, width: "80%", borderRadius: 4, marginTop: 10, ...shimmer }} />
            </div>
          ))}
        </div>

        {/* Main content panel */}
        <div className="panel">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ height: 16, width: 180, borderRadius: 5, ...shimmer }} />
          </div>
          <div style={{ padding: "6px 0" }}>
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} style={{ display: "flex", gap: 16, padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ height: 13, flex: 2, borderRadius: 4, ...shimmer }} />
                <div style={{ height: 13, flex: 1, borderRadius: 4, ...shimmer }} />
                <div style={{ height: 13, flex: 1, borderRadius: 4, ...shimmer }} />
                <div style={{ height: 13, width: 56, borderRadius: 4, ...shimmer }} />
                <div style={{ height: 13, width: 44, borderRadius: 4, ...shimmer }} />
              </div>
            ))}
          </div>
        </div>

        {/* Secondary panel */}
        <div className="panel">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ height: 16, width: 130, borderRadius: 5, ...shimmer }} />
          </div>
          <div style={{ padding: "18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[1, 2].map(i => <div key={i} style={{ height: 130, borderRadius: 8, ...shimmer }} />)}
          </div>
        </div>
      </div>
    </main>
  );
}
