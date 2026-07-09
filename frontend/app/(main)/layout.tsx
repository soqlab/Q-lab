"use client";

import { Atom } from "lucide-react";
import SideNav from "./SideNav";
import UserMenu from "./UserMenu";
import NPSWidget from "../../components/NPSWidget";
import { useEffect, useState } from "react";

function SWUpdater() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Auto-reload when a new SW version takes over (fires when sw.js changes)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    // Version checker: compare __NEXT_DATA__.buildId against what the server
    // is currently serving. Fires on tab focus and every 3 minutes. When the
    // build ID differs (new deploy) the page reloads silently.
    const currentBuildId = (window as Record<string, unknown>).__NEXT_DATA__ &&
      ((window as Record<string, unknown>).__NEXT_DATA__ as Record<string, unknown>).buildId as string | undefined;

    if (!currentBuildId) return;

    async function checkVersion() {
      try {
        const res = await fetch(window.location.pathname, {
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
        const html = await res.text();
        const match = html.match(/"buildId":"([^"]+)"/);
        const deployedId = match?.[1];
        if (deployedId && deployedId !== currentBuildId) {
          window.location.reload();
        }
      } catch {
        // Network error — ignore, try again next time
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkVersion();
    });

    const interval = setInterval(() => void checkVersion(), 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  return null;
}

function WarmupBanner() {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 2500);
    const start = Date.now();
    let cancelled = false;

    function ping(attempt: number) {
      if (cancelled) return;
      fetch("/qlab-api/health", { signal: AbortSignal.timeout(35000) })
        .then(() => {
          if (cancelled) return;
          clearTimeout(timer);
          if (Date.now() - start > 2500) {
            setDone(true);
            setTimeout(() => setVisible(false), 2000);
          } else {
            setVisible(false);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 8) {
            // Backend refused connection (cold start) — retry with backoff
            setTimeout(() => ping(attempt + 1), Math.min(3000 + attempt * 1000, 8000));
          } else {
            clearTimeout(timer);
            setVisible(false);
          }
        });
    }

    ping(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, background: "#0f172a", border: "1px solid #334155",
      borderRadius: 12, padding: "12px 20px", display: "flex", alignItems: "center",
      gap: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", minWidth: 320,
      animation: "fadeSlideIn 0.3s ease",
    }}>
      <style>{`
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      {done ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5"
          style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="#6366f1"/>
        </svg>
      )}
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: done ? "#10b981" : "#e2e8f0" }}>
          {done ? "Q-Lab is ready" : "Warming up…"}
        </p>
        {!done && (
          <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
            Backend is starting up — takes ~30s on first visit
          </p>
        )}
      </div>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <SWUpdater />
      <WarmupBanner />
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
        <div style={{ flex: 1 }}>{children}</div>
        <footer style={{ padding: "16px 24px", borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--muted)", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span>© {new Date().getFullYear()} Q-Lab (soqlab.com)</span>
          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#475569" }}>Terms</a>
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#475569" }}>Privacy</a>
        </footer>
      </div>
      <NPSWidget />
    </div>
  );
}
