"use client";

import { use, useEffect, useState } from "react";
import { getRunProvenance, getRunBadgeUrl, qlabApiPath } from "../../../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ProvenanceData = {
  provenance_version: string;
  generated_at: string;
  run: {
    run_id: string;
    circuit_name: string | null;
    backend: string | null;
    status: string;
    created_at: string | null;
    qasm: string | null;
    project_slug: string | null;
    tags: string[];
  };
  parameters: Record<string, unknown>;
  execution: Record<string, unknown>;
  calibration: Record<string, unknown>;
  transpiler: Record<string, unknown>;
  timing: Record<string, unknown>;
  results: Record<string, unknown>;
  metrics: { name: string; value: number; step: number | null }[];
  assertions: { label: string | null; type: string; passed: boolean | null; actual: number | null }[];
  reproducibility: {
    instructions: string;
    sdk_snippet: string;
    verification_url: string | null;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function healthScore(prov: ProvenanceData): number | null {
  // Derive a rough score from assertions passed
  const all = prov.assertions;
  if (!all.length) return null;
  const passed = all.filter((a) => a.passed === true).length;
  return Math.round((passed / all.length) * 100);
}

function scoreColor(score: number | null): string {
  if (score === null) return "#6b7280";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function HealthBar({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const color = scoreColor(score);
  const blocks = Math.round(pct / 10);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 16,
              height: 8,
              borderRadius: 2,
              background: i < blocks ? color : "#374151",
            }}
          />
        ))}
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 15 }}>
        {score !== null ? `${score}/100` : "N/A"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: "1px solid #374151",
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "#1f2937",
          border: "none",
          color: "#e5e7eb",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
        }}
        type="button"
      >
        <span>{title}</span>
        <span style={{ color: "#6b7280", fontSize: 18, lineHeight: 1 }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding: "16px", background: "#111827" }}>{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      type="button"
      style={{
        padding: "6px 14px",
        background: copied ? "#22c55e" : "#374151",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        transition: "background .2s",
      }}
    >
      {copied ? "Copied!" : label ?? "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function VerifyPage({ params: paramsPromise }: { params: Promise<{ runId: string }> }) {
  const params = use(paramsPromise);
  const runId = params.runId;
  const [prov, setProv] = useState<ProvenanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRunProvenance(runId)
      .then(setProv)
      .catch((e: Error) => setError(e.message));
  }, [runId]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0d1117",
          color: "#e5e7eb",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, Segoe UI, Arial, sans-serif",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 40 }}>⚠</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Experiment not found</div>
        <div style={{ color: "#6b7280", fontSize: 14 }}>{error}</div>
        <a href="/" style={{ color: "#60a5fa", marginTop: 8 }}>Go to Q-Lab →</a>
      </div>
    );
  }

  if (!prov) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0d1117",
          color: "#6b7280",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, Segoe UI, Arial, sans-serif",
        }}
      >
        Loading provenance…
      </div>
    );
  }

  const score = healthScore(prov);
  const badgeUrl = getRunBadgeUrl(runId);
  const verifyUrl =
    typeof window !== "undefined"
      ? window.location.href
      : `http://localhost:3000/verify/${runId}`;
  const badgeMarkdown = `[![Q-Lab](${window?.location?.origin ?? "http://localhost:3000"}${qlabApiPath(`/api/v1/runs/${runId}/badge.svg`)})](${verifyUrl})`;

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(prov, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `provenance-${runId.slice(0, 12)}.json`;
    a.click();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d1117",
        color: "#e5e7eb",
        fontFamily: "Inter, Segoe UI, Arial, sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "#0f172a",
          borderBottom: "1px solid #1e3a5f",
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>⚛</span>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" }}>
            Q-Lab
          </span>
          <span
            style={{
              background: "#1d4ed8",
              color: "#bfdbfe",
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 12,
            }}
          >
            Provenance Certificate
          </span>
        </div>
        <a
          href="/"
          style={{ color: "#6b7280", fontSize: 13, textDecoration: "none" }}
        >
          Open Q-Lab →
        </a>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
        {/* Certificate card */}
        <div
          style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            border: "1px solid #1e3a5f",
            borderRadius: 16,
            padding: "28px 32px",
            marginBottom: 24,
            boxShadow: "0 4px 32px rgba(0,0,0,.4)",
          }}
        >
          {/* Verified banner */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#052e16",
              color: "#4ade80",
              border: "1px solid #166534",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 20,
            }}
          >
            <span>✓</span> VERIFIED QUANTUM EXPERIMENT
          </div>

          <h1 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 800 }}>
            {prov.run.circuit_name ?? prov.run.run_id}
          </h1>
          <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
            Provenance Certificate · Q-Lab v{prov.provenance_version} ·{" "}
            Generated {new Date(prov.generated_at).toUTCString()}
          </div>

          {/* Key stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {[
              ["Run ID", <code key="rid" style={{ fontSize: 11 }}>{prov.run.run_id.slice(0, 16)}…</code>],
              ["Circuit", prov.run.circuit_name ?? "—"],
              ["Backend", prov.run.backend ?? "—"],
              ["Project", prov.run.project_slug ?? "—"],
              [
                "Date",
                prov.run.created_at
                  ? new Date(prov.run.created_at).toLocaleDateString()
                  : "—",
              ],
              [
                "Status",
                <span
                  key="status"
                  style={{
                    color:
                      prov.run.status === "completed"
                        ? "#4ade80"
                        : prov.run.status === "failed"
                        ? "#f87171"
                        : "#fbbf24",
                    fontWeight: 700,
                  }}
                >
                  {prov.run.status}
                </span>,
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{
                  background: "#111827",
                  borderRadius: 8,
                  padding: "12px 14px",
                  border: "1px solid #1f2937",
                }}
              >
                <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Health score */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 6 }}>
              Health Score
            </div>
            <HealthBar score={score} />
          </div>

          {/* Tags */}
          {prov.run.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {prov.run.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    background: "#1e3a5f",
                    color: "#93c5fd",
                    borderRadius: 999,
                    padding: "2px 10px",
                    fontSize: 12,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          <button
            onClick={downloadJSON}
            type="button"
            style={{
              padding: "8px 18px",
              background: "#1d4ed8",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Download provenance JSON
          </button>
          <a
            href={qlabApiPath(`/api/v1/runs/${runId}/bundle.zip`)}
            style={{
              padding: "8px 18px",
              background: "#374151",
              color: "#e5e7eb",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Download capsule.zip
          </a>
        </div>

        {/* Collapsible sections */}
        <Section title="Circuit QASM" defaultOpen={false}>
          {prov.run.qasm ? (
            <div style={{ position: "relative" }}>
              <pre
                style={{
                  background: "#0d1117",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  padding: "14px 16px",
                  fontSize: 12,
                  lineHeight: 1.6,
                  overflowX: "auto",
                  maxHeight: 320,
                  color: "#a5f3fc",
                  margin: 0,
                }}
              >
                {prov.run.qasm}
              </pre>
              <div style={{ marginTop: 10 }}>
                <CopyButton text={prov.run.qasm} label="Copy QASM" />
              </div>
            </div>
          ) : (
            <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
              No QASM stored for this run.
            </p>
          )}
        </Section>

        <Section title="Parameters" defaultOpen={false}>
          {Object.keys(prov.parameters).length > 0 ? (
            <pre
              style={{
                background: "#0d1117",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "14px 16px",
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                color: "#d1fae5",
                margin: 0,
              }}
            >
              {JSON.stringify(prov.parameters, null, 2)}
            </pre>
          ) : (
            <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
              No parameters recorded.
            </p>
          )}
        </Section>

        <Section title="Results" defaultOpen={false}>
          {Object.keys(prov.results).length > 0 ? (
            <pre
              style={{
                background: "#0d1117",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "14px 16px",
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                color: "#fef3c7",
                margin: 0,
              }}
            >
              {JSON.stringify(prov.results, null, 2)}
            </pre>
          ) : (
            <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
              No results recorded.
            </p>
          )}
        </Section>

        <Section title="Calibration" defaultOpen={false}>
          {Object.keys(prov.calibration).length > 0 ? (
            <pre
              style={{
                background: "#0d1117",
                border: "1px solid #374151",
                borderRadius: 6,
                padding: "14px 16px",
                fontSize: 12,
                lineHeight: 1.6,
                overflowX: "auto",
                color: "#e9d5ff",
                margin: 0,
              }}
            >
              {JSON.stringify(prov.calibration, null, 2)}
            </pre>
          ) : (
            <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
              No calibration data recorded.
            </p>
          )}
        </Section>

        {/* Assertions */}
        {prov.assertions.length > 0 && (
          <Section title={`Assertions (${prov.assertions.length})`} defaultOpen={false}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {prov.assertions.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "#111827",
                    border: `1px solid ${a.passed ? "#166534" : a.passed === false ? "#7f1d1d" : "#374151"}`,
                    borderRadius: 6,
                    padding: "10px 14px",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {a.passed ? "✓" : a.passed === false ? "✗" : "?"}
                  </span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{a.label ?? a.type}</span>
                  {a.actual !== null && (
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>
                      actual: {a.actual}
                    </span>
                  )}
                  <span
                    style={{
                      color:
                        a.passed === true
                          ? "#4ade80"
                          : a.passed === false
                          ? "#f87171"
                          : "#6b7280",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {a.passed === true ? "PASSED" : a.passed === false ? "FAILED" : "UNKNOWN"}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Metrics */}
        {prov.metrics.length > 0 && (
          <Section title={`Logged Metrics (${prov.metrics.length})`} defaultOpen={false}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              {prov.metrics.map((m, i) => (
                <div
                  key={i}
                  style={{
                    background: "#111827",
                    border: "1px solid #1f2937",
                    borderRadius: 6,
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 4 }}>
                    {m.name}{m.step !== null ? ` (step ${m.step})` : ""}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {typeof m.value === "number" ? m.value.toFixed(4) : m.value}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* SDK Reproduction Snippet */}
        <div
          style={{
            background: "#0f172a",
            border: "1px solid #1e3a5f",
            borderRadius: 12,
            padding: "20px 24px",
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#93c5fd" }}>
            SDK Reproduction Snippet
          </h3>
          <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 12px" }}>
            {prov.reproducibility.instructions}
          </p>
          <pre
            style={{
              background: "#0d1117",
              border: "1px solid #374151",
              borderRadius: 6,
              padding: "14px 16px",
              fontSize: 12,
              lineHeight: 1.7,
              color: "#a5f3fc",
              margin: "0 0 12px",
              overflowX: "auto",
            }}
          >
            {prov.reproducibility.sdk_snippet}
          </pre>
          <CopyButton text={prov.reproducibility.sdk_snippet} label="Copy snippet" />
        </div>

        {/* Badge embed */}
        <div
          style={{
            background: "#0f172a",
            border: "1px solid #1e3a5f",
            borderRadius: 12,
            padding: "20px 24px",
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#93c5fd" }}>
            Badge for Papers
          </h3>
          <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 14px" }}>
            Embed this badge in your paper or repository to link directly to this
            provenance certificate.
          </p>

          {/* Live badge preview */}
          <div style={{ marginBottom: 14 }}>
            <img
              src={badgeUrl}
              alt="Q-Lab health badge"
              style={{ height: 20, display: "block", marginBottom: 10 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          {/* Markdown embed code */}
          <div
            style={{
              background: "#0d1117",
              border: "1px solid #374151",
              borderRadius: 6,
              padding: "12px 14px",
              fontSize: 12,
              color: "#d1fae5",
              fontFamily: "monospace",
              marginBottom: 10,
              wordBreak: "break-all",
            }}
          >
            {badgeMarkdown}
          </div>
          <CopyButton text={badgeMarkdown} label="Copy badge markdown" />
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", color: "#4b5563", fontSize: 12, marginTop: 32 }}>
          Q-Lab Provenance Certificate · Public · Read-only ·{" "}
          <a href={`/runs/${runId}`} style={{ color: "#60a5fa" }}>
            View full run →
          </a>
        </div>
      </main>
    </div>
  );
}
