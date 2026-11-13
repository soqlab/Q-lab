"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { commitUrl, FRONTEND_COMMIT, FRONTEND_COMMIT_TIME, isBackendBuild, shortSha, SOURCE_REPO, type BackendBuild } from "../../lib/build";
import { qlabApiPath } from "../../lib/api";
import s from "./trust.module.css";

type Load<T> = { state: "loading" } | { state: "error" } | { state: "ok"; data: T };

// The browser may talk to the Q-Lab backend directly when the site is set up that way; that is
// still Q-Lab, not a third party.
const API_BASE = (process.env.NEXT_PUBLIC_QLAB_API_BASE || "").replace(/\/+$/, "");
const apiOrigin = (() => { try { return API_BASE ? new URL(API_BASE).origin : ""; } catch { return ""; } })();

function useJson<T>(url: string, valid: (d: unknown) => d is T): Load<T> {
  const [v, setV] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let on = true;
    fetch(url, { cache: "no-store", headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (on) setV(valid(d) ? { state: "ok", data: d } : { state: "error" }); })
      .catch(() => { if (on) setV({ state: "error" }); });
    return () => { on = false; };
  }, [url, valid]);
  return v;
}

function Commit({ sha }: { sha: string | null }) {
  if (!sha) return <>unknown</>;
  return <a className={s.link} href={commitUrl(sha)} rel="noreferrer">{shortSha(sha)}</a>;
}

function CodeRunning() {
  const backend = useJson<BackendBuild>(qlabApiPath("/api/v1/build"), isBackendBuild);
  const back = backend.state === "ok" ? backend.data.commit : null;
  let verdict: React.ReactNode;
  if (backend.state === "loading") verdict = <span className={s.muted}>Asking the backend which commit it runs…</span>;
  else if (backend.state === "error") verdict = <span className={s.warn}>The backend did not answer, so its commit can&apos;t be shown right now.</span>;
  else if (!FRONTEND_COMMIT || !back) verdict = <span className={s.warn}>At least one side doesn&apos;t know its commit (this happens on local builds without git), so they can&apos;t be compared.</span>;
  else if (FRONTEND_COMMIT === back) verdict = <span className={s.ok}>Both run the same commit.</span>;
  else verdict = <span className={s.warn}>They run different commits. This is normal for a few minutes during a deploy, when one side has updated before the other.</span>;

  return (
    <section className={s.panel} aria-labelledby="code-h">
      <div className={s.eyebrow}>Code</div>
      <h2 id="code-h">The code this Q-Lab is running</h2>
      <dl className={s.readings}>
        <div className={s.reading}>
          <dt>Dashboard (this page)</dt>
          <dd><Commit sha={FRONTEND_COMMIT} /><small>{FRONTEND_COMMIT ? `Built from commit ${FRONTEND_COMMIT}${FRONTEND_COMMIT_TIME ? `, committed ${FRONTEND_COMMIT_TIME.replace("T", " ").replace("Z", " UTC")}` : ""}.` : "The build did not record a commit."}</small></dd>
        </div>
        <div className={s.reading}>
          <dt>Backend (API)</dt>
          <dd>
            {backend.state === "loading" ? "…" : <Commit sha={back} />}
            <small>{back ? `Running commit ${back}${backend.state === "ok" ? `, version ${backend.data.version}` : ""}.` : backend.state === "ok" ? "The server was not told its commit (RENDER_GIT_COMMIT or QLAB_COMMIT)." : ""}</small>
          </dd>
        </div>
      </dl>
      <p className={s.verdict} role="status">{verdict}</p>
      <p className={s.muted}>
        Each commit links to its page on GitHub, where you can read the exact source. The commit IDs come from the build
        (the dashboard) and from the hosting platform (the backend); the code itself reports them, so they show what was
        deployed, not a promise. See the <a className={s.link} href={`${SOURCE_REPO}/commits/main`} rel="noreferrer">latest commits on main</a> to
        check whether this is the newest version.
      </p>
    </section>
  );
}

