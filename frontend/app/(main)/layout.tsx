"use client";

import { useEffect, useState } from "react";
import { Atom } from "lucide-react";
import SideNav from "./SideNav";
import UserMenu from "./UserMenu";
import OnboardingWizard from "../../components/OnboardingWizard";

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
            Science of Quantum
          </span>
        </div>
        <SideNav />
      </aside>
      <div className="content">
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
