"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, RefreshCw, Wifi, Download } from "lucide-react";
import { createRunStream, healthColor, qlabApiPath, QLabRun, searchRuns } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useDetail, withDetail } from "../../../lib/dial";


// Empty state: what is missing and how to get it. No pictures, no sample data.
function QuickStart() {
  return (
    <section className="frame">
      <div className="frame-head"><h2 className="inst-label">No runs yet</h2></div>
      <div className="empty-state">
        <p style={{ margin: "0 0 10px" }}>Runs appear here the moment a script that uses the Q-Lab SDK runs a circuit. Add two lines to any Qiskit script:</p>
        <pre className="code">{`pip install qlab-sdk

import qlab
qlab.auto_track(api_key="YOUR_KEY")`}</pre>
        <p style={{ margin: "10px 0 0" }}>Your API key and a step-by-step guide are in <Link href="/onboarding" style={{ textDecoration: "underline" }}>Quick start</Link>.</p>
      </div>
    </section>
  );
}

function statusClass(s: string) {
  const l = s.toLowerCase();
  if (l === "completed") return "status completed";
  if (l === "failed") return "status failed";
  if (l === "submitted") return "status submitted";
  return "status";
}

function HealthBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>;
  return <span className="num" style={{ fontWeight: 600, color: healthColor(score), fontSize: 13 }}>{score}</span>;
}


// ------------------------------------------------------------------
// Smart query parser
// Supports: backend:X  status:Y  project:Z  depth<N  qubits>N  tag:X
// ------------------------------------------------------------------
type ParsedQuery = {
  text: string;
  backend: string;
  status: string;
  project: string;
  minQubits: string;
  maxDepth: string;
};

function parseSmartQuery(raw: string): ParsedQuery {
  const tokens = raw.trim().split(/\s+/);
  const result: ParsedQuery = { text: "", backend: "", status: "", project: "", minQubits: "", maxDepth: "" };
  const textParts: string[] = [];

  for (const token of tokens) {
    const m = token.match(/^(\w+)(:|>|<)(.+)$/i);
    if (!m) { if (token) textParts.push(token); continue; }
    const [, key, op, val] = m;
    const k = key.toLowerCase();
    if (k === "backend" && op === ":") result.backend = val;
    else if (k === "status" && op === ":") result.status = val;
    else if (k === "project" && op === ":") result.project = val;
    else if ((k === "qubits" || k === "qubit") && op === ">") result.minQubits = val;
    else if ((k === "depth") && op === "<") result.maxDepth = val;
    else if (k === "tag" && op === ":") textParts.push(val);
    else textParts.push(token);
  }

  result.text = textParts.join(" ");
  return result;
}

// ------------------------------------------------------------------
// The list. Every filter lives in the address, so a filtered view is a link.
// ------------------------------------------------------------------
const FILTERS = ["q", "backend", "status", "project", "min_qubits", "max_depth", "circuit"] as const;
type Filters = Record<(typeof FILTERS)[number], string>;

