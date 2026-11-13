"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RefreshCw, Wifi, Download } from "lucide-react";
import { createRunStream, healthColor, qlabApiPath, QLabRun, searchRuns } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useToast } from "../../../lib/toast";


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
        <p style={{ margin: "10px 0 0" }}>Your API key and a step-by-step guide are in <a href="/onboarding" style={{ textDecoration: "underline" }}>Quick start</a>.</p>
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
  return <span style={{ fontWeight: 700, color: healthColor(score), fontSize: 13 }}>{score}</span>;
}


// ------------------------------------------------------------------
// Smart query parser
// Supports: backend:X  status:Y  project:Z  depth>N  depth<N  qubits>N  tag:X
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
// Main
// ------------------------------------------------------------------
function RunsInner() {
  const { token } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<QLabRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Filters
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [backend, setBackend] = useState(searchParams.get("backend") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [project, setProject] = useState(searchParams.get("project") ?? "");
  const [minQubits, setMinQubits] = useState(searchParams.get("min_qubits") ?? "");
  const [maxDepth, setMaxDepth] = useState(searchParams.get("max_depth") ?? "");

  const esCleanup = useRef<(() => void) | null>(null);

  // The search and the state it sets, only in promise callbacks: the mount effect runs it directly
  // (loading starts true), everything else through loadRuns().
  function fetchRuns() {
    const params: Record<string, string | number> = { page_size: 500 };
    if (q) params.q = q;
    if (backend) params.backend = backend;
    if (status) params.status = status;
    if (project) params.project = project;
    if (minQubits) params.min_qubits = Number(minQubits);
    if (maxDepth) params.max_depth = Number(maxDepth);
    return searchRuns(params)
      .then((result) => setRuns(result.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load runs"))
      .finally(() => setLoading(false));
  }

  function loadRuns() {
    setLoading(true);
    setError(null);
    return fetchRuns();
  }

  function connectSSE() {
    if (esCleanup.current) esCleanup.current();
    const cleanup = createRunStream((type, data) => {
      if (type === "run.created") setRuns(prev => [data, ...prev.slice(0, 999)]);
      else if (type === "run.updated") setRuns(prev => prev.map(r => r.run_id === data.run_id ? data : r));
      else if (type === "run.deleted") setRuns(prev => prev.filter(r => r.run_id !== (data as unknown as { run_id: string }).run_id));
    });
    esCleanup.current = cleanup;
    setLive(true);
  }

  useEffect(() => {
    void fetchRuns().then(connectSSE);
    return () => { if (esCleanup.current) esCleanup.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // KPI metrics
  const total = runs.length;
  const completed = runs.filter(r => r.status === "completed").length;
  const failed = runs.filter(r => r.status === "failed").length;
  const maxQubits = Math.max(0, ...runs.map(r => r.fingerprint?.num_qubits ?? 0));
  const withCal = runs.filter(r => r.calibration && Object.keys(r.calibration).length > 0).length;
  const avgHealth = (() => {
    const scored = runs.filter(r => r.health_score !== null && r.health_score !== undefined);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, r) => s + (r.health_score ?? 0), 0) / scored.length);
  })();


  const exportUrl = qlabApiPath(`/api/v1/exports/runs.csv`);

  return (
    <main className="page">
      {/* Toolbar */}
      <div className="toolbar">
        <input
          className="input"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              const parsed = parseSmartQuery(q);
              if (parsed.backend) setBackend(parsed.backend);
              if (parsed.status) setStatus(parsed.status);
              if (parsed.project) setProject(parsed.project);
              if (parsed.minQubits) setMinQubits(parsed.minQubits);
              if (parsed.maxDepth) setMaxDepth(parsed.maxDepth);
              if (parsed.text !== q) setQ(parsed.text);
              void loadRuns();
            }
          }}
          placeholder='Search · try "backend:ibm_osaka depth<20 status:completed"'
          style={{ minWidth: 300 }}
        />
        <input className="input" value={backend} onChange={e => setBackend(e.target.value)} placeholder="Backend" />
        <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">All statuses</option>
          <option>completed</option>
          <option>failed</option>
          <option>submitted</option>
        </select>
        <input className="input" value={project} onChange={e => setProject(e.target.value)} placeholder="Project" />
        <input className="input" value={minQubits} onChange={e => setMinQubits(e.target.value)} placeholder="Min qubits" type="number" style={{ width: 100 }} />
        <input className="input" value={maxDepth} onChange={e => setMaxDepth(e.target.value)} placeholder="Max depth" type="number" style={{ width: 100 }} />
        <button className="button" onClick={() => void loadRuns()} type="button">
          <Filter size={16} aria-hidden="true" /> Search
        </button>
        <button className="button secondary" onClick={() => {
          setQ(""); setBackend(""); setStatus(""); setProject(""); setMinQubits(""); setMaxDepth("");
          void loadRuns();
        }} type="button">
          <RefreshCw size={16} aria-hidden="true" /> Reset
        </button>
        <button
          className="button secondary"
          style={{ height: 38, fontSize: 14 }}
          title="Export all runs as CSV"
          type="button"
          onClick={async () => {
            const res = await fetch(exportUrl, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "runs.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={16} aria-hidden="true" /> CSV
        </button>
        {live && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ok)", marginLeft: 4 }}>
            <Wifi size={14} /> Live
          </span>
        )}
      </div>

      {/* KPI strip */}
      <section className="summary-grid" aria-label="Platform summary">
        {([
          ["Runs", total],
          ["Completed", completed],
          ["Failed", failed],
          ["Max Qubits", maxQubits],
          ["With Calibration", withCal],
          ["Avg Health", avgHealth ?? "—"],
        ] as [string, string | number][]).map(([label, value]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </section>

      {/* Loading indicator */}
      {loading && (
        <div className="empty" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.5"
            style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--strong)"/>
          </svg>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>Loading runs…</span>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>
      )}

      {/* Empty state */}
      {!loading && !error && !runs.length && <QuickStart />}

      {/* Runs table */}
      {!loading && runs.length > 0 && (
        <section className="panel" style={{ marginTop: 0 }}>
          <div className="panel-header">
            <h2>Runs <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 14 }}>({runs.length})</span></h2>
          </div>
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Circuit</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Backend</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Project</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Qubits</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Depth</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Health</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr
                    key={run.run_id}
                    style={{ borderBottom: i < runs.length - 1 ? "1px solid var(--line)" : "none", cursor: "pointer" }}
                    onClick={() => window.location.href = `/runs/${run.run_id}`}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--surface)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                  >
                    <td style={{ padding: "10px 12px" }}>
                      <span className={statusClass(run.status)}>{run.status}</span>
                    </td>
                    <td style={{ padding: "10px 12px", maxWidth: 220 }}>
                      <span style={{ color: "var(--text)", fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {run.circuit_name || "—"}
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "ui-monospace,monospace" }}>
                        {run.run_id.slice(0, 8)}…
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{run.backend || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{run.project || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                      {run.fingerprint?.num_qubits ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                      {run.fingerprint?.depth ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <HealthBadge score={run.health_score} />
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(run.created_at).toLocaleDateString()}
                    </td>
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
