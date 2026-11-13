"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { qlabApiPath } from "../../lib/api";
import s from "../landing.module.css";

interface GalleryRun {
  share_token: string; circuit_name: string; backend: string | null;
  status: string; health_score: number | null; on_expected: number | null; qubits: number | null;
  depth: number | null; project: string | null; created_at: string | null;
}

const PAGE = 50;

function Gallery() {
  const params = useSearchParams();
  const router = useRouter();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const [data, setData] = useState<{ page: number; total: number; items: GalleryRun[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/public/gallery?limit=${PAGE}&offset=${(page - 1) * PAGE}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (on) { setData({ page, total: d.total ?? 0, items: d.items ?? [] }); setFailed(false); } })
      .catch(() => { if (on) setFailed(true); });
    return () => { on = false; };
  }, [page]);

  const ready = !!data && data.page === page;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const go = (p: number) => router.push(p > 1 ? `/gallery?page=${p}` : "/gallery");

  return (
    <div className={s.root}>
      <header className={s.bar}>
        <Link href="/" className={s.word}>Q-LAB</Link>
        <span className={s.host}>public runs</span>
        <nav className={s.links} aria-label="Q-Lab">
          <Link href="/trust">Trust</Link>
          <Link href="/login" className={s.primary}>Sign in</Link>
        </nav>
      </header>
      <main className={s.main}>
        <p className="summary-line">
          {failed ? "The list of public runs couldn't be loaded. The server may be starting up; try again in 30 seconds."
            : !ready || !data ? "Loading public runs…"
            : data.total === 0 ? "Nobody has shared a run yet. A run appears here when its owner presses Share on it."
            : `${data.total.toLocaleString("en-US")} run${data.total === 1 ? " is" : "s are"} shared publicly on this server, newest first. Each opens with its circuit, results and calibration.`}
        </p>
        {ready && data && data.items.length > 0 && (
          <section className="frame">
            <div className="frame-head">
              <span className="inst-label">Page {page} of {pages}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, data.total)} of {data.total}</span>
            </div>
            <div className="table-wrap">
              <table className={s.table}>
                <thead><tr><th>Circuit</th><th>Backend</th><th>Status</th><th className={s.r}>Qubits</th><th className={s.r}>Depth</th><th className={s.r} title="Share of shots that landed on outcomes the noise-free circuit can produce">On expected outcomes</th><th className={s.r}>Date</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.share_token}>
                      <td><Link href={`/share/${encodeURIComponent(r.share_token)}`} className={s.run}>{r.circuit_name}</Link>{r.project && <span className={s.proj}>{r.project}</span>}</td>
                      <td className="mono">{r.backend ?? "—"}</td>
                      <td>{r.status}</td>
                      <td className={`num ${s.r}`}>{r.qubits ?? "—"}</td>
                      <td className={`num ${s.r}`}>{r.depth ?? "—"}</td>
                      <td className={`num ${s.r}`}>{r.on_expected != null ? `${(r.on_expected * 100).toFixed(1)}%` : "—"}</td>
                      <td className={`num ${s.r}`}>{r.created_at ? r.created_at.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {ready && pages > 1 && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="button secondary" disabled={page <= 1} onClick={() => go(page - 1)}>Newer</button>
            <button className="button secondary" disabled={page >= pages} onClick={() => go(page + 1)}>Older</button>
          </div>
        )}
      </main>
      <footer className={s.foot}>
        <span>On expected outcomes: the share of shots that landed on results the noise-free circuit can produce; — when the circuit can&apos;t be simulated exactly</span>
        <Link href="/">Q-Lab home</Link>
      </footer>
    </div>
  );
}

export default function GalleryPage() {
  return <Suspense fallback={null}><Gallery /></Suspense>;
}
