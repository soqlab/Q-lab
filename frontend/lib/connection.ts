"use client";

import { useEffect, useState } from "react";

/**
 * Your connection, right now: which key exchange this browser and Q-Lab agreed on.
 * Cloudflare, in front of the hosted Q-Lab, answers /cdn-cgi/trace on this origin (connect-src
 * 'self') with key=value lines. That answer also carries the visitor's IP address: only the kex=
 * line is read, and nothing from it is shown beyond the algorithm name, kept or sent anywhere.
 * Where the path does not exist (a self-hosted install, local development) the answer is null and
 * nothing is shown.
 */
export type Connection = { kex: string; pq: boolean };

export function parseTrace(text: string): Connection | null {
  const m = /^kex=([A-Za-z0-9_-]{1,40})\r?$/m.exec(text);
  if (!m) return null;
  return { kex: m[1], pq: /mlkem|kyber/i.test(m[1]) };
}

export function connectionSentence(c: Connection): string {
  return c.pq
    ? `You're connected to Q-Lab with ${c.kex} — quantum-safe key exchange.`
    : `You're connected to Q-Lab with ${c.kex} — classical. Try a current Chrome, Edge, Firefox or Safari.`;
}

// One request per page load, shared by every component that shows the line.
let once: Promise<Connection | null> | null = null;
function readConnection(): Promise<Connection | null> {
  once ??= fetch("/cdn-cgi/trace", { cache: "no-store", credentials: "omit" })
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").startsWith("text/plain") ? r.text() : ""))
    .then(parseTrace)
    .catch(() => null);
  return once;
}

/** null until known, and null for good where the edge does not report it. */
export function useConnection(): Connection | null {
  const [c, setC] = useState<Connection | null>(null);
  useEffect(() => {
    let live = true;
    readConnection().then((v) => { if (live) setC(v); });
    return () => { live = false; };
  }, []);
  return c;
}
