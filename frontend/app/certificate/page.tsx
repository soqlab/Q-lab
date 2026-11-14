"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { certFileName, checkSentence, type CertDoc } from "../../lib/certificate";
import { useDetailSync } from "../../lib/dial";
import { CertificateBody, CheckFrame, LevelSentence, OfflineCheck, useBrowserCheck } from "../../components/CertificateView";
import s from "../landing.module.css";

/*
 * Check a provenance certificate someone gave you. The file is read and checked in this browser;
 * it is not uploaded anywhere.
 */
export default function CheckCertificatePage() {
  useDetailSync(usePathname() || "/certificate");
  const [doc, setDoc] = useState<CertDoc | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const check = useBrowserCheck(doc);

  function load(text: string) {
    setProblem(null);
    try {
      const d = JSON.parse(text) as CertDoc;
      if (!d || typeof d !== "object" || !d.certificate) throw new Error("not a Q-Lab certificate");
      setDoc(d);
    } catch (e) {
      setDoc(null);
      setProblem(`That isn't a certificate: ${e instanceof Error ? e.message : "unreadable"}.`);
    }
  }

  return (
    <div className={s.root}>
      <header className={s.bar}>
        <Link href="/" className={s.word}>Q-LAB</Link>
        <span className={s.host}>check a certificate</span>
        <nav className={s.links} aria-label="Q-Lab"><Link href="/trust">Trust</Link></nav>
      </header>
      <main className={s.main}>
        <p className="summary-line" style={{ margin: 0 }}>
          {doc ? <><LevelSentence s={doc.certificate.reproduction?.sentences ?? { plain: "", standard: "", expert: "" }} /> {checkSentence(check)}</>
            : problem ?? "Choose a Q-Lab provenance certificate (.json). It is checked in this browser and not uploaded."}
        </p>
        <section className="frame" aria-labelledby="pick-h">
          <div className="frame-head"><h2 id="pick-h" className="inst-label">Certificate file</h2></div>
          <div className="frame-body">
            <input type="file" accept="application/json,.json" aria-label="Certificate file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(load); }} />
          </div>
        </section>
        {doc && <CheckFrame check={check} doc={doc} />}
        {doc && check?.status === "done" && (
          <>
            <CertificateBody doc={doc} />
            <OfflineCheck fileName={certFileName(doc.certificate.run?.run_id ?? "run")} keyId={doc.signature?.key ?? null} />
          </>
        )}
      </main>
      <footer className={s.foot}>
        <Link href="/trust">What this Q-Lab runs and loads</Link>
      </footer>
    </div>
  );
}
