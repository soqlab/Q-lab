"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { qlabApiPath } from "../../lib/api";
import styles from "./wall.module.css";

/**
 * Wall mode: one sentence and one number, for a display that nobody signs in on.
 *
 * - The display link's token is read from the URL fragment and sent only as the X-Qlab-Display
 *   header to /api/v1/wall. It is never put in a query string, stored or sent anywhere else.
 * - It polls once a minute with If-None-Match (304 when nothing changed) and backs off on errors
 *   (1, 2, 4 ... up to 15 minutes). If the data can't be fetched, the last value stays, dimmed, with
 *   how old it is. It never shows a value it didn't get from the server.
 * - Dark by default; the footer button switches to light (remembered on this display).
 * - Burn-in: unless the display asks for reduced motion, the content drifts a few pixels every few
 *   minutes.
 */

type WallData = {
  name: string;
  metric: string;
  metric_label: string;
  value: number | null;
  display: string | null;
  label: string;
  sentence: string;
  state: "ok" | "empty" | "alarm";
  data_as_of: string | null;
  newest_run_at: string | null;
  expires_at: string | null;
};

type Problem = null | "no_token" | "invalid" | "unreachable";

const POLL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const STALE_MS = 3 * POLL_MS + 15_000;
const SHIFT_MS = 4 * 60_000;
const THEME_KEY = "qlab_wall_theme";

function ago(fromIso: string | number | null, now: number): string | null {
  if (fromIso === null) return null;
  const t = typeof fromIso === "number" ? fromIso : Date.parse(fromIso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
  return /^qdl_[A-Za-z0-9_-]{20,190}$/.test(raw) ? raw : null;
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark"; // storage may be off
  }
}

const themeListeners = new Set<() => void>();
function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => { themeListeners.delete(cb); };
}

export default function WallView() {
  // undefined while the page is being rendered on the server: the fragment is only known in the browser.
  const token = useSyncExternalStore<string | null | undefined>(subscribeHash, readToken, () => undefined);
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);
  // Everything below is kept per token, so a changed link never shows the previous link's data.
  const [view, setView] = useState<{ token: string | null; data: WallData | null; problem: Problem; lastOk: number | null }>(
    { token: null, data: null, problem: null, lastOk: null });
  const [now, setNow] = useState(() => Date.now());
  const [shift, setShift] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!token) return;
    const link = token;
    let alive = true;
    let etag: string | null = null;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = (patch: Partial<typeof view>) =>
      setView((v) => ({ ...(v.token === link ? v : { data: null, problem: null, lastOk: null }), token: link, ...patch }));

    async function tick() {
      if (timer) clearTimeout(timer);
      let next = POLL_MS;
      try {
        const headers: Record<string, string> = { "X-Qlab-Display": link };
        if (etag) headers["If-None-Match"] = etag;
        const res = await fetch(qlabApiPath("/api/v1/wall"), {
          headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
        });
        if (!alive) return;
        if (res.status === 304) {
          failures = 0;
          update({ lastOk: Date.now(), problem: null });
        } else if (res.ok) {
          const body = (await res.json()) as WallData;
          // Offline, the service worker answers 200 with {"error": "offline"}: not wall data.
          if (typeof body?.sentence !== "string" || typeof body?.metric !== "string") throw new Error("not wall data");
          etag = res.headers.get("ETag");
          failures = 0;
          update({ data: body, lastOk: Date.now(), problem: null });
        } else if (res.status === 401) {
          // Revoked, expired or wrong: what was shown so far is no longer this link's to show.
          etag = null;
          update({ data: null, problem: "invalid" });
          next = 10 * POLL_MS;
        } else {
          throw new Error(String(res.status));
        }
      } catch {
        if (!alive) return;
        failures += 1;
        update({ problem: "unreachable" });
        next = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures - 1, 4));
      }
      if (alive) timer = setTimeout(() => { void tick(); }, next);
    }

    void tick();
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // The footer's "x min ago" keeps counting between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Burn-in: a small drift every few minutes. With reduced motion the CSS keeps it still.
  useEffect(() => {
    const id = setInterval(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setShift({ x: Math.round((Math.random() - 0.5) * 24), y: Math.round((Math.random() - 0.5) * 16) });
    }, SHIFT_MS);
    return () => clearInterval(id);
  }, []);

  function toggleTheme() {
    try { localStorage.setItem(THEME_KEY, theme === "dark" ? "light" : "dark"); } catch { /* not remembered */ }
    themeListeners.forEach((cb) => cb());
  }

  const current = view.token === token ? view : { data: null, problem: null, lastOk: null };
  const data = current.data;
  const lastOk = current.lastOk;
  const problem: Problem = token === null ? "no_token" : current.problem;

  const stale = data !== null && (problem === "unreachable" || (lastOk !== null && now - lastOk > STALE_MS));
  const updated = lastOk !== null ? `${clock(lastOk)} (${ago(lastOk, now)})` : null;
  const dataAge = data ? ago(data.newest_run_at, now) : null;

  let main: React.ReactNode;
  if (problem === "no_token") {
    main = (
      <div className={styles.notice}>
        <p className={styles.sentence}>This display has no display link.</p>
        <p className={styles.hint}>An admin can make one in Q-Lab under Settings, Display links, and open it here.</p>
      </div>
    );
  } else if (problem === "invalid") {
    main = (
      <div className={styles.notice}>
        <p className={styles.sentence}>This display link no longer works.</p>
        <p className={styles.hint}>It was revoked or it expired. An admin can make a new one in Q-Lab under Settings, Display links.</p>
      </div>
    );
  } else if (!data) {
    main = (
      <div className={styles.notice} aria-busy={problem !== "unreachable"}>
        <p className={styles.sentence}>{problem === "unreachable" ? "Can't reach Q-Lab yet. Trying again." : "Loading…"}</p>
      </div>
    );
  } else {
    main = (
      <>
        <p className={styles.sentence}>{data.sentence}</p>
        <div className={styles.figure}>
          <span className={styles.number} data-empty={data.display === null ? "" : undefined}>{data.display ?? "—"}</span>
          <span className={styles.label}>{data.label}</span>
        </div>
      </>
    );
  }

  return (
    <div className={styles.wall} data-theme={theme} data-stale={stale ? "" : undefined}>
      <main className={styles.stage} style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }} aria-live="polite">
        {main}
      </main>
      <footer className={styles.footer}>
        <span className={styles.brand}>Q-Lab{data?.name ? ` · ${data.name}` : ""}</span>
        <span role="status" className={stale ? styles.staleText : undefined}>
          {stale
            ? `Not updated since ${updated ?? "this display started"}. Q-Lab can't be reached; the value shown is from then.`
            : updated ? `Updated ${updated}` : ""}
          {dataAge ? ` · newest run ${dataAge}` : ""}
        </span>
        <button type="button" className={styles.themeButton} onClick={toggleTheme}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </footer>
    </div>
  );
}
