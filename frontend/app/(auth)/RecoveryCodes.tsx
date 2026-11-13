"use client";

import { useState } from "react";
import s from "./auth.module.css";

/** A set of recovery codes, shown once: copy, download as text, and confirm they are saved. */
export default function RecoveryCodes({ codes, onSaved, savedLabel = "Continue" }: {
  codes: string[];
  onSaved?: () => void;
  savedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = [
    "Q-Lab recovery codes",
    `Made ${new Date().toISOString().slice(0, 10)}. Each code works once. A new set cancels these.`,
    "Use one at /recover if you can't sign in with a passkey.",
    "",
    ...codes,
    "",
  ].join("\n");

  function copy() {
    void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "q-lab-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <ol className={s.codes} aria-label="Recovery codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className={s.row}>
        <button type="button" className={s.secondary} onClick={copy}>{copied ? "Copied" : "Copy all"}</button>
        <button type="button" className={s.secondary} onClick={download}>Download .txt</button>
      </div>
      {onSaved && (
        <>
          <label className={s.check}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved these codes somewhere other than this device.</span>
          </label>
          <button type="button" className={s.primary} disabled={!saved} onClick={onSaved}>{savedLabel}</button>
        </>
      )}
    </div>
  );
}
