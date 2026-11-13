"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { qlabApiPath } from "../lib/api";
import { useDetail, withDetail, type Detail } from "../lib/dial";
import { DriftLine } from "./DriftAlarm";

export type Measure = {
  kind: "ideal_share" | "top_share"; value: number; shots: number;
  hellinger_fidelity?: number; ideal_outcomes?: string[]; ideal_source?: string; top_outcome?: string;
};
export type Answer = {
  run_id: string; level: Detail; sentence: string; measure: Measure | null; cause: string | null;
  previous: { run_id: string; backend: string | null; created_at: string | null; measure: Measure | null; same_backend: boolean } | null;
  change: { points: number; significant: boolean; p_value: number | null; tvd: number | null } | null;
};

/** The run's answer at the dial's level. Re-asked when the level changes: wording is the server's. */
export function useAnswer(runId: string | null): { state: "loading" | "ok" | "error"; data?: Answer } {
  const [detail] = useDetail();
  const [v, setV] = useState<{ key: string; state: "ok" | "error"; data?: Answer } | null>(null);
  const key = `${runId}|${detail}`;
  useEffect(() => {
    if (!runId) return;
    let on = true;
    fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/answer?level=${detail}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Answer) => { if (on) setV({ key, state: "ok", data: d }); })
      .catch(() => { if (on) setV({ key, state: "error" }); });
    return () => { on = false; };
  }, [runId, detail, key]);
  if (!runId || !v || v.key !== key) return { state: "loading" };
  return v;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The sentence a run opens with, then the evidence behind it. */
/** What to do next, in plain words, from the facts behind the answer. */
function nextStep(d: Answer): string {
  if (!d.measure) return "Results show up here once the job finishes; open this page again then.";
  if (!d.previous) return "Run the same circuit again later to see whether this result holds.";
  if (!d.change) return "Open the previous run to compare the two by hand: they can't be scored the same way.";
  if (!d.change.significant) return "Nothing to fix: this matches the previous run within the normal run-to-run spread.";
  if (d.change.points < 0) {
    return d.cause && /calibration/i.test(d.cause)
      ? "The machine itself changed. Try again after its next calibration, or on another machine."
      : "Compare with the previous run to see what changed.";
  }
  return "Better than before. Compare with the previous run to see what changed, and keep those settings.";
}

export default function RunAnswer({ runId, project, backend, answer }: {
  runId: string; project?: string | null; backend?: string | null;
  answer?: { state: "loading" | "ok" | "error"; data?: Answer };
}) {
  const own = useAnswer(answer ? null : runId);
  const a = answer ?? own;
  const [detail] = useDetail();
  const d = a.data;
  return (
    <section className="frame" aria-labelledby="answer-h" style={{ borderLeft: "3px solid var(--c-runs)" }}>
      <div className="frame-head">
        <h2 id="answer-h" className="inst-label">The answer</h2>
        {d?.change && (
          <span className="mono" style={{ fontSize: 11, color: d.change.significant ? (d.change.points < 0 ? "var(--danger)" : "var(--ok)") : "var(--muted)" }}>
            {d.change.points > 0 ? "+" : ""}{d.change.points.toFixed(1)} pts {d.change.significant ? "" : "(within shot noise)"}
          </span>
        )}
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 12 }}>
        <p className="summary-line" style={{ fontSize: 17 }} aria-live="polite">
          {a.state === "loading" ? "Working out what this run shows…" : a.state === "error" ? "The answer for this run couldn't be worked out right now." : d!.sentence}
        </p>
        {a.state !== "loading" && <DriftLine runId={runId} />}
        {d && <p className="d-plain-only" style={{ margin: 0, fontSize: 15 }}><b>Next:</b> {nextStep(d)}</p>}
        {d?.measure && (
          <dl className="readouts d-standard">
            <div className="readout">
              <dt>{d.measure.kind === "ideal_share" ? "On expected outcomes" : `Top outcome ${d.measure.top_outcome}`}</dt>
              <dd>{pct(d.measure.value)}<small>{d.measure.shots.toLocaleString("en-US")} shots</small></dd>
            </div>
            {d.previous?.measure && (
              <div className="readout">
                <dt>Previous comparable run</dt>
                <dd>{pct(d.previous.measure.value)}<small>{d.previous.backend ?? "no backend"}{d.previous.created_at ? `, ${d.previous.created_at.slice(0, 10)}` : ""}</small></dd>
              </div>
            )}
            {d.measure.hellinger_fidelity !== undefined && (
              <div className="readout d-expert">
                <dt>Hellinger fidelity</dt>
                <dd>{d.measure.hellinger_fidelity.toFixed(4)}<small>vs the ideal distribution</small></dd>
              </div>
            )}
            {d.change?.tvd != null && (
              <div className="readout d-expert">
                <dt>TVD to previous</dt>
                <dd>{d.change.tvd.toFixed(4)}<small>{d.change.p_value != null ? `p = ${d.change.p_value.toPrecision(3)} vs shot noise` : ""}</small></dd>
              </div>
            )}
          </dl>
        )}
        {d?.measure && (
          <p className="d-expert mono" style={{ margin: 0, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
            {d.measure.kind === "ideal_share"
              ? `Expected outcomes (${d.measure.ideal_source}): ${(d.measure.ideal_outcomes ?? []).slice(0, 16).join(", ")}${(d.measure.ideal_outcomes?.length ?? 0) > 16 ? "…" : ""}.`
              : `No ideal distribution: ${d.measure.ideal_source}.`}
            {" "}The previous comparable run is the latest earlier run of the same circuit (same QASM hash) you can see, on the same backend when there is one. A change counts only if shot noise can&apos;t explain it; a cause is named only when the stored calibration or compiled circuit is enough to account for it.
          </p>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
          {d?.previous && (
            <Link href={withDetail(`/compare?a=${encodeURIComponent(d.previous.run_id)}&b=${encodeURIComponent(runId)}`, detail)} style={{ textDecoration: "underline" }}>
              Compare with the previous run
            </Link>
          )}
          {project && (
            <Link href={withDetail(`/projects/${encodeURIComponent(project)}/timeline?run=${encodeURIComponent(runId)}`, detail)} style={{ textDecoration: "underline" }}>
              See it in the {project} timeline
            </Link>
          )}
          {backend && /^ibm/.test(backend) && (
            <Link href={withDetail(`/hardware/${encodeURIComponent(backend)}`, detail)} style={{ textDecoration: "underline" }}>{backend} on the hardware board</Link>
          )}
          <Link href={withDetail(`/hardware/pick?run=${encodeURIComponent(runId)}`, detail)} style={{ textDecoration: "underline" }}>Where should I run this next?</Link>
          <Link href={`/verify/${encodeURIComponent(runId)}`} style={{ textDecoration: "underline" }}>Verify this run</Link>
        </div>
      </div>
    </section>
  );
}