// ── Connection (only when served through Cloudflare, which answers /cdn-cgi/trace) ──
type Trace = Record<string, string>;
function parseTrace(text: string): Trace | null {
  const out: Trace = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out.tls || out.kex ? out : null;
}

const KEX: Record<string, string> = {
  X25519MLKEM768: "post-quantum hybrid (X25519 + ML-KEM-768). Recorded traffic stays safe even against a future quantum computer.",
  X25519Kyber768Draft00: "an early post-quantum hybrid (pre-standard Kyber).",
  X25519: "classical elliptic-curve key exchange. Fine today, but traffic recorded now could be decrypted by a large quantum computer later.",
  P256: "classical elliptic-curve key exchange (NIST P-256), not quantum-safe.",
};

function Connection() {
  const [t, setT] = useState<Load<Trace>>({ state: "loading" });
  useEffect(() => {
    let on = true;
    fetch("/cdn-cgi/trace", { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("no trace"))))
      .then((text) => { const p = parseTrace(text); if (on) setT(p ? { state: "ok", data: p } : { state: "error" }); })
      .catch(() => { if (on) setT({ state: "error" }); });
    return () => { on = false; };
  }, []);
  return (
    <section className={s.panel} aria-labelledby="conn-h">
      <div className={s.eyebrow}>Connection</div>
      <h2 id="conn-h">How your browser is connected right now</h2>
      {t.state === "loading" && <p className={s.muted}>Reading…</p>}
      {t.state === "error" && (
        <p className={s.muted}>
          Not available on this server. The hosted Q-Lab is served through Cloudflare, which reports the connection at
          /cdn-cgi/trace; a self-hosted or local install doesn&apos;t have that.
        </p>
      )}
      {t.state === "ok" && (
        <>
          <dl className={s.readings}>
            <div className={s.reading}><dt>Key exchange</dt><dd>{t.data.kex || "not reported"}</dd></div>
            <div className={s.reading}><dt>TLS / HTTP</dt><dd>{[t.data.tls, t.data.http].filter(Boolean).join(" · ") || "not reported"}</dd></div>
          </dl>
          <p>{t.data.kex ? (KEX[t.data.kex] ? `Your connection uses ${KEX[t.data.kex]}` : `Your browser and the server agreed on ${t.data.kex}.`) : "The key exchange was not reported."}</p>
          <p className={s.muted}>Reported by Cloudflare&apos;s edge for this exact connection (a same-site request to /cdn-cgi/trace). It depends on your browser: recent Chrome, Edge and Firefox offer the post-quantum hybrid.</p>
        </>
      )}
    </section>
  );
}

// ── Every request this page made ──
type Req = { url: string; type: string; bytes: number; kind: "site" | "api" | "other" };

