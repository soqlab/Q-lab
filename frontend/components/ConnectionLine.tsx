"use client";

import { connectionSentence, useConnection } from "../lib/connection";

/** One line naming this browser's key exchange with Q-Lab; renders nothing where it can't be read. */
export default function ConnectionLine({ className }: { className?: string }) {
  const c = useConnection();
  if (!c) return null;
  return <span className={className} data-pq={c.pq ? "yes" : "no"}>{connectionSentence(c)}</span>;
}
