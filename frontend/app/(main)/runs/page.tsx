"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RefreshCw, Wifi, Terminal, Key, Zap, ChevronUp, ChevronDown, Trash2, Download, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { createRunStream, deleteRun, healthColor, qlabApiPath, QLabRun, searchRuns } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useToast } from "../../../lib/toast";

const GateDepthChart = dynamic(() => import("../GateDepthChart"), {
  ssr: false,
  loading: () => <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>Loading chart…</div>,
});

// ------------------------------------------------------------------
// Sorting
// ------------------------------------------------------------------
type SortCol = "run" | "project" | "backend" | "status" | "qubits" | "depth" | "ncr" | "health" | "created";

const SORTERS: Record<SortCol, (a: QLabRun, b: QLabRun) => number> = {
  run:     (a, b) => (a.circuit_name || a.run_id).localeCompare(b.circuit_name || b.run_id),
  project: (a, b) => (a.project || "").localeCompare(b.project || ""),
  backend: (a, b) => (a.backend || "").localeCompare(b.backend || ""),
  status:  (a, b) => a.status.localeCompare(b.status),
  qubits:  (a, b) => (a.fingerprint.num_qubits ?? 0) - (b.fingerprint.num_qubits ?? 0),
  depth:   (a, b) => (a.fingerprint.depth ?? 0) - (b.fingerprint.depth ?? 0),
  ncr:     (a, b) => (a.fingerprint.non_clifford_ratio ?? 0) - (b.fingerprint.non_clifford_ratio ?? 0),
  health:  (a, b) => (a.health_score ?? -1) - (b.health_score ?? -1),
  created: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
};

function SortTh({
  col, label, sortCol, sortDir, onSort, style,
}: {
  col: SortCol; label: string;
  sortCol: SortCol | null; sortDir: "asc" | "desc";
  onSort: (c: SortCol) => void;
  style?: React.CSSProperties;
}) {
  const active = sortCol === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...style }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {active
          ? (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
          : <ChevronDown size={13} style={{ opacity: 0.25 }} />
        }
      </span>
    </th>
  );
}