function Requests() {
  const [reqs, setReqs] = useState<Req[]>([]);
  useEffect(() => {
    const toReq = (e: PerformanceEntry): Req => {
      const r = e as PerformanceResourceTiming;
      const u = new URL(r.name, location.href);
      const kind = u.origin === location.origin ? "site" : u.origin === apiOrigin ? "api" : "other";
      return { url: kind === "site" ? u.pathname + u.search : r.name, type: r.initiatorType, bytes: r.transferSize, kind };
    };
    if (typeof PerformanceObserver === "undefined") return;
    // buffered: the observer first delivers everything already recorded (the page itself and the
    // files it loaded), then each new request as it happens.
    const add = (list: PerformanceObserverEntryList) => setReqs((prev) => [...prev, ...list.getEntries().map(toReq)]);
    const nav = new PerformanceObserver(add);
    const res = new PerformanceObserver(add);
    nav.observe({ type: "navigation", buffered: true });
    res.observe({ type: "resource", buffered: true });
    return () => { nav.disconnect(); res.disconnect(); };
  }, []);
  const other = reqs.filter((r) => r.kind === "other");
  const hosts = [...new Set(other.map((r) => { try { return new URL(r.url).host; } catch { return r.url; } }))];
  return (
    <section className={s.panel} aria-labelledby="req-h">
      <div className={s.eyebrow}>Requests</div>
      <h2 id="req-h">Every request this page has made</h2>
      <p role="status">
        {reqs.length} so far,{" "}
        <strong className={other.length ? s.bad : s.ok}>{other.length} to another site</strong>
        {other.length ? ` (${hosts.join(", ")})` : ""}. The list comes from your browser&apos;s own record of this page&apos;s
        network activity and updates live. Your browser&apos;s developer tools (Network tab) show the same thing.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Address</th><th>Type</th><th>Bytes</th></tr></thead>
          <tbody>
            {reqs.map((r, i) => (
              <tr key={i} className={r.kind === "other" ? s.third : undefined}>
                <td className={s.url}>{r.url}{r.kind === "api" ? " (Q-Lab backend)" : ""}</td>
                <td>{r.type}</td>
                <td>{r.bytes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.muted}>A size of 0 means the file came from the browser cache, or the server didn&apos;t allow its size to be reported.</p>
    </section>
  );
}

// ── The CSP this server actually sent ──
const DIRECTIVE_HELP: Record<string, string> = {
  "default-src": "Anything not listed below may only come from this site.",
  "script-src": "Where code may come from.",
  "style-src": "Where styles may come from.",
  "font-src": "Where fonts may come from.",
  "img-src": "Where images may come from (data: and blob: are images built in the page itself).",
  "connect-src": "Who the page may send requests to.",
  "media-src": "Where video and audio may come from.",
  "worker-src": "Where background workers (the offline helper) may come from.",
  "manifest-src": "Where the app manifest may come from.",
  "frame-src": "Which pages may be embedded inside this one.",
  "object-src": "Plugins (Flash and the like).",
  "base-uri": "Whether a page may change the base address links are resolved against.",
  "form-action": "Where forms may be sent.",
  "frame-ancestors": "Which sites may embed Q-Lab.",
};

function explainSource(src: string): string {
  if (src === "'self'") return "this site";
  if (src === "'none'") return "nothing";
  if (src === "'unsafe-inline'") return "code written into the page itself";
  if (src === "'unsafe-eval'") return "code generated at run time";
  if (src === "data:" || src === "blob:") return src;
  if (apiOrigin && src.startsWith(apiOrigin)) return `${src} (the Q-Lab backend)`;
  return `${src} (another site)`;
}

function Policy() {
  const [csp, setCsp] = useState<Load<string>>({ state: "loading" });
  useEffect(() => {
    let on = true;
    fetch(location.pathname, { method: "HEAD", cache: "no-store" })
      .then((r) => { const v = r.headers.get("content-security-policy"); if (on) setCsp(v ? { state: "ok", data: v } : { state: "error" }); })
      .catch(() => { if (on) setCsp({ state: "error" }); });
    return () => { on = false; };
  }, []);
  const directives = csp.state === "ok"
    ? csp.data.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...src] = d.split(/\s+/); return { name, src }; })
    : [];
  const outside = directives.flatMap((d) => d.src).filter((x) => /^(https?:|wss?:|\*)/.test(x) && !(apiOrigin && x.startsWith(apiOrigin)));
  return (
    <section className={s.panel} aria-labelledby="csp-h">
      <div className={s.eyebrow}>Rules</div>
      <h2 id="csp-h">The rules your browser enforces on Q-Lab</h2>
      <p>
        Every page is sent with a Content-Security-Policy: a list of where the page may load things from and who it may
        talk to. Your browser enforces it, so even a mistake in Q-Lab&apos;s code couldn&apos;t load a tracker from another site.
        This is the policy this server sent just now:
      </p>
      {csp.state === "loading" && <p className={s.muted}>Reading the response headers…</p>}
      {csp.state === "error" && <p className={s.warn}>This server didn&apos;t send a policy with this page (a development server may not).</p>}
      {csp.state === "ok" && (
        <>
          <p className={outside.length ? s.bad : s.ok}>
            {outside.length ? `It allows other sites: ${outside.join(", ")}.` : "It allows no other site."}
          </p>
          <dl className={s.csp}>
            {directives.map((d) => (
              <div key={d.name}>
                <dt>{d.name}</dt>
                <dd>{DIRECTIVE_HELP[d.name] ?? ""} Allowed: <code>{d.src.map(explainSource).join(", ") || "nothing"}</code>.</dd>
              </div>
            ))}
          </dl>
          <p className={s.muted}>
            One honest limit: scripts written into the page itself are allowed (&lsquo;unsafe-inline&rsquo;), because Next.js,
            the framework Q-Lab uses, puts each page&apos;s data in small inline scripts. That doesn&apos;t let anything reach
            another site: where requests may go is controlled by connect-src and the other rules above.
          </p>
        </>
      )}
      <p className={s.muted}>
        Q-Lab also does not record which pages you look at, uses no analytics or advertising code, and sends no
        referrer to other sites when you follow a link. A check in Q-Lab&apos;s test suite (scripts/check-no-third-party.mjs)
        fails if this policy ever allows another site, if the code loads anything from another site, or if an analytics
        package is added.
      </p>
    </section>
  );
}

