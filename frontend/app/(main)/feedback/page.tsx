"use client";

import { useState } from "react";
import { useAuth } from "../../../lib/auth";

const TYPES = [
  { value: "feature_request", label: "Feature Request", icon: "💡", desc: "Something you'd love to see in Q-Lab" },
  { value: "bug_report",      label: "Bug Report",      icon: "🐛", desc: "Something isn't working as expected" },
  { value: "general",         label: "General Feedback", icon: "💬", desc: "Anything else on your mind" },
];

const CATEGORIES = ["Analytics", "Collaboration", "Providers", "UI/UX", "SDK / Python", "Experiments", "Alerts", "Export", "Other"];
const SEVERITIES = [
  { value: "critical", label: "Critical", desc: "App is unusable" },
  { value: "high",     label: "High",     desc: "Major feature broken" },
  { value: "medium",   label: "Medium",   desc: "Inconvenient but workable" },
  { value: "low",      label: "Low",      desc: "Minor cosmetic issue" },
];

export default function FeedbackPage() {
  const { user, token } = useAuth();
  const [type, setType]           = useState("feature_request");
  const [title, setTitle]         = useState("");
  const [description, setDesc]    = useState("");
  const [category, setCategory]   = useState("");
  const [severity, setSeverity]   = useState("medium");
  const [status, setStatus]       = useState<"idle" | "sending" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/qlab-api/api/v1/user-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          type,
          title,
          description,
          category: type === "feature_request" ? category || null : null,
          severity: type === "bug_report" ? severity : null,
          page: typeof window !== "undefined" ? document.referrer || window.location.href : null,
          browser: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🙏</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px" }}>Thank you!</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.7, margin: "0 0 24px" }}>
            Your feedback has been received. We read every submission and it directly shapes what we build next.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="button" onClick={() => { setTitle(""); setDesc(""); setCategory(""); setStatus("idle"); }}>
              Submit another
            </button>
            <a href="/runs" className="button secondary" style={{ textDecoration: "none" }}>
              Back to runs
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>Send Feedback</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Help shape Q-Lab. Feature requests, bug reports, or anything on your mind — we read everything.
          </p>
        </div>

        {/* Type selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
          {TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              style={{
                padding: "14px 12px",
                borderRadius: 8,
                border: `2px solid ${type === t.value ? "var(--strong)" : "var(--line)"}`,
                background: type === t.value ? "rgba(99,102,241,0.08)" : "var(--surface)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{t.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Title */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Title <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              className="input"
              style={{ width: "100%", boxSizing: "border-box" }}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={type === "feature_request" ? "e.g. Export runs to CSV by date range" : type === "bug_report" ? "e.g. /runs page shows blank on first load" : "e.g. Love the research graph feature"}
              required
              minLength={3}
              maxLength={200}
            />
          </div>

          {/* Category (feature request) */}
          {type === "feature_request" && (
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Category</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setCategory(c === category ? "" : c)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${category === c ? "var(--strong)" : "var(--line)"}`,
                      background: category === c ? "rgba(99,102,241,0.12)" : "transparent",
                      color: category === c ? "var(--text)" : "var(--muted)",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Severity (bug report) */}
          {type === "bug_report" && (
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>Severity</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                {SEVERITIES.map(s => (
                  <button
                    key={s.value} type="button"
                    onClick={() => setSeverity(s.value)}
                    style={{
                      padding: "8px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer", textAlign: "left",
                      border: `2px solid ${severity === s.value ? "var(--strong)" : "var(--line)"}`,
                      background: severity === s.value ? "rgba(99,102,241,0.08)" : "var(--surface)",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.3 }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Description <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <textarea
              className="input"
              style={{ width: "100%", boxSizing: "border-box", minHeight: 140, resize: "vertical", fontFamily: "inherit" }}
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder={
                type === "feature_request"
                  ? "Describe what you'd like to see and why it would help your workflow…"
                  : type === "bug_report"
                  ? "Steps to reproduce:\n1. Go to…\n2. Click…\n3. Expected: …\n4. Actual: …"
                  : "Share your thoughts…"
              }
              required
              minLength={10}
              maxLength={5000}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", marginTop: 4 }}>
              {description.length}/5000
            </div>
          </div>

          {user && (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--line)" }}>
              Submitting as <strong style={{ color: "var(--text)" }}>{user.name}</strong> ({user.email})
            </div>
          )}

          {status === "error" && (
            <div style={{ fontSize: 13, color: "var(--danger)" }}>Something went wrong. Please try again.</div>
          )}

          <button
            className="button"
            type="submit"
            disabled={status === "sending" || !title || !description}
            style={{ alignSelf: "flex-start", minWidth: 140, justifyContent: "center", opacity: (!title || !description) ? 0.5 : 1 }}
          >
            {status === "sending" ? "Sending…" : "Send Feedback"}
          </button>
        </form>
      </div>
    </main>
  );
}