// ------------------------------------------------------------------
// Quick Start (empty state)
// ------------------------------------------------------------------
function QuickStart() {
  const steps = [
    { icon: <Terminal size={20} />, title: "Install Q-Lab SDK", code: "pip install qlab-tracker" },
    { icon: <Key size={20} />, title: "Get your API key", code: 'import qlab\nqlab.init(api_key="ql_…", url="https://soqlab.com")' },
    {
      icon: <Zap size={20} />, title: "Track your first circuit",
      code: 'from qiskit import QuantumCircuit\nfrom qlab import track\n\nqc = QuantumCircuit(2)\nqc.h(0); qc.cx(0, 1)\n\nwith track(qc, backend="ibm_brisbane") as run:\n    job = sampler.run([qc])\n    result = job.result()\n    run.log_result(result)',
    },
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Quick Start — Track your first experiment</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Your experiments will appear here once submitted</span>
      </div>
      <div style={{ padding: "24px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--info-bg)", display: "grid", placeItems: "center", color: "var(--strong)" }}>
                {step.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>Step {i + 1}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{step.title}</div>
              </div>
            </div>
            <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, background: "var(--code-bg)", color: "var(--code-text)", padding: "12px 14px", borderRadius: 6, overflowX: "auto", fontFamily: '"Cascadia Code", Consolas, monospace' }}>
              {step.code}
            </pre>
          </div>
        ))}
      </div>
      <div style={{ padding: "0 20px 20px", display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a className="button" href="/settings" style={{ fontSize: 13, height: 34 }}>Manage API Keys</a>
        <a className="button secondary" href="/analytics" style={{ fontSize: 13, height: 34 }}>View Analytics</a>
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

const PAGE_SIZE = 50;

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
export default function RunsPage() {
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

  // Sorting
  const [sortCol, setSortCol] = useState<SortCol | null>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pagination
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const esCleanup = useRef<(() => void) | null>(null);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const params: Record<string, string | number> = { page_size: 500 };
      if (q) params.q = q;
      if (backend) params.backend = backend;
      if (status) params.status = status;
      if (project) params.project = project;
      if (minQubits) params.min_qubits = Number(minQubits);
      if (maxDepth) params.max_depth = Number(maxDepth);
      const result = await searchRuns(params);
      setRuns(result.items);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
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
    void loadRuns().then(connectSSE);
    return () => { if (esCleanup.current) esCleanup.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sort
  const sorted = useMemo(() => {
    if (!sortCol) return runs;
    const fn = SORTERS[sortCol];
    const arr = [...runs].sort(fn);
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [runs, sortCol, sortDir]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRuns = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  // Selection helpers
  const allPageSelected = pageRuns.length > 0 && pageRuns.every(r => selected.has(r.run_id));
  const someSelected = selected.size > 0;

  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageRuns.forEach(r => next.delete(r.run_id));
      else pageRuns.forEach(r => next.add(r.run_id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (!token || !selected.size) return;
    setBulkDeleting(true);
    const ids = [...selected];
    try {
      await Promise.allSettled(ids.map(id => deleteRun(token, id)));
      setRuns(prev => prev.filter(r => !selected.has(r.run_id)));
      setSelected(new Set());
      setBulkConfirm(false);
      toast(`Deleted ${ids.length} run${ids.length > 1 ? "s" : ""}`, "success");
    } catch {
      toast("Some runs could not be deleted", "error");
    } finally {
      setBulkDeleting(false);
    }
  }

  // KPI metrics
  const total = runs.length;
  const completed = runs.filter(r => r.status === "completed").length;
  const failed = runs.filter(r => r.status === "failed").length;
  const maxQubits = Math.max(0, ...runs.map(r => r.fingerprint.num_qubits ?? 0));
  const withCal = runs.filter(r => r.calibration && Object.keys(r.calibration).length > 0).length;
  const avgHealth = (() => {
    const scored = runs.filter(r => r.health_score !== null && r.health_score !== undefined);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, r) => s + (r.health_score ?? 0), 0) / scored.length);
  })();

  const chartData = runs.slice().reverse().slice(-20).map(r => ({
    name: (r.circuit_name || r.run_id).slice(0, 10),
    depth: r.fingerprint.depth ?? 0,
    qubits: r.fingerprint.num_qubits ?? 0,
    health: r.health_score ?? 0,
  }));

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
        <a className="button secondary" href={exportUrl} style={{ height: 38, fontSize: 14 }} title="Export all runs as CSV">
          <Download size={16} aria-hidden="true" /> CSV
        </a>
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

      {/* Chart */}
      <section className="panel">
        <div className="panel-header"><h2>Gate Depth — Last 20 Runs</h2></div>
        <div style={{ height: 240, padding: "8px 16px" }}>
          <GateDepthChart data={chartData} />
        </div>
      </section>

      {/* Empty state */}
      {!loading && !runs.length && <QuickStart />}

      {/* Runs table */}
      {(!loading && runs.length > 0) && (
        <section className="panel">
          {/* Panel header */}
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 10 }}>
            <h2>Experiments ({total.toLocaleString()})</h2>
            {someSelected && !bulkConfirm && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{selected.size} selected</span>
                <button
                  className="button secondary"
                  style={{ height: 30, fontSize: 12, color: "var(--danger)", borderColor: "var(--danger)" }}
                  onClick={() => setBulkConfirm(true)}
                  type="button"
                >
                  <Trash2 size={13} /> Delete {selected.size}
                </button>
                <button className="button secondary" style={{ height: 30, fontSize: 12 }}
                  onClick={() => setSelected(new Set())} type="button">
                  Clear
                </button>
              </div>
            )}
            {bulkConfirm && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
                  Delete {selected.size} runs permanently?
                </span>
                <button
                  className="button"
                  style={{ height: 30, fontSize: 12, background: "var(--danger)", borderColor: "var(--danger)" }}
                  disabled={bulkDeleting}
                  onClick={() => void bulkDelete()}
                  type="button"
                >
                  {bulkDeleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button className="button secondary" style={{ height: 30, fontSize: 12 }}
                  onClick={() => setBulkConfirm(false)} type="button">
                  Cancel
                </button>
              </div>
            )}
          </div>

          {error && <div className="empty">{error}</div>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {/* Select-all checkbox */}
                  <th style={{ width: 40, textAlign: "center", padding: "12px 8px" }}>
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all on this page"
                      style={{ cursor: "pointer", width: 15, height: 15 }}
                    />
                  </th>
                  <SortTh col="run"     label="Run"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="project" label="Project"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="backend" label="Backend"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="status"  label="Status"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="qubits"  label="Qubits"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="depth"   label="Depth"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="ncr"     label="Non-Clifford" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="health"  label="Health"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="created" label="Created"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {pageRuns.map(run => (
                  <tr key={run.run_id} style={{ background: selected.has(run.run_id) ? "var(--info-bg)" : undefined }}>
                    <td style={{ textAlign: "center", padding: "12px 8px" }}>
                      <input
                        type="checkbox"
                        checked={selected.has(run.run_id)}
                        onChange={() => toggleSelect(run.run_id)}
                        aria-label={`Select run ${run.run_id}`}
                        style={{ cursor: "pointer", width: 15, height: 15 }}
                      />
                    </td>
                    <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <Link href={`/runs/${run.run_id}`} style={{ color: "var(--strong)", fontWeight: 500 }}>
                        {run.circuit_name || run.run_id.slice(0, 12)}
                      </Link>
                    </td>
                    <td style={{ fontSize: 13 }}>{run.project || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ fontSize: 13 }}>{run.backend || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td><span className={statusClass(run.status)}>{run.status}</span></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{run.fingerprint.num_qubits ?? "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{run.fingerprint.depth ?? "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{((run.fingerprint.non_clifford_ratio ?? 0) * 100).toFixed(1)}%</td>
                    <td><HealthBadge score={run.health_score} /></td>
                    <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {run.tags.length
                        ? run.tags.map(t => (
                          <span key={t} style={{ display: "inline-block", background: "var(--info-bg)", color: "var(--info-text)", borderRadius: 999, padding: "1px 7px", marginRight: 4, fontWeight: 600 }}>{t}</span>
                        ))
                        : <span style={{ color: "var(--muted)" }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                Showing {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, sorted.length).toLocaleString()} of {sorted.length.toLocaleString()} runs
              </span>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button className="button secondary" style={{ height: 30, width: 30, padding: 0 }}
                  disabled={safePage === 1} onClick={() => setPage(1)} aria-label="First page" type="button">
                  <ChevronsLeft size={14} />
                </button>
                <button className="button secondary" style={{ height: 30, width: 30, padding: 0 }}
                  disabled={safePage === 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page" type="button">
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontSize: 13, padding: "0 10px", color: "var(--text)" }}>
                  Page {safePage} of {totalPages}
                </span>
                <button className="button secondary" style={{ height: 30, width: 30, padding: 0 }}
                  disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page" type="button">
                  <ChevronRight size={14} />
                </button>
                <button className="button secondary" style={{ height: 30, width: 30, padding: 0 }}
                  disabled={safePage === totalPages} onClick={() => setPage(totalPages)} aria-label="Last page" type="button">
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
