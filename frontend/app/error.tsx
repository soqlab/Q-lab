"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // After a deployment, Next.js chunk hashes change. Old cached pages try to load
    // old chunk files that no longer exist → ChunkLoadError. Auto-reload gets fresh assets.
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
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 16, padding: 24 }}>
      <p style={{ fontSize: 15, color: "var(--muted)" }}>Something went wrong.</p>
      <button
        onClick={reset}
        style={{ padding: "8px 20px", background: "var(--strong)", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}
      >
        Try again
      </button>
    </main>
  );
}
