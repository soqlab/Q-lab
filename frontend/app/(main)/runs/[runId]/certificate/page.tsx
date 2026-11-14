"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { fetchRun, qlabApiPath, type QLabRun } from "../../../../../lib/api";
import { badgeTextFor, certFileName, checkSentence, shareTokenOf, type CertDoc } from "../../../../../lib/certificate";
import { downloadFromApi } from "../../../../../components/ReproduceRun";
import {
  BadgeSnippets, CertificateBody, CheckFrame, LevelSentence, OfflineCheck, useBrowserCheck,
} from "../../../../../components/CertificateView";

/*
 * A run's provenance certificate, for its owner: what is certified, checked in this browser, the
 * file to download and, once the run is shared, the badge and snippets for a paper.
 */
export default function CertificatePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [st, setSt] = useState<{ id: string; doc?: CertDoc; run?: QLabRun; error?: string } | null>(null);

  useEffect(() => {
    let on = true;
    Promise.all([
      fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/certificate`), { cache: "no-store" })
        .then(async (r) => { if (!r.ok) throw new Error(r.status === 404 ? "This run isn't one you can open." : `The certificate couldn't be made (${r.status}).`); return (await r.json()) as CertDoc; }),
      fetchRun(runId).catch(() => undefined),
    ])
      .then(([doc, run]) => { if (on) setSt({ id: runId, doc, run }); })
      .catch((e) => { if (on) setSt({ id: runId, error: e instanceof Error ? e.message : "Failed to load" }); });
    return () => { on = false; };
  }, [runId]);

  const cur = st?.id === runId ? st : null;
  const doc = cur?.doc;
  const check = useBrowserCheck(doc);
  const token = shareTokenOf(cur?.run?.share_page_url);

  if (!cur) return <main className="page"><div className="empty">Issuing the certificate…</div></main>;
  if (cur.error || !doc) return <main className="page"><div className="empty">{cur.error}</div></main>;
  const rep = doc.certificate.reproduction;

  return (
    <main className="page" style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link className="button secondary" href={`/runs/${encodeURIComponent(runId)}`} style={{ height: 34 }}>
          <ArrowLeft size={15} aria-hidden="true" /> The run
        </Link>
        <button className="button" type="button" style={{ height: 34 }}
          onClick={() => { void downloadFromApi(`/api/v1/runs/${encodeURIComponent(runId)}/certificate?download=1`, certFileName(runId)); }}>
          <Download size={15} aria-hidden="true" /> Certificate (.json)
        </button>
        {token && <Link className="button secondary" href={`/verified/${token}`} style={{ height: 34 }}>Public verification page</Link>}
      </div>

      <p className="summary-line" style={{ margin: 0 }}>
        <LevelSentence s={rep.sentences} /> {checkSentence(check)}
      </p>

      <CheckFrame check={check} doc={doc} />
      {token ? (
        <BadgeSnippets token={token} state={rep.state} badgeText={badgeTextFor(rep)} />
      ) : (
        <section className="frame" id="badge" aria-labelledby="badge-h">
          <div className="frame-head"><h2 id="badge-h" className="inst-label">Badge for your paper</h2></div>
          <div className="frame-body" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            The badge and its public verification page exist only while the run is shared. Share it from the run&apos;s Actions menu
            (<Link href={`/runs/${encodeURIComponent(runId)}`} style={{ textDecoration: "underline" }}>open the run</Link>), then come back here for the Markdown, HTML and LaTeX.
            Turning sharing off later takes the page and the badge down.
          </div>
        </section>
      )}
      <CertificateBody doc={doc} />
      <OfflineCheck fileName={certFileName(runId)} keyId={doc.signature?.key ?? null} />
    </main>
  );
}
