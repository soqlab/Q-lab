"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useState } from "react";
import { qlabApiPath } from "../../../lib/api";
import { certFileName, checkSentence, type CertDoc, type CertState } from "../../../lib/certificate";
import { DETAILS, DETAIL_LABEL, useDetail, useDetailSync } from "../../../lib/dial";
import {
  BadgeSnippets, CertificateBody, CheckFrame, LevelSentence, OfflineCheck, useBrowserCheck,
} from "../../../components/CertificateView";
import s from "../../landing.module.css";

/*
 * A shared run's public verification page: did independent re-runs agree, and is its provenance
 * certificate genuine (checked here, in the visitor's browser). It exists only while the run is
 * shared; the badge on papers links here.
 */

type Verified = {
  token: string; state: CertState; sentence: string; sentences: { plain: string; standard: string; expert: string };
  run: { run_id: string; circuit_name: string | null; backend: string | null; created_at: string | null; shots: number | null; share_page: string };
  badge: { text: string; svg_path: string };
  certificate: CertDoc;
};

const COLOR: Record<CertState, string> = {
  reproduced: "var(--ok)", mixed: "var(--warn)", not_reproduced: "var(--danger)", not_yet: "var(--muted)",
};

function Dial() {
  const [d, setD] = useDetail();
  return (
    <div className="dial" role="group" aria-label="How technical">
      {DETAILS.map((x) => (
        <button key={x} type="button" aria-pressed={d === x} onClick={() => setD(x)}>{DETAIL_LABEL[x]}</button>
      ))}
    </div>
  );
}

export default function VerifiedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  useDetailSync(usePathname() || "/verified");
  const [v, setV] = useState<{ token: string; state: "ok" | "gone" | "error"; data?: Verified } | null>(null);

  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/public/verified/${encodeURIComponent(token)}`), { cache: "no-store" })
      .then(async (r) => {
        if (!on) return;
        if (r.status === 404 || r.status === 410) return setV({ token, state: "gone" });
        if (!r.ok) return setV({ token, state: "error" });
        setV({ token, state: "ok", data: (await r.json()) as Verified });
      })
      .catch(() => { if (on) setV({ token, state: "error" }); });
    return () => { on = false; };
  }, [token]);

  const d = v?.token === token ? v.data : undefined;
  const check = useBrowserCheck(d?.certificate);
  const verified = check?.status === "done" && check.verdict.valid && (!check.publishedKey || check.publishedKey === check.verdict.key_id);

  return (
    <div className={s.root}>
      <header className={s.bar}>
        <Link href="/" className={s.word}>Q-LAB</Link>
        <span className={s.host}>verified run</span>
        <nav className={s.links} aria-label="Q-Lab">
          <Dial />
          <Link href="/certificate">Check a certificate</Link>
          {d && <Link href={d.run.share_page} className={s.primary}>Open the run</Link>}
        </nav>
      </header>
      <main className={s.main}>
        {!v || v.token !== token ? (
          <p className="summary-line">Loading…</p>
        ) : v.state === "gone" ? (
          <p className="summary-line">This verification page doesn&apos;t exist: the run isn&apos;t shared, or its owner turned sharing off.</p>
        ) : v.state === "error" || !d ? (
          <p className="summary-line">This page couldn&apos;t be loaded right now.</p>
        ) : (
          <>
            <section aria-label="Answer" style={{ borderLeft: `3px solid ${COLOR[d.state]}`, paddingLeft: 14, display: "grid", gap: 8 }}>
              <p className="summary-line" style={{ margin: 0, fontSize: 18 }}>
                <LevelSentence s={d.sentences} />{" "}
                <span style={{ color: verified ? "var(--ok)" : check?.status === "checking" ? "var(--muted)" : "var(--danger)" }}>{checkSentence(check)}</span>
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/verified/${encodeURIComponent(token)}/badge.svg`} alt={`Q-Lab: ${d.badge.text}`} height={20} />
                <span>{d.run.circuit_name || d.run.run_id.slice(0, 16)} on <span className="mono">{d.run.backend ?? "an unrecorded machine"}</span>{d.run.created_at ? `, ${d.run.created_at.slice(0, 10)}` : ""}</span>
              </div>
            </section>

            <CheckFrame check={check} doc={d.certificate} />
            <CertificateBody doc={d.certificate} />
            <BadgeSnippets token={token} state={d.state} badgeText={d.badge.text} />

            <section className="frame" aria-labelledby="dl-h">
              <div className="frame-head"><h2 id="dl-h" className="inst-label">Keep a copy</h2></div>
              <div className="frame-body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a className="button" href={qlabApiPath(`/api/v1/public/verified/${encodeURIComponent(token)}/certificate?download=1`)}>Download the certificate (.json)</a>
                <Link className="button secondary" href={d.run.share_page}>The shared run</Link>
              </div>
            </section>
            <OfflineCheck fileName={certFileName(d.run.run_id)} keyId={d.certificate.signature?.key ?? null} />

            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: "80ch" }}>
              What this does not show: that the counts came from the machine named. The certificate states what Q-Lab recorded and how re-runs compared;
              a re-run is judged against shot noise with the same test Q-Lab uses for drift. Re-runs by other accounts count only when their owners shared them.
            </p>
          </>
        )}
      </main>
      <footer className={s.foot}>
        <Link href="/trust">What this Q-Lab runs and loads</Link>
        <a href="https://github.com/soqlab/Q-lab" rel="noreferrer">Source</a>
      </footer>
    </div>
  );
}
