"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "../lib/auth";
import { qlabApiPath } from "../lib/api";
import { FRONTEND_COMMIT, commitUrl, shortSha } from "../lib/build";
import s from "./landing.module.css";
import BoardReadout from "../components/board/BoardReadout";

// The signed-out front door is the instrument itself: what this Q-Lab server is doing right now,
// read live from its public API. Nothing on this page is a picture or a made-up number; a reading
// that can't be taken shows "—" and says why.

type GalleryItem = {
  share_token: string; circuit_name: string; backend: string | null; status: string;
  health_score: number | null; qubits: number | null; depth: number | null; project: string | null; created_at: string | null;
};
type Gallery = { total: number; items: GalleryItem[] };
type Load<T> = { state: "loading" } | { state: "error" } | { state: "ok"; data: T; ms?: number };

const noSubscription = () => () => {};

function useJson<T>(path: string, valid: (d: unknown) => d is T): Load<T> {
  const [v, setV] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let on = true;
    const t0 = performance.now();
    fetch(qlabApiPath(path), { cache: "no-store", headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (on) setV(valid(d) ? { state: "ok", data: d, ms: Math.round(performance.now() - t0) } : { state: "error" }); })
      .catch(() => { if (on) setV({ state: "error" }); });
    return () => { on = false; };
  }, [path, valid]);
  return v;
}

const isObj = (d: unknown): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d);
const isHealth = (d: unknown): d is { status: string; version?: string } => isObj(d) && typeof d.status === "string";
const isGallery = (d: unknown): d is Gallery => isObj(d) && typeof d.total === "number" && Array.isArray(d.items);
const isBuild = (d: unknown): d is { commit: string | null } => isObj(d) && "commit" in d;

