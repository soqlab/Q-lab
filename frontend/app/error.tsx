"use client";

import { useEffect } from "react";

function isChunkError(error: Error): boolean {
  const msg = error.message ?? "";
  const name = error.name ?? "";
  return (
    name === "ChunkLoadError" ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    // When a chunk 404s the browser tries to parse HTML as JS
    (name === "SyntaxError" && msg.includes("Unexpected token")) ||
    // Network failure fetching a chunk
    (name === "TypeError" && msg.includes("Failed to fetch")) ||
    msg.includes("Cannot find module") ||
    msg.includes("ChunkLoadError")
  );
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkError(error)) {
      // New deployment — chunks changed. Reload to get fresh assets.
      window.location.reload();
    }
  }, [error]);

  // Don't render anything visible while we're about to reload
  if (isChunkError(error)) return null;

  return (
    <main style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "70vh", padding: 24,
    }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        {/* Robot */}
        <svg width="120" height="136" viewBox="0 0 120 136" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ marginBottom: 8, opacity: 0.9 }}>
          <style>{`
            @keyframes bob2 { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
            @keyframes blink2 { 0%,88%,100%{transform:scaleY(1)} 94%{transform:scaleY(0.08)} }
            .rb { animation: bob2 2.8s ease-in-out infinite; transform-origin: bottom center; }
            .re { animation: blink2 3s ease-in-out infinite; transform-origin: center; }
          `}</style>
          <ellipse cx="60" cy="132" rx="28" ry="4" fill="rgba(99,102,241,0.12)"/>
          <g className="rb">
            <line x1="60" y1="16" x2="60" y2="7" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="60" cy="5" r="4" fill="#f59e0b"/>
            <rect x="32" y="16" width="56" height="44" rx="11" fill="#1e293b" stroke="#6366f1" strokeWidth="2"/>
            <g className="re">
              <rect x="40" y="27" width="14" height="12" rx="3" fill="#6366f1"/>
              <rect x="66" y="27" width="14" height="12" rx="3" fill="#6366f1"/>
            </g>
            <circle cx="47" cy="33" r="3" fill="#e0e7ff"/>
            <circle cx="73" cy="33" r="3" fill="#e0e7ff"/>
            <path d="M44 50 Q60 44 76 50" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <rect x="28" y="64" width="64" height="48" rx="10" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
            <rect x="38" y="72" width="44" height="28" rx="6" fill="#0f172a" stroke="#6366f1" strokeWidth="1.2"/>
            <text x="60" y="84" textAnchor="middle" fill="#ef4444" fontSize="7.5" fontFamily="ui-monospace,monospace" fontWeight="700">OOPS!</text>
            <text x="60" y="95" textAnchor="middle" fill="#ef4444" fontSize="7.5" fontFamily="ui-monospace,monospace" fontWeight="700">ERR_500</text>
            <circle cx="60" cy="104" r="2.5" fill="#ef4444" opacity="0.8"/>
            <rect x="40" y="110" width="16" height="17" rx="5" fill="#1e293b" stroke="#334155" strokeWidth="1.2"/>
            <rect x="64" y="110" width="16" height="17" rx="5" fill="#1e293b" stroke="#334155" strokeWidth="1.2"/>
            <rect x="12" y="66" width="15" height="36" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.2"/>
            <rect x="93" y="66" width="15" height="36" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.2"/>
          </g>
        </svg>

        <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", margin: "0 0 8px" }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.65, margin: "0 0 24px" }}>
          This page hit an unexpected error. If it keeps happening, let us know via the feedback page.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={reset}
            className="button"
          >
            Try again
          </button>
          <a href="/runs" className="button secondary" style={{ textDecoration: "none" }}>
            ← Back to runs
          </a>
        </div>
      </div>
    </main>
  );
}
