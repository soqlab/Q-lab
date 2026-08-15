"use client";

import Link from "next/link";
import { Atom } from "lucide-react";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      padding: "40px 20px",
      background: "var(--bg, #0f172a)",
      textAlign: "center",
    }}>
      <div style={{ position: "relative", width: 80, height: 80 }}>
        <Atom size={80} style={{ color: "rgba(99,102,241,0.3)", position: "absolute", inset: 0 }} />
        <Atom size={80} style={{ color: "#6366f1", position: "absolute", inset: 0, animation: "spin 8s linear infinite" }} />
      </div>

      <div>
        <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, color: "#6366f1", letterSpacing: "-4px" }}>
          404
        </div>
        <h1 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 700, color: "var(--text, #e2e8f0)" }}>
          Page not found
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--muted, #64748b)", maxWidth: 360 }}>
          The state you&apos;re looking for has collapsed. This qubit doesn&apos;t exist — or it was measured and it isn&apos;t here.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <Link
          href="/runs"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: "#6366f1",
            color: "#fff",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Go to Run History
        </Link>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: "transparent",
            color: "var(--muted, #64748b)",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
            border: "1px solid var(--line, #1e293b)",
          }}
        >
          Home
        </Link>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
