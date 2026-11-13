"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { qlabApiPath } from "../lib/api";
import { useDetail, withDetail, type Detail } from "../lib/dial";

/*
 * Reproduce this run (backend/app/reproduce.py): one command that re-runs it with the recorded
 * circuit, package versions, seeds, transpiler settings, backend and shots; what can't be pinned,
 * said plainly; and every uploaded reproduction with whether it agreed. Wording is the server's.
 */

export type ReproState = "reproduced" | "not_reproduced" | "pending" | "cant_test" | "different_circuit" | "original_not_found";
export type Reproduction = {
  run_id: string; reproduction_of: string; state: ReproState; sentence: string;
  backend?: string | null; created_at?: string | null; verdict?: string | null; exact?: boolean;
  shift?: { tvd: number; expected_tvd: number; p_value: number } | null;
};
export type Reproduce = {
  run_id: string; level: Detail; sentence: string; can_rerun: boolean;
  commands: { file: string; uv: string; uv_explicit: string; pip: string; pip_install: string };
  requirements: string[]; script_url: string; notebook_url: string; notebook_cell: string | null;
  pinned: { what: string; value: string }[]; missing: { what: string; effect: string }[]; cant_pin: string[];
  has_compiled: boolean; reproductions: Reproduction[]; summary: string | null; reproduction_of: Reproduction | null;
};

export function useReproduce(runId: string): Reproduce | null | "error" {
  const [detail] = useDetail();
  const [v, setV] = useState<{ key: string; d: Reproduce | null | "error" } | null>(null);
  const key = `${runId}|${detail}`;
  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/reproduce?level=${detail}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Reproduce) => { if (on) setV({ key, d }); })
      .catch(() => { if (on) setV({ key, d: "error" }); });
    return () => { on = false; };
  }, [runId, detail, key]);
  return v && v.key === key ? v.d : null;
}

/** Downloads go through fetch so the sign-in token goes with them (a plain link can't send it). */
export async function downloadFromApi(path: string, filename: string): Promise<void> {
  const res = await fetch(qlabApiPath(path), { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="button secondary" style={{ height: 30, fontSize: 12.5 }}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? "Copied" : label}
    </button>
  );
}

const MARK: Record<string, { label: string; color: string }> = {
  reproduced: { label: "Reproduced", color: "var(--ok)" },
  not_reproduced: { label: "Didn't reproduce", color: "var(--warn)" },
  pending: { label: "Waiting", color: "var(--muted)" },
  cant_test: { label: "Not judged", color: "var(--muted)" },
  different_circuit: { label: "Not comparable", color: "var(--muted)" },
  original_not_found: { label: "Original not found", color: "var(--muted)" },
};

