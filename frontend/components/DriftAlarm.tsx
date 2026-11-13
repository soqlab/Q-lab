"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { qlabApiPath } from "../lib/api";
import { useDetail, withDetail, type Detail } from "../lib/dial";

/*
 * The drift alarm (backend/app/drift.py): the same circuit ran before on the same machine, and the
 * result moved more than shot noise explains. The sentence says whether the code or the machine
 * changed. Wording comes from the server at the dial's level.
 */

export type DriftChange = { text: string; values?: string; worse?: boolean; label?: string; a?: string; b?: string };
export type Drift = {
  run_id: string; level: Detail; state: "no_previous" | "cant_test" | "steady" | "drifted";
  sentence: string | null; reason?: string;
  verdict?: "hardware" | "code" | "both" | "unexplained" | "unknown" | null;
  previous?: { run_id: string; backend: string | null; created_at: string | null };
  shift?: { tvd: number; expected_tvd: number; noise_95: number; p_value: number; shots: { a: number; b: number } } | null;
  code?: { changed: boolean; changes: DriftChange[] } | null;
  hardware?: { available: boolean; changes: DriftChange[]; calibrated: { a: string | null; b: string | null } } | null;
};

export function useDrift(runId: string | null): Drift | null {
  const [detail] = useDetail();
  const [v, setV] = useState<{ key: string; d: Drift | null } | null>(null);
  const key = `${runId}|${detail}`;
  useEffect(() => {
    if (!runId) return;
    let on = true;
    fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/drift?level=${detail}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Drift | null) => { if (on) setV({ key, d }); })
      .catch(() => { if (on) setV({ key, d: null }); });
    return () => { on = false; };
  }, [runId, detail, key]);
  return v && v.key === key ? v.d : null;
}

const VERDICT: Record<string, string> = {
  hardware: "the machine changed", code: "your side changed", both: "both changed",
  unexplained: "not in the records", unknown: "machine unknown",
};

/** One line under the answer: loud when the result moved, quiet when it held, absent otherwise. */
export function DriftLine({ runId, drift }: { runId: string; drift?: Drift | null }) {
  const own = useDrift(drift === undefined ? runId : null);
  const d = drift === undefined ? own : drift;
  const [detail] = useDetail();
  if (!d || !d.sentence || d.state === "no_previous") return null;
  if (d.state !== "drifted") {
    return <p className="d-standard" style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>{d.sentence}</p>;
  }
  const changes = [...(d.code?.changes ?? []), ...(d.hardware?.changes ?? [])];
  return (
    <div role="status" style={{ borderLeft: "3px solid var(--warn)", padding: "6px 0 6px 12px", display: "grid", gap: 6 }}>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
        <span className="inst-label" style={{ color: "var(--warn)", marginRight: 8 }}>Drift{d.verdict ? ` · ${VERDICT[d.verdict]}` : ""}</span>
        {d.sentence}
      </p>
      {changes.length > 0 && (
        <ul className="d-expert mono" style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
          {changes.map((c, i) => <li key={i}>{c.text}{c.values ? ` (${c.values})` : ""}</li>)}
        </ul>
      )}
      {d.previous && (
        <Link href={withDetail(`/compare?a=${encodeURIComponent(d.previous.run_id)}&b=${encodeURIComponent(runId)}`, detail)}
          style={{ textDecoration: "underline", fontSize: 13 }}>
          Compare with the earlier run of this circuit on {d.previous.backend ?? "this machine"}
        </Link>
      )}
    </div>
  );
}
