"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import s from "./auth.module.css";

/** How many runs people have shared publicly, straight from the public gallery. null until known. */
function usePublicRunCount(): number | null | "unavailable" {
  const [n, setN] = useState<number | null | "unavailable">(null);
  useEffect(() => {
    let live = true;
    fetch("/qlab-api/api/v1/public/gallery?limit=1", { cache: "no-store", credentials: "omit" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { total?: unknown }) => { if (live) setN(typeof d.total === "number" ? d.total : "unavailable"); })
      .catch(() => { if (live) setN("unavailable"); });
    return () => { live = false; };
  }, []);
  return n;
}

/**
 * The frame every sign-in page sits in: the Q-Lab mark, one bordered panel with a mono caption,
 * optional links under it, and one real reading from the public gallery (a dash if it can't be read).
 */
export default function AuthFrame({ caption, aside, children, links }: {
  caption: string;
  aside?: ReactNode;
  children: ReactNode;
  links?: ReactNode;
}) {
  const shared = usePublicRunCount();
  return (
    <main className={s.shell}>
      <div className={s.wrap}>
        <div className={s.mark}>
          <Link href="/">Q-LAB</Link>
          <span>Quantum experiment tracker</span>
        </div>
        <section className={s.frame} aria-label={caption}>
          <div className={s.head}><span>{caption}</span>{aside}</div>
          <div className={s.body}>{children}</div>
          {links && <div className={s.links}>{links}</div>}
        </section>
        <p className={s.readout}>
          <span>
            Runs shared publicly{" "}
            <b>{shared === null ? "…" : shared === "unavailable" ? "—" : shared.toLocaleString("en-US")}</b>
          </span>
          <span className={s.readoutLinks}>
            <Link href="/gallery">Open the gallery</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </span>
        </p>
      </div>
    </main>
  );
}
