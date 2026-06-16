"use client";

import { useState } from "react";
import { GitBranch, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";

type LibVersions = Record<string, string>;

type ContextData = {
  python_version?: string;
  platform?: string;
  git_commit?: string | null;
  git_branch?: string | null;
  git_dirty?: boolean;
  library_versions?: LibVersions;
  pip_freeze?: string | null;
  [key: string]: unknown;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "var(--muted)" }}
      aria-label="Copy"
      type="button"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, gap: 8 }}>
      <span style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

export default function ContextPanel({ context }: { context: Record<string, unknown> }) {
  const ctx = context as ContextData;
  const [showPip, setShowPip] = useState(false);

  const hasGit = ctx.git_commit || ctx.git_branch;
  const hasPython = ctx.python_version || ctx.platform;
  const hasLibs = ctx.library_versions && Object.keys(ctx.library_versions).length > 0;
  const hasPip = !!ctx.pip_freeze;

  // Collect any extra keys not covered by the structured sections
  const knownKeys = new Set(["python_version", "platform", "git_commit", "git_branch", "git_dirty", "library_versions", "pip_freeze"]);
  const extraKeys = Object.keys(ctx).filter(k => !knownKeys.has(k));

  if (!hasGit && !hasPython && !hasLibs && !hasPip && extraKeys.length === 0) {
    return (
      <section className="panel">
        <div className="panel-header"><h2>Runtime Context</h2></div>
        <p style={{ padding: "12px 18px", fontSize: 13, color: "var(--muted)", margin: 0 }}>No context captured.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header"><h2>Runtime Context</h2></div>
      <div style={{ padding: "0 18px" }}>

        {/* Git info */}
        {hasGit && (
          <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Git
            </div>
            {ctx.git_branch && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <GitBranch size={14} color="var(--muted)" />
                <code style={{ fontSize: 13, background: "var(--panel-2)", padding: "2px 8px", borderRadius: 5 }}>
                  {ctx.git_branch}
                </code>
                {ctx.git_dirty && (
                  <span style={{ fontSize: 11, background: "var(--warn-bg, #fef3c7)", color: "var(--warn, #d97706)", padding: "1px 6px", borderRadius: 999, fontWeight: 600 }}>
                    dirty
                  </span>
                )}
              </div>
            )}
            {ctx.git_commit && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <code style={{
                  fontSize: 12, color: "var(--muted)", fontFamily: "monospace",
                  background: "var(--panel-2)", padding: "2px 8px", borderRadius: 5,
                }}>
                  {String(ctx.git_commit).slice(0, 12)}
                </code>
                <CopyButton text={String(ctx.git_commit)} />
              </div>
            )}
          </div>
        )}

        {/* Python / platform */}
        {hasPython && (
          <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Python Environment
            </div>
            {ctx.python_version && (
              <StatRow label="Python">
                <code style={{ fontSize: 12, fontFamily: "monospace" }}>
                  {String(ctx.python_version).split(" ")[0]}
                </code>
              </StatRow>
            )}
            {ctx.platform && (
              <StatRow label="Platform">
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{String(ctx.platform)}</span>
              </StatRow>
            )}
          </div>
        )}

        {/* Library versions */}
        {hasLibs && (
          <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Package Versions
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(ctx.library_versions || {}).map(([pkg, ver]) => (
                <span key={pkg} style={{
                  background: "var(--info-bg)", color: "var(--info-text)",
                  fontSize: 12, padding: "3px 9px", borderRadius: 999,
                  fontFamily: "monospace", fontWeight: 600,
                }}>
                  {pkg}
                  <span style={{ fontWeight: 400, opacity: 0.8 }}> {ver}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Extra unknown keys */}
        {extraKeys.length > 0 && (
          <div style={{ padding: "12px 0", borderBottom: hasPip ? "1px solid var(--line)" : undefined }}>
            {extraKeys.map(k => (
              <StatRow key={k} label={k.replace(/_/g, " ")}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{JSON.stringify(ctx[k])}</span>
              </StatRow>
            ))}
          </div>
        )}

        {/* Pip freeze — collapsible */}
        {hasPip && (
          <div style={{ padding: "12px 0" }}>
            <button
              type="button"
              onClick={() => setShowPip(prev => !prev)}
              style={{
                display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
                cursor: "pointer", color: "var(--muted)", fontSize: 12, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.05em", padding: 0,
              }}
            >
              {showPip ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              pip freeze ({String(ctx.pip_freeze).split("\n").filter(Boolean).length} packages)
            </button>
            {showPip && (
              <pre style={{
                marginTop: 8, fontSize: 11, color: "var(--code-text, var(--text))",
                background: "var(--code-bg, var(--panel-2))", padding: "10px 12px",
                borderRadius: 6, overflow: "auto", maxHeight: 240, lineHeight: 1.6,
              }}>
                {String(ctx.pip_freeze)}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
