"use client";

import { Atom } from "lucide-react";
import SideNav from "./SideNav";
import UserMenu from "./UserMenu";

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
    </div>
  );
}