// ── Deploy log ──
type Deploy = { commit: string; commit_time?: string; time?: string; run_url?: string; tree_sha256?: string };
type Deploys = { available: boolean; entries?: Deploy[]; reason?: string; source: string };
const isDeploys = (d: unknown): d is Deploys => !!d && typeof d === "object" && typeof (d as Deploys).available === "boolean";

function DeployLog() {
  const log = useJson<Deploys>(qlabApiPath("/api/v1/public/deploys"), isDeploys);
  return (
    <section className={s.panel} aria-labelledby="log-h">
      <div className={s.eyebrow}>Deploys</div>
      <h2 id="log-h">Every deploy, in a public log</h2>
      <p>
        Each time code is merged into main (which the hosted Q-Lab deploys), GitHub Actions appends a line to a public,
        append-only log on the repository&apos;s <span className={s.mono}>transparency</span> branch: the commit, when it was
        made, when it was logged, and a link to the run that logged it. The history of that branch is itself public, so
        rewriting an entry would show.
      </p>
      {log.state === "loading" && <p className={s.muted}>Reading the log…</p>}
      {log.state === "error" && <p className={s.warn}>The backend didn&apos;t answer, so the log can&apos;t be shown right now.</p>}
      {log.state === "ok" && !log.data.available && (
        <p className={s.muted}>No entries to show yet. {log.data.reason ?? "The log isn't available."}</p>
      )}
      {log.state === "ok" && log.data.available && (
        <>
          <p className={s.muted}>{log.data.entries?.length ?? 0} deploys logged. Newest first.{" "}
            {FRONTEND_COMMIT && log.data.entries?.some((e) => e.commit === FRONTEND_COMMIT)
              ? <span className={s.ok}>The commit this page runs is in the log.</span>
              : FRONTEND_COMMIT ? <span className={s.warn}>The commit this page runs isn&apos;t in the log (yet).</span> : null}
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Logged (UTC)</th><th>Commit</th><th>Committed</th><th>Build digest</th><th>Record</th></tr></thead>
              <tbody>
                {(log.data.entries ?? []).map((e) => (
                  <tr key={`${e.commit}-${e.time}`}>
                    <td>{(e.time ?? "").replace("T", " ").replace("Z", "")}</td>
                    <td><Commit sha={e.commit} />{e.commit === FRONTEND_COMMIT ? " (this page)" : ""}</td>
                    <td>{(e.commit_time ?? "").replace("T", " ").replace("Z", "")}</td>
                    <td title={e.tree_sha256}>{e.tree_sha256 ? e.tree_sha256.slice(0, 12) : "—"}</td>
                    <td>{e.run_url ? <a className={s.link} href={e.run_url} rel="noreferrer">workflow run</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className={s.muted}>
        The Q-Lab server fetches the log from GitHub and passes it on, so this page itself never contacts GitHub.{" "}
        <a className={s.link} href={log.state === "ok" ? log.data.source : `${SOURCE_REPO}/tree/transparency`} rel="noreferrer">Read the log on GitHub</a>.
      </p>
    </section>
  );
}

function Reproducible() {
  return (
    <section className={s.panel} aria-labelledby="rep-h">
      <div className={s.eyebrow}>Rebuild</div>
      <h2 id="rep-h">You can rebuild the dashboard and get the same bytes</h2>
      <p>
        The dashboard&apos;s build is reproducible: building one commit twice, on two separate machines in different folders,
        gives byte-identical files. Q-Lab&apos;s checks do exactly that for every change to the dashboard and fail if a single byte differs.
        The deploy log above records the build&apos;s digest for each deployed commit.
      </p>
      <p>To check it yourself (Node 20, from a clone of the repository):</p>
      <pre className={s.mono} style={{ margin: 0, padding: "10px 12px", background: "var(--code-bg)", color: "var(--code-text)", borderRadius: 6, overflowX: "auto", whiteSpace: "pre" }}>
{`git checkout ${FRONTEND_COMMIT ?? "<commit>"}
cd frontend && npm ci && npm run build
node scripts/trust/hash-tree.mjs --digest`}
      </pre>
      <p className={s.muted}>
        The digest covers everything the dashboard serves and renders from (.next/static and .next/server), except three
        files of secrets that Next.js generates fresh for each build and never sends to a browser. It shows that the
        published source produces this build; whether the hosting platform deployed exactly that build is outside what a
        web page can prove.
      </p>
    </section>
  );
}

function Limits() {
  return (
    <section className={s.panel} aria-labelledby="lim-h">
      <div className={s.eyebrow}>Limits</div>
      <h2 id="lim-h">What this shows, and what it doesn&apos;t</h2>
      <ul className={s.list}>
        <li><strong>Shown:</strong> which commit each half of Q-Lab says it runs, with the source one click away.</li>
        <li><strong>Shown:</strong> every request this page made, as your own browser recorded it, and the rules your browser enforces on every Q-Lab page.</li>
        <li><strong>Shown:</strong> a public log of every deploy of main, kept by GitHub Actions rather than by the Q-Lab server.</li>
        <li><strong>Not proven:</strong> that the server really runs the commit it reports. The commit comes from the hosting platform (Render), which you have to trust for that. Self-hosting from a release you checked is the way to remove that trust: releases are signed (see SECURITY.md in the repository).</li>
        <li><strong>Not covered:</strong> what happens to data after it reaches the server. That is set out in the source code, not proven by this page.</li>
      </ul>
    </section>
  );
}

export default function TrustView() {
  return (
    <div className={s.page}>
      <main className={s.wrap}>
        <div className={s.top}>
          <Link href="/" className={s.brand}>Q-LAB</Link>
          <Link href="/runs" className={s.back}>Back to your runs</Link>
        </div>
        <div>
          <div className={s.eyebrow}>Trust</div>
          <h1 className={s.h1}>What this Q-Lab runs, and what it loads</h1>
        </div>
        <p className={s.lead}>
          You don&apos;t have to take our word for how Q-Lab behaves. This page shows the exact code that is running, checkable
          on GitHub, and every request your browser has made for it, as your browser saw them.
        </p>
        <CodeRunning />
        <Requests />
        <Policy />
        <Connection />
        <DeployLog />
        <Reproducible />
        <Limits />
      </main>
    </div>
  );
}
