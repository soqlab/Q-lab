"use client";

import { useEffect, useState } from "react";
import { Atom } from "lucide-react";
import SideNav from "./SideNav";
import UserMenu from "./UserMenu";
import OnboardingWizard from "../../components/OnboardingWizard";
import { useAuth } from "../../lib/auth";
import { resendVerification } from "../../lib/api";

function EmailVerificationBanner() {
  const { user, token } = useAuth();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || user.email_verified !== false) return null;

  const handleResend = async () => {
    if (!token || sending) return;
    setSending(true);
    try {
      await resendVerification(token);
      setSent(true);
    } catch {
      setSent(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      background: "#7c2d12", color: "#fef3c7",
      padding: "10px 24px", fontSize: 13,
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <span>⚠ Please verify your email address to unlock all features.</span>
      {sent ? (
        <span style={{ color: "#86efac", fontWeight: 600 }}>Verification email sent ✓</span>
      ) : (
        <button
          onClick={handleResend}
          disabled={sending}
          style={{
            background: "transparent", border: "1px solid #fef3c7", color: "#fef3c7",
            borderRadius: 5, padding: "2px 12px", fontSize: 12, cursor: "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "Sending…" : "Resend email"}
        </button>
      )}
    </div>
  );
}

const ONBOARDING_KEY = "qlab_onboarding_done";
const TOKEN_KEY = "qlab_token";

function OnboardingGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === "1") return;

    const token = localStorage.getItem(TOKEN_KEY);
    fetch("/qlab-api/api/v1/runs?limit=1", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        const count = Array.isArray(data) ? data.length : (data?.total ?? data?.count ?? 0);
        if (count === 0) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <OnboardingWizard
      onDismiss={() => {
        localStorage.setItem(ONBOARDING_KEY, "1");
        setShow(false);
      }}
    />
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="brand-mark">
              <Atom size={19} aria-hidden="true" />
            </div>
            <span>Q-Lab</span>
          </div>
          <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", paddingLeft: 2 }}>
            State of Quantum
          </span>
        </div>
        <SideNav />
      </aside>
      <div className="content">
        <EmailVerificationBanner />
        <header className="topbar">
          <div className="page-title">
            <h1>Quantum Experiment Observatory</h1>
            <p>Capture, compare, and reproduce circuit runs.</p>
          </div>
          <UserMenu />
        </header>
        {children}
        <footer style={{ padding: "16px 24px", borderTop: "1px solid #1e293b", fontSize: 12, color: "#475569", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span>© {new Date().getFullYear()} Q-Lab (soqlab.com)</span>
          <a href="/terms" style={{ color: "#475569" }}>Terms</a>
          <a href="/privacy" style={{ color: "#475569" }}>Privacy</a>
        </footer>
      </div>
      <OnboardingGate />
    </div>
  );
}