function ReproLine({ r, href, linkText }: { r: Reproduction; href: string; linkText: string }) {
  const m = MARK[r.state] ?? MARK.cant_test;
  return (
    <li style={{ borderLeft: `3px solid ${m.color}`, padding: "4px 0 4px 12px", listStyle: "none", display: "grid", gap: 2 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        <span className="inst-label" style={{ color: m.color, marginRight: 8 }}>{m.label}</span>
        {r.sentence}
      </p>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
        <Link href={href} style={{ textDecoration: "underline" }}>{linkText}</Link>
        {r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : ""}{r.backend ? ` · ${r.backend}` : ""}
      </span>
    </li>
  );
}

/** For a reproduction: one line saying whether it agreed with its original (the timeline's moment). */
export function ReproductionLine({ runId }: { runId: string }) {
  const [detail] = useDetail();
  const [v, setV] = useState<{ key: string; d: Reproduction | null } | null>(null);
  const key = `${runId}|${detail}`;
  useEffect(() => {
    let on = true;
    fetch(qlabApiPath(`/api/v1/runs/${encodeURIComponent(runId)}/reproduction?level=${detail}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Reproduction | null) => { if (on) setV({ key, d }); })
      .catch(() => { if (on) setV({ key, d: null }); });
    return () => { on = false; };
  }, [runId, detail, key]);
  const d = v && v.key === key ? v.d : null;
  if (!d || !d.sentence || !d.reproduction_of) return null;
  return (
    <ul style={{ margin: 0, padding: 0 }}>
      <ReproLine r={d} href={withDetail(`/runs/${encodeURIComponent(d.reproduction_of)}`, detail)} linkText={`The original run ${d.reproduction_of.slice(0, 8)}`} />
    </ul>
  );
}

export default function ReproduceRun({ runId }: { runId: string }) {
  const d = useReproduce(runId);
  const [detail] = useDetail();
  const [err, setErr] = useState<string | null>(null);
  if (d === null) {
    return (
      <section className="frame" aria-busy="true" id="reproduce">
        <div className="frame-head"><h2>Reproduce this run</h2></div>
        <div className="frame-body"><p className="summary-line" style={{ color: "var(--muted)" }}>Reading what was recorded…</p></div>
      </section>
    );
  }
  if (d === "error") return null;
  const dl = (path: string, name: string) => { setErr(null); void downloadFromApi(path, name).catch((e: Error) => setErr(e.message)); };

  return (
    <section className="frame" aria-labelledby="reproduce-h" id="reproduce">
      <div className="frame-head">
        <h2 id="reproduce-h">Reproduce this run</h2>
        {d.summary && <span className="inst-label">{d.summary}</span>}
      </div>
      <div className="frame-body" style={{ display: "grid", gap: 12 }}>
        {d.reproduction_of && (
          <ul style={{ margin: 0, padding: 0 }}>
            <ReproLine r={d.reproduction_of} href={withDetail(`/runs/${encodeURIComponent(d.reproduction_of.reproduction_of)}`, detail)}
              linkText={`The original run ${d.reproduction_of.reproduction_of.slice(0, 8)}`} />
          </ul>
        )}
        <p className="summary-line">{d.sentence}</p>

        {d.can_rerun && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code className="mono" style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 13, background: "var(--panel-2)" }}>
                {d.commands.uv}
              </code>
              <CopyButton text={d.commands.uv} />
              <button type="button" className="button" style={{ height: 30, fontSize: 12.5 }} onClick={() => dl(d.script_url, d.commands.file)}>
                Download {d.commands.file}
              </button>
              <button type="button" className="button secondary d-standard" style={{ height: 30, fontSize: 12.5 }}
                onClick={() => dl(d.notebook_url, d.commands.file.replace(/\.py$/, ".ipynb"))}>Notebook (.ipynb)</button>
              {d.notebook_cell && <span className="d-standard"><CopyButton text={d.notebook_cell} label="Copy as a notebook cell" /></span>}
            </div>
            {err && <p className="alert alert-warn" role="status" style={{ margin: 0 }}>{err}</p>}
            <p className="d-plain-only" style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Download the script, then run the command in the same folder. It needs <a href="https://docs.astral.sh/uv/" style={{ textDecoration: "underline" }}>uv</a>, which installs the recorded versions for you.
            </p>
            <div className="d-standard" style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>
                The script pins its versions in its header, so <code className="mono">uv run</code> builds that environment. Without uv:
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <code className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{d.commands.pip}</code>
                <CopyButton text={d.commands.pip} />
              </div>
              {d.has_compiled && (
                <span style={{ color: "var(--muted)" }}>
                  Add <code className="mono">--as-compiled</code> to run the exact compiled circuit that ran instead of recompiling it.
                </span>
              )}
              <span style={{ color: "var(--muted)" }}>
                Set <code className="mono">QLAB_API_KEY</code> to upload the result: it is tagged as a reproduction of this run and compared with it here.
              </span>
            </div>
            <dl className="readouts d-standard" aria-label="Pinned">
              {d.pinned.map((p) => (
                <div className="readout" key={p.what}><dt>{p.what}</dt><dd style={{ fontSize: 14 }}>{p.value}</dd></div>
              ))}
            </dl>
          </>
        )}

        {(d.cant_pin.length > 0 || d.missing.length > 0) && (
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            {d.cant_pin.length > 0 && (
              <>
                <span className="inst-label">Can&apos;t be pinned</span>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{d.cant_pin.map((c) => <li key={c}>{c}</li>)}</ul>
              </>
            )}
            {d.missing.length > 0 && (
              <>
                <span className="inst-label">Not recorded</span>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{d.missing.map((m) => <li key={m.what}><b>{m.what}</b>: {m.effect}.</li>)}</ul>
              </>
            )}
          </div>
        )}

        {d.reproductions.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            <span className="inst-label">Reproductions</span>
            <ul style={{ margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {d.reproductions.map((r) => (
                <ReproLine key={r.run_id} r={r} href={withDetail(`/runs/${encodeURIComponent(r.run_id)}`, detail)} linkText={`Run ${r.run_id.slice(0, 8)}`} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
