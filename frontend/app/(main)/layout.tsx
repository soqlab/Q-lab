"use client";

import { useEffect, useState } from "react";
import { Microscope } from "lucide-react";
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
    fetch("/qlab-api/runs?limit=1", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        const count = Array.isArray(data) ? data.length : (data?.total ?? data?.count ?? 0);
        if (count === 0) setShow(true);
      })
      .catch(() => {
        setShow(true);
      });
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
        <div className="brand">
          <div className="brand-mark">
            <Microscope size={19} aria-hidden="true" />
          </div>
          Q-Lab
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
      </div>
      <OnboardingGate />
    </div>
  );
}
