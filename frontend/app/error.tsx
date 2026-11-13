"use client";

import Link from "next/link";
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
        <div className="inst-label" style={{ marginBottom: 8 }}>Error</div>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.65, margin: "0 0 24px" }}>
          This page hit an unexpected error. If it keeps happening, let us know via the feedback page.
        </p>
        {(error.message || error.digest) && (
          <pre style={{
            fontSize: 11, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 6, padding: "8px 10px", margin: "0 0 20px", textAlign: "left",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {error.message}{error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={reset}
            className="button"
          >
            Try again
          </button>
          <Link href="/runs" className="button secondary" style={{ textDecoration: "none" }}>
            ← Back to runs
          </Link>
        </div>
      </div>
    </main>
  );
}
