"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

const STORAGE_KEY = "qlab_nps_last_shown";
const COOLDOWN_DAYS = 90;

export default function NPSWidget() {
  const { user, token } = useAuth();
  const [visible, setVisible] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [step, setStep] = useState<"score" | "comment" | "done">("score");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;

    const lastShown = localStorage.getItem(STORAGE_KEY);
    if (lastShown) {
      const daysSince = (Date.now() - Number(lastShown)) / (1000 * 60 * 60 * 24);
      if (daysSince < COOLDOWN_DAYS) return;
    }

    // Show after a short delay so it doesn't pop on page load
    const timer = setTimeout(() => setVisible(true), 8000);
    return () => clearTimeout(timer);
  }, [user]);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
  }

  async function submit() {
    if (score === null) return;
    setSubmitting(true);
    try {
      await fetch("/qlab-api/api/v1/nps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ score, comment: comment.trim() || null }),
      });
    } catch {
      // Silent — NPS failure shouldn't interrupt the user
    }
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setStep("done");
    setTimeout(() => setVisible(false), 2800);
    setSubmitting(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
      width: 340, padding: "20px 22px",
      animation: "nps-slide-in 0.3s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <style>{`
        @keyframes nps-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {step === "done" ? (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🙏</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Thank you!</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Your feedback means a lot.</div>
        </div>
      ) : step === "score" ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "var(--text)", lineHeight: 1.4, maxWidth: 260 }}>
              How likely are you to recommend Q-Lab to a colleague?
            </p>
            <button onClick={dismiss} style={{
              background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
              fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", flexShrink: 0,
            }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button
                key={n}
                onClick={() => setScore(n)}
                style={{
                  flex: 1, height: 34, borderRadius: 6, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", border: "1px solid var(--line)",
                  background: score === n
                    ? n >= 9 ? "#10b981" : n >= 7 ? "#f59e0b" : "#ef4444"
                    : "transparent",
                  color: score === n ? "#fff" : "var(--muted)",
                  transition: "background 0.1s, color 0.1s",
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 16 }}>
            <span>Not likely</span><span>Very likely</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="button"
              style={{ flex: 1, justifyContent: "center", opacity: score === null ? 0.4 : 1 }}
              disabled={score === null}
              onClick={() => setStep("comment")}
            >
              Next →
            </button>
            <button className="button secondary" style={{ fontSize: 12 }} onClick={dismiss}>
              Skip
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
              What&apos;s the main reason for your score?
            </p>
            <button onClick={dismiss} style={{
              background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
              fontSize: 18, lineHeight: 1, padding: "0 0 0 8px", flexShrink: 0,
            }}>×</button>
          </div>
          <textarea
            className="input"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Optional — what could we improve?"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 80, resize: "none", fontFamily: "inherit", fontSize: 13, marginBottom: 12 }}
            maxLength={2000}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="button"
              style={{ flex: 1, justifyContent: "center" }}
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
            <button className="button secondary" style={{ fontSize: 12 }} onClick={submit} disabled={submitting}>
              Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
}
