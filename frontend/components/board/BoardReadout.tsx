"use client";

import Link from "next/link";
import styles from "./board.module.css";
import { ago, fint, fx, latestBy, summarize, useBoard } from "./data";

/**
 * A compact hardware board: each IBM machine's state, queue and latest Bell-pair fidelity.
 * Works signed out (the board API is public). Says plainly when there is nothing to show.
 * `href` is where the machine names and the footer link go (the full board needs sign-in).
 */
export default function BoardReadout({ href = "/hardware", limit = 6 }: { href?: string; limit?: number }) {
  const s = useBoard();

  if (s.state === "loading") return <div className={styles.mini} aria-busy="true"><span className={styles.miniSrc}>Reading IBM Quantum…</span></div>;
  if (s.state === "error") return <div className={styles.mini}><span className={styles.miniSrc}>The hardware board is unavailable right now.</span></div>;

  const b = s.data;
  if (!b.configured) {
    return <div className={styles.mini}><span className={styles.miniSrc}>No quantum computer connected to this server yet.</span></div>;
  }
  const latest = latestBy(b.runs, b.benchmark.version);
  const live = b.live.backends;
  const names = [...new Set([...live.map((x) => x.name), ...latest.keys()])].sort().slice(0, limit);

  return (
    <div className={styles.mini}>
      <p className="summary-line" style={{ fontSize: 13.5 }}>{summarize(b)}</p>
      {b.simulated && <span className={styles.simBadge}>SIMULATED preview, not real hardware</span>}
      {names.length > 0 && (
        <div role="table" aria-label="IBM quantum computers">
          <div role="row" className={styles.miniRow}>
            <span role="columnheader" className="inst-label">Machine</span>
            <span role="columnheader" className="inst-label" style={{ textAlign: "right" }}>Queue</span>
            <span role="columnheader" className="inst-label" style={{ textAlign: "right" }}>Bell fidelity</span>
          </div>
          {names.map((n) => {
            const m = live.find((x) => x.name === n);
            const bell = latest.get(n)?.get("bell");
            return (
              <div role="row" key={n} className={`${styles.miniRow}${bell && s.arrived.has(bell.run_id) ? " arrived" : ""}`}>
                <span role="cell" className={styles.miniName}>
                  <span className={`dot ${m ? (m.operational ? "ok" : "bad") : ""}`} aria-label={m ? (m.operational ? "online" : "offline") : "no live reading"} />
                  <Link href={`${href}/${encodeURIComponent(n)}`}>{n}</Link>
                </span>
                <span role="cell" className="num" style={{ textAlign: "right" }}>{fint(m?.pending_jobs)}</span>
                <span role="cell" className="num" style={{ textAlign: "right" }}>
                  {bell ? <a href={`/share/${encodeURIComponent(bell.share_token)}`} title={`measured ${ago(bell.created_at)}`}>{fx(bell.hellinger, 2)}</a> : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <span className={styles.miniSrc}>
        Live from IBM Quantum{b.live.fetched_at ? `, read ${ago(b.live.fetched_at)}` : ""}. <Link href={href}>Full board →</Link>
      </span>
    </div>
  );
}
