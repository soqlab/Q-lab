"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const isChunkError =
      error.name === "ChunkLoadError" ||
      error.message.includes("Loading chunk") ||
      error.message.includes("Loading CSS chunk") ||
      error.message.includes("Failed to fetch dynamically imported module") ||
      error.message.includes("Importing a module script failed");

    if (isChunkError) {
      window.location.reload();
    }
  }, [error]);

  return (
    <html>
      <body style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 16, padding: 24, background: "#0f0e17", color: "#e2e8f0", fontFamily: "system-ui,sans-serif" }}>
        <p style={{ fontSize: 15, color: "#94a3b8" }}>Something went wrong.</p>
        <button
          onClick={reset}
          style={{ padding: "8px 20px", background: "#6366f1", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, color: "#fff" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
