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
    (name === "SyntaxError" && msg.includes("Unexpected token")) ||
    (name === "TypeError" && msg.includes("Failed to fetch")) ||
    msg.includes("ChunkLoadError")
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkError(error)) {
      window.location.reload();
    }
  }, [error]);

  if (isChunkError(error)) {
    return <html><body style={{ background: "#0f0e17" }} /></html>;
  }

  return (
    <html>
      <body style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", flexDirection: "column", gap: 16, padding: 24,
        background: "#0f0e17", color: "#e2e8f0", fontFamily: "system-ui,sans-serif",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>⚠️</div>
        <p style={{ fontSize: 17, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Something went wrong</p>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
          The app hit an unexpected error outside any page boundary.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={reset}
            style={{ padding: "9px 22px", background: "#6366f1", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, color: "#fff", fontWeight: 600 }}
          >
            Try again
          </button>
          <a href="/runs" style={{ padding: "9px 22px", background: "transparent", border: "1px solid #334155", borderRadius: 6, cursor: "pointer", fontSize: 14, color: "#94a3b8", textDecoration: "none" }}>
            ← Runs
          </a>
        </div>
      </body>
    </html>
  );
}
