"use client";

import Link from "next/link";
import UserMenu from "./UserMenu";
import { useEffect, useState, useSyncExternalStore } from "react";

const noSubscription = () => () => {};
import { useAuth } from "../../lib/auth";
import { usePathname, useRouter } from "next/navigation";
import { isCorePath, useLabs } from "../../lib/labs";
import IllustrativeNotice from "./IllustrativeNotice";
import RecoveryPrompt from "../../components/RecoveryPrompt";
import CommandPalette, { openCommand } from "../../components/CommandPalette";
import { DETAILS, DETAIL_LABEL, useDetail, useDetailSync, withDetail } from "../../lib/dial";
import { FRONTEND_COMMIT, commitUrl, shortSha } from "../../lib/build";

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

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = setInterval(() => void checkVersion(), 3 * 60 * 1000);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !token) router.replace("/login");
  }, [token, loading, router]);

  if (loading || !token) return null;
  return <>{children}</>;
}

/** Experimental pages are only shown once the user has turned Labs on. */
function LabsGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [labs, setLabs, ready] = useLabs();
  if (isCorePath(pathname) || labs) return <>{children}</>;
  if (!ready) return null;
  return (
    <main className="page">
      <div style={{ maxWidth: 520, margin: "10vh auto", textAlign: "center", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#f59e0b" }}>Labs</span>
        <h1 style={{ margin: 0, fontSize: 24 }}>This is an experimental tool</h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
          It is part of Q-Lab Labs: early tools that are less tested than the core tracker. Turn on Labs to
          use it. You can switch Labs off again from the command bar (Ctrl K, then “Labs”).
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="button" onClick={() => setLabs(true)}>Turn on Labs</button>
          <Link href="/runs" className="button secondary" style={{ textDecoration: "none" }}>Back to runs</Link>
        </div>
      </div>
    </main>
  );
}

/** The API's state, measured: a real request every minute, its answer and how long it took. */
function ApiReading() {
  const [r, setR] = useState<{ ok: boolean; ms: number } | null>(null);
  useEffect(() => {
    let on = true;
    async function ping() {
      const t0 = performance.now();
      try {
        const res = await fetch("/qlab-api/health", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (on) setR({ ok: res.ok, ms: Math.round(performance.now() - t0) });
      } catch {
        if (on) setR({ ok: false, ms: Math.round(performance.now() - t0) });
      }
    }
    void ping();
    const id = setInterval(() => void ping(), 60_000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return (
    <span className="mono" style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}
      title="Measured from this browser once a minute">
      <span className={`dot ${r === null ? "" : r.ok ? "ok" : "bad"}`} aria-hidden="true" />
      {r === null ? "API: checking" : r.ok ? `API answered in ${r.ms} ms` : "API not answering"}
    </span>
  );
}

// The parts of the tool, each with its own colour. Everything else is in the command bar.
const CHANNELS = [
  { href: "/runs", label: "Runs", c: "var(--c-runs)", match: (p: string) => p === "/runs" || p.startsWith("/runs/") },
  { href: "/projects", label: "Projects", c: "var(--c-map)", match: (p: string) => p.startsWith("/projects") },
  { href: "/hardware", label: "Hardware", c: "var(--c-board)", match: (p: string) => p === "/hardware" || p.startsWith("/hardware/") },
  { href: "/compare", label: "Compare", c: "var(--c-compare)", match: (p: string) => p === "/compare" },
];

function Dial() {
  const [d, setD] = useDetail();
  return (
    <div className="dial" role="group" aria-label="How technical">
      {DETAILS.map((x) => (
        <button key={x} type="button" aria-pressed={d === x} onClick={() => setD(x)}
          title={x === "plain" ? "Plain words: the answer and little else" : x === "expert" ? "Everything, including raw records" : "The usual view"}>
          {DETAIL_LABEL[x]}
        </button>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [d] = useDetail();
  useDetailSync(pathname);
  const mac = useSyncExternalStore(noSubscription, () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), () => false);
  return (
    <div className="shell">
      <header className="shell-bar">
        <Link href={withDetail("/runs", d)} className="shell-word" aria-label="Q-Lab, your runs">Q-LAB</Link>
        <nav className="channels" aria-label="Parts of Q-Lab">
          {CHANNELS.map((c) => (
            <Link key={c.href} href={withDetail(c.href, d)} aria-current={c.match(pathname) ? "page" : undefined}
              style={{ ["--ch" as string]: c.c }}>
              <i aria-hidden="true" />{c.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="cmd-trigger" onClick={() => openCommand()} aria-keyshortcuts="Control+K Meta+K /">
          <span>Find a run, project, backend, circuit hash, or any page…</span>
          <kbd aria-hidden="true">{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <div className="shell-tools">
          <Dial />
          <UserMenu />
        </div>
      </header>
      <IllustrativeNotice />
      <RecoveryPrompt />
      <div className="shell-main"><LabsGate>{children}</LabsGate></div>
      <footer className="shell-foot">
        <ApiReading />
        <span>Dashboard {FRONTEND_COMMIT ? <a href={commitUrl(FRONTEND_COMMIT)} rel="noreferrer">{shortSha(FRONTEND_COMMIT)}</a> : "commit unknown"}</span>
        <Link href="/trust">What this Q-Lab runs and loads</Link>
        <span>Press {mac ? "⌘K" : "Ctrl K"} or / for everything else</span>
      </footer>
      <CommandPalette />
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SWUpdater />
      <WarmupBanner />
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}