function ago(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A shared-run link or token typed into the input, as a share token. */
function asShareToken(raw: string): string | null {
  const v = raw.trim();
  const m = v.match(/\/share\/([A-Za-z0-9_-]{8,128})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : null;
}

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const signedIn = mounted && !loading && !!user;

  const health = useJson("/health", isHealth);
  const gallery = useJson("/api/v1/public/gallery?limit=12", isGallery);
  const build = useJson("/api/v1/build", isBuild);
  const [q, setQ] = useState("");

  const items = useMemo(() => (gallery.state === "ok" ? gallery.data.items : []), [gallery]);
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    if (!w || asShareToken(q)) return items;
    return items.filter((r) => `${r.circuit_name} ${r.backend ?? ""} ${r.project ?? ""}`.toLowerCase().includes(w));
  }, [items, q]);

  const backends = new Set(items.map((r) => r.backend).filter(Boolean));
  const summary =
    health.state === "loading" ? "Reading this Q-Lab server…"
    : health.state === "error" ? "This Q-Lab server isn't answering right now. It may be starting up, which takes about 30 seconds."
    : gallery.state === "ok" && gallery.data.total > 0
      ? `This Q-Lab server is up. ${gallery.data.total} run${gallery.data.total === 1 ? " has" : "s have"} been shared publicly; the latest ${items.length === 1 ? "one is" : `${items.length} are`} below, from ${backends.size} backend${backends.size === 1 ? "" : "s"}.`
      : "This Q-Lab server is up. Nobody has shared a run publicly yet.";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = asShareToken(q);
    if (token) router.push(`/share/${encodeURIComponent(token)}`);
    else if (shown[0]) router.push(`/share/${encodeURIComponent(shown[0].share_token)}`);
  }

  const backCommit = build.state === "ok" ? build.data.commit : null;

  return (
    <div className={s.root}>
      <header className={s.bar}>
        <Link href="/" className={s.word}>Q-LAB</Link>
        <span className={s.host}>quantum run tracker</span>
        <nav className={s.links} aria-label="Q-Lab">
          <Link href="/gallery">Public runs</Link>
          <Link href="/trust">Trust</Link>
          {signedIn
            ? <Link href="/runs" className={s.primary}>Your runs</Link>
            : <Link href="/login" className={s.primary}>Sign in</Link>}
        </nav>
      </header>

      <main className={s.main}>
        <p className="summary-line" aria-live="polite">{summary}</p>

        <form className={s.input} role="search" onSubmit={submit}>
          <span aria-hidden="true" className={s.prompt}>›</span>
          <input
            value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off"
            aria-label="Find a public run: a circuit name, a backend, or a shared link"
            placeholder="Find a public run: circuit, backend, or paste a shared link"
          />
          <kbd aria-hidden="true">↵</kbd>
        </form>

        <dl className="readouts">
          <div className="readout" aria-busy={health.state === "loading" || undefined}>
            <dt>API</dt>
            <dd>{health.state === "ok" ? health.data.status : health.state === "error" ? "no answer" : "—"}
              <small>{health.state === "ok" ? `answered in ${health.ms} ms` : health.state === "error" ? "may be starting up" : "asking…"}</small></dd>
          </div>
          <div className="readout" aria-busy={gallery.state === "loading" || undefined}>
            <dt>Runs shared publicly</dt>
            <dd>{gallery.state === "ok" ? gallery.data.total.toLocaleString("en-US") : "—"}
              <small>private runs are never counted</small></dd>
          </div>
          <div className="readout">
            <dt>Dashboard commit</dt>
            <dd>{FRONTEND_COMMIT ? <a href={commitUrl(FRONTEND_COMMIT)} rel="noreferrer">{shortSha(FRONTEND_COMMIT)}</a> : "—"}
              <small>{FRONTEND_COMMIT ? "check it on GitHub" : "not recorded in this build"}</small></dd>
          </div>
          <div className="readout" aria-busy={build.state === "loading" || undefined}>
            <dt>Backend commit</dt>
            <dd>{backCommit ? <a href={commitUrl(backCommit)} rel="noreferrer">{shortSha(backCommit)}</a> : "—"}
              <small>{backCommit ? (backCommit === FRONTEND_COMMIT ? "same as the dashboard" : "differs from the dashboard") : build.state === "loading" ? "asking…" : "not reported"}</small></dd>
          </div>
        </dl>

        <section className="frame" aria-labelledby="pub-h">
          <div className="frame-head">
            <h2 id="pub-h" className="inst-label">Latest public runs</h2>
            <Link href="/gallery" className={s.more}>All public runs →</Link>
          </div>
          {gallery.state === "loading" && <div className="empty-state">Loading public runs…</div>}
          {gallery.state === "error" && <div className="empty-state">The list of public runs couldn&apos;t be loaded.</div>}
          {gallery.state === "ok" && !items.length && (
            <div className="empty-state">No runs have been shared yet. A run appears here when its owner presses <strong>Share</strong> on it.</div>
          )}
          {gallery.state === "ok" && items.length > 0 && !shown.length && (
            <div className="empty-state">None of the latest public runs match “{q}”.</div>
          )}
          {shown.length > 0 && (
            <div className="table-wrap">
              <table className={s.table}>
                <thead>
                  <tr><th>Circuit</th><th>Backend</th><th className={s.r}>Qubits</th><th className={s.r}>Depth</th><th className={s.r}>Quality</th><th className={s.r}>When</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.share_token}>
                      <td><Link href={`/share/${encodeURIComponent(r.share_token)}`} className={s.run}>{r.circuit_name}</Link>{r.project && <span className={s.proj}>{r.project}</span>}</td>
                      <td className="mono">{r.backend ?? "—"}</td>
                      <td className={`num ${s.r}`}>{r.qubits ?? "—"}</td>
                      <td className={`num ${s.r}`}>{r.depth ?? "—"}</td>
                      <td className={`num ${s.r}`}>{r.health_score ?? "—"}</td>
                      <td className={s.r}>{ago(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="frame" aria-labelledby="hw-h">
          <div className="frame-head">
            <h2 id="hw-h" className="inst-label">Quantum hardware right now</h2>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>IBM Quantum, read by this server</span>
          </div>
          <div className="frame-body"><BoardReadout href="/hardware" /></div>
        </section>

        <section className="frame" aria-labelledby="rec-h">
          <div className="frame-head"><h2 id="rec-h" className="inst-label">Record your own runs</h2></div>
          <div className="frame-body">
            <p className={s.p}>Add two lines to a Qiskit script. Every circuit it runs is recorded with its backend, calibration, transpiler settings and results. Nothing else in your code changes.</p>
            <pre className="code">{`pip install qlab-sdk

import qlab
qlab.auto_track(api_key="YOUR_KEY")   # your key is in Settings once you sign in`}</pre>
            <p className={s.p}>
              {signedIn
                ? <>You&apos;re signed in. <Link href="/runs" className={s.inline}>Open your runs</Link>.</>
                : <>Sign in with a passkey on this device or your phone. No password and no email needed. <Link href="/login" className={s.inline}>Sign in or create an account</Link>.</>}
            </p>
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <span>Q-Lab, MIT licence, a <a href="https://soqlab.com">SOQLAB</a> product</span>
        <a href="https://github.com/soqlab/Q-lab">Source</a>
        <a href="https://github.com/soqlab/Q-lab/blob/main/SELF_HOSTING.md">Run it yourself</a>
        <Link href="/trust">What this page loads</Link>
        <a href="mailto:contact@soqlab.com">contact@soqlab.com</a>
      </footer>
    </div>
  );
}