function filtersFrom(sp: { get(k: string): string | null }): Filters {
  const f = {} as Filters;
  for (const k of FILTERS) f[k] = sp.get(k) ?? "";
  return f;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "—";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** One plain sentence about what is on screen, from the runs actually loaded. */
function summarise(runs: QLabRun[], f: Filters): string {
  const scope = [
    f.project && `in project ${f.project}`, f.backend && `on ${f.backend}`, f.status && `with status ${f.status}`,
    f.circuit && `of circuit ${f.circuit.slice(0, 12)}`, f.q && `matching “${f.q}”`,
  ].filter(Boolean).join(", ");
  if (!runs.length) return scope ? `No runs ${scope}.` : "No runs recorded yet.";
  const failed = runs.filter((r) => r.status === "failed").length;
  const backends = new Set(runs.map((r) => r.backend).filter(Boolean)).size;
  const latest = runs[0];
  return `${runs.length} run${runs.length === 1 ? "" : "s"}${scope ? ` ${scope}` : ""} on ${backends} backend${backends === 1 ? "" : "s"}`
    + `${failed ? `, ${failed} failed` : ""}. The latest, ${latest.circuit_name || latest.run_id.slice(0, 8)}${latest.backend ? ` on ${latest.backend}` : ""}, arrived ${ago(latest.created_at)}.`;
}

function RunsInner() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [detail] = useDetail();
  const applied = useMemo(() => filtersFrom(searchParams), [searchParams]);
  const key = FILTERS.map((k) => applied[k]).join("|");
  const [draft, setDraft] = useState<Filters>(applied);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setDraft(applied); }

  const [runs, setRuns] = useState<QLabRun[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // Runs that arrived over the live stream while this page was open: they flash once.
  const [arrived, setArrived] = useState<Set<string>>(new Set());

  useEffect(() => {
    let on = true;
    const params: Record<string, string | number> = { page_size: 500 };
    for (const k of FILTERS) if (applied[k]) params[k] = applied[k];
    searchRuns(params)
      .then((res) => { if (on) { setRuns(res.items); setError(null); setLoaded(key); } })
      .catch((err: unknown) => { if (on) { setError(err instanceof Error ? err.message : "Failed to load runs"); setLoaded(key); } });
    return () => { on = false; };
  }, [key, applied]);

  useEffect(() => {
    const close = createRunStream((type, data) => {
      if (type === "run.created") {
        setRuns((prev) => (prev.some((r) => r.run_id === data.run_id) ? prev : [data, ...prev.slice(0, 999)]));
        setArrived((prev) => new Set(prev).add(data.run_id));
      } else if (type === "run.updated") setRuns((prev) => prev.map((r) => (r.run_id === data.run_id ? data : r)));
      else if (type === "run.deleted") setRuns((prev) => prev.filter((r) => r.run_id !== (data as unknown as { run_id: string }).run_id));
    }, applied.project || undefined);
    setLive(true);
    return close;
  }, [applied.project]);

  function apply(next: Filters) {
    const sp = new URLSearchParams(window.location.search);
    for (const k of FILTERS) { if (next[k]) sp.set(k, next[k]); else sp.delete(k); }
    const qs = sp.toString();
    router.replace(qs ? `/runs?${qs}` : "/runs", { scroll: false });
  }

  function submitSearch() {
    const parsed = parseSmartQuery(draft.q);
    apply({
      ...draft,
      q: parsed.text,
      backend: parsed.backend || draft.backend,
      status: parsed.status || draft.status,
      project: parsed.project || draft.project,
      min_qubits: parsed.minQubits || draft.min_qubits,
      max_depth: parsed.maxDepth || draft.max_depth,
    });
  }

  const loading = loaded !== key;
  const filtered = FILTERS.some((k) => applied[k]);
  const exportUrl = qlabApiPath(`/api/v1/exports/runs.csv`);
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <main className="page">
      <p className="summary-line" aria-live="polite">{loading ? "Loading runs…" : error ? `Runs couldn't be loaded: ${error}` : summarise(runs, applied)}</p>

      <form className="toolbar" role="search" onSubmit={(e) => { e.preventDefault(); submitSearch(); }}>
        <input className="input" value={draft.q} onChange={set("q")} style={{ minWidth: 220, flex: 1 }}
          placeholder='Circuit or tag · try "backend:ibm_torino depth<20 status:completed"' aria-label="Search runs" />
        <input className="input d-standard" value={draft.backend} onChange={set("backend")} placeholder="Backend" aria-label="Backend" />
        <select className="input d-standard" value={draft.status} onChange={set("status")} style={{ minWidth: 130 }} aria-label="Status">
          <option value="">All statuses</option>
          <option>completed</option>
          <option>failed</option>
          <option>submitted</option>
        </select>
        <input className="input d-standard" value={draft.project} onChange={set("project")} placeholder="Project" aria-label="Project" />
        <input className="input d-expert" value={draft.min_qubits} onChange={set("min_qubits")} placeholder="Min qubits" type="number" style={{ width: 110, minWidth: 0 }} aria-label="Minimum qubits" />
        <input className="input d-expert" value={draft.max_depth} onChange={set("max_depth")} placeholder="Max depth" type="number" style={{ width: 110, minWidth: 0 }} aria-label="Maximum depth" />
        <input className="input d-expert" value={draft.circuit} onChange={set("circuit")} placeholder="Circuit hash" style={{ width: 150, minWidth: 0 }} aria-label="Circuit hash" />
        <button className="button" type="submit"><Filter size={16} aria-hidden="true" /> Search</button>
        {filtered && (
          <button className="button secondary" type="button" onClick={() => apply(filtersFrom(new URLSearchParams()))}>
            <RefreshCw size={16} aria-hidden="true" /> Clear filters
          </button>
        )}
        <button className="button secondary d-standard" type="button" title="Download every run you can see as CSV"
          onClick={async () => {
            const res = await fetch(exportUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) return;
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement("a");
            a.href = url; a.download = "runs.csv"; a.click();
            URL.revokeObjectURL(url);
          }}>
          <Download size={16} aria-hidden="true" /> CSV
        </button>
        {live && (
          <span className="mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }} title="New runs appear here as they arrive">
            <Wifi size={14} aria-hidden="true" /> listening for new runs
          </span>
        )}
      </form>

      {!loading && !error && !runs.length && !filtered && <QuickStart />}

      {!loading && runs.length > 0 && (
        <section className="frame">
          <div className="frame-head">
            <h2 className="inst-label">Runs ({runs.length}{runs.length >= 500 ? ", newest 500" : ""})</h2>
            {applied.project && (
              <Link href={withDetail(`/projects/${encodeURIComponent(applied.project)}/timeline`, detail)} style={{ fontSize: 12, textDecoration: "underline" }}>
                Scrub through {applied.project} as a timeline →
              </Link>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Circuit</th>
                  <th>Backend</th>
                  <th className="d-standard">Project</th>
                  <th>Status</th>
                  <th className="d-standard" style={{ textAlign: "right" }}>Qubits</th>
                  <th className="d-expert" style={{ textAlign: "right" }}>Depth</th>
                  <th className="d-expert">Circuit hash</th>
                  <th className="d-expert" style={{ textAlign: "right" }} title="Q-Lab health score, 0–100: a weighted mix of the top outcome share and calibrated gate and readout fidelity">Health score</th>
                  <th style={{ textAlign: "right" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.run_id} className={arrived.has(run.run_id) ? "arrived" : undefined}>
                    <td style={{ maxWidth: 260 }}>
                      <Link href={withDetail(`/runs/${run.run_id}`, detail)} style={{ color: "var(--text)", fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {run.circuit_name || run.run_id.slice(0, 12)}
                      </Link>
                      <span className="mono d-standard" style={{ color: "var(--muted)", fontSize: 11 }}>{run.run_id.slice(0, 12)}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {run.backend ? <Link href={withDetail(`/runs?backend=${encodeURIComponent(run.backend)}`, detail)}>{run.backend}</Link> : "—"}
                    </td>
                    <td className="d-standard" style={{ color: "var(--muted)" }}>
                      {run.project ? <Link href={withDetail(`/runs?project=${encodeURIComponent(run.project)}`, detail)}>{run.project}</Link> : "—"}
                    </td>
                    <td><span className={statusClass(run.status)}>{run.status}</span></td>
                    <td className="num d-standard" style={{ textAlign: "right" }}>{run.fingerprint?.num_qubits ?? "—"}</td>
                    <td className="num d-expert" style={{ textAlign: "right" }}>{run.fingerprint?.depth ?? "—"}</td>
                    <td className="mono d-expert" style={{ fontSize: 11 }}>
                      {run.fingerprint?.qasm_sha256 ? <Link href={withDetail(`/runs?circuit=${run.fingerprint.qasm_sha256}`, detail)}>{run.fingerprint.qasm_sha256.slice(0, 12)}</Link> : "—"}
                    </td>
                    <td className="d-expert" style={{ textAlign: "right" }}><HealthBadge score={run.health_score} /></td>
                    <td style={{ textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>{ago(run.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={<main className="page"><div className="empty">Loading…</div></main>}>
      <RunsInner />
    </Suspense>
  );
}
