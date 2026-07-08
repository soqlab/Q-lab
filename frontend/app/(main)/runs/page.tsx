"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
// ─── Dashboard routing fabric ─────────────────────────────────────────────────
function DashFabric({ runs }: { runs: QLabRun[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Derive active backends from real runs
  const activeBackends = useMemo(() => {
    const recent = runs.slice(0, 10);
    const counts: Record<string, number> = {};
    recent.forEach(r => {
      const b = (r.backend || "").toLowerCase();
      if (b.includes("ibm"))     counts.ibm     = (counts.ibm || 0) + 1;
      if (b.includes("ionq"))    counts.ionq    = (counts.ionq || 0) + 1;
      if (b.includes("rigetti")) counts.rigetti = (counts.rigetti || 0) + 1;
      if (b.includes("aer") || b.includes("sim") || b === "") counts.aer = (counts.aer || 0) + 1;
    });
    return counts;
  }, [runs]);

  const latestCircuit = runs[0]?.circuit_name || runs[0]?.run_id?.slice(0, 8) || "experiment";

  // Ref keeps animation loop reading fresh data without restarting the rAF loop
  const dataRef = useRef({ activeBackends, latestCircuit });
  useEffect(() => { dataRef.current = { activeBackends, latestCircuit }; }, [activeBackends, latestCircuit]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    let W = 0, H = 0, raf = 0, t0 = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;

    function resize() {
      const r = canvas!.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const N = {
      exp:     { x:.09, y:.50, r:6   },
      qlab:    { x:.40, y:.50, r:12  },
      ibm:     { x:.76, y:.17, r:8   },
      ionq:    { x:.80, y:.40, r:6   },
      rigetti: { x:.80, y:.60, r:6   },
      aer:     { x:.76, y:.83, r:6   },
    };

    const P = (n:{x:number,y:number}) => ({ x: n.x*W, y: n.y*H });

    function bez(a:{x:number,y:number}, b:{x:number,y:number}) {
      const A=P(a),B=P(b),mx=(A.x+B.x)/2;
      ctx.beginPath(); ctx.moveTo(A.x,A.y);
      ctx.bezierCurveTo(mx,A.y,mx,B.y,B.x,B.y);
    }

    function ptBez(a:{x:number,y:number}, b:{x:number,y:number}, t:number) {
      const A=P(a),B=P(b),mx=(A.x+B.x)/2,u=1-t;
      return { x:u*u*u*A.x+3*u*u*t*mx+3*u*t*t*mx+t*t*t*B.x, y:u*u*u*A.y+3*u*u*t*A.y+3*u*t*t*B.y+t*t*t*B.y };
    }

    function edge(a:{x:number,y:number},b:{x:number,y:number},col:string,lw:number,alpha:number) {
      bez(a,b); ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.globalAlpha=alpha; ctx.stroke(); ctx.globalAlpha=1;
    }

    function circle(c:{x:number,y:number},r:number,fill:string,stroke:string,lw:number) {
      ctx.beginPath(); ctx.arc(c.x,c.y,r,0,Math.PI*2);
      ctx.fillStyle=fill; ctx.fill(); ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.stroke();
    }

    function lbl(n:{x:number,y:number},text:string,side:"left"|"right"|"above"|"below") {
      ctx.fillStyle="rgba(148,163,184,0.7)";
      ctx.font="9px ui-monospace,monospace";
      ctx.textAlign=(side==="left"?"right":side==="right"?"left":"center") as CanvasTextAlign;
      const ox=side==="left"?-10:side==="right"?10:0, oy=side==="above"?-12:side==="below"?14:3;
      ctx.fillText(text.toUpperCase(),P(n).x+ox,P(n).y+oy);
    }

    function frame(ts:number) {
      if (!t0) t0=ts;
      const time=(ts-t0)/1000;
      ctx.clearRect(0,0,W,H);

      // Read fresh data every frame via ref — no stale closure
      const { activeBackends: ab, latestCircuit: circuit } = dataRef.current;
      const hasIbm     = (ab.ibm     || 0) > 0;
      const hasIonq    = (ab.ionq    || 0) > 0;
      const hasRigetti = (ab.rigetti || 0) > 0;
      const hasAer     = (ab.aer     || 0) > 0;
      const hasAny = hasIbm || hasIonq || hasRigetti || hasAer;
      const chosen = Object.entries(ab).sort((a,b)=>b[1]-a[1])[0]?.[0] || "ibm";

      // passive edges to unused backends
      if (!hasIonq || !hasAny)    edge(N.qlab,N.ionq,"#1e2d45",1,0.5);
      if (!hasRigetti || !hasAny) edge(N.qlab,N.rigetti,"#1e2d45",1,0.5);
      if (!hasAer || !hasAny)     edge(N.qlab,N.aer,"#1e2d45",1,0.5);
      if (!hasIbm || !hasAny)     edge(N.qlab,N.ibm,"#1e2d45",1,0.5);

      // active edges to used backends
      if (hasIbm     || !hasAny) edge(N.qlab,N.ibm,"#6366f1",hasIbm?1.8:1,hasIbm?0.6:0.3);
      if (hasIonq)               edge(N.qlab,N.ionq,"#a78bfa",1.5,0.5);
      if (hasRigetti)            edge(N.qlab,N.rigetti,"#a78bfa",1.5,0.5);
      if (hasAer)                edge(N.qlab,N.aer,"#33e0c6",1.5,0.5);
      edge(N.exp,N.qlab,"#6366f1",1.6,0.55);

      if (!reduce) {
        // particles to chosen/active backends
        const activePaths: [typeof N.exp, typeof N.ibm, number][] = [[N.exp,N.qlab,2.2]];
        if (chosen==="ibm"     || !hasAny) activePaths.push([N.qlab,N.ibm,2.8]);
        if (chosen==="ionq")              activePaths.push([N.qlab,N.ionq,3.0]);
        if (chosen==="rigetti")           activePaths.push([N.qlab,N.rigetti,3.0]);
        if (chosen==="aer")               activePaths.push([N.qlab,N.aer,2.6]);

        (activePaths as any[]).forEach(([a,b,cyc])=>{
          for(let k=0;k<3;k++){
            const ph=((time/cyc)+k/3)%1;
            const pt=ptBez(a,b,ph);
            ctx.globalAlpha=0.25+0.75*Math.sin(ph*Math.PI);
            ctx.fillStyle="#33e0c6";
            ctx.beginPath(); ctx.arc(pt.x,pt.y,2.6,0,Math.PI*2); ctx.fill();
          }
        });
        ctx.globalAlpha=1;
        const C=P(N.qlab), pulse=0.4-0.4*Math.abs(Math.sin(time*1.8));
        ctx.globalAlpha=pulse;
        ctx.beginPath(); ctx.arc(C.x,C.y,N.qlab.r+6+4*Math.abs(Math.sin(time*1.8)),0,Math.PI*2);
        ctx.strokeStyle="#6366f1"; ctx.lineWidth=1.2; ctx.stroke();
        ctx.globalAlpha=1;
      }

      const ibmActive=chosen==="ibm"||!hasAny;
      circle(P(N.ionq),N.ionq.r,"var(--surface)",hasIonq?"#a78bfa":"#1e2d45",hasIonq?1.6:1.2);
      circle(P(N.rigetti),N.rigetti.r,"var(--surface)",hasRigetti?"#a78bfa":"#1e2d45",hasRigetti?1.6:1.2);
      circle(P(N.aer),N.aer.r,"var(--surface)",hasAer?"#33e0c6":"#1e2d45",hasAer?1.6:1.2);
      circle(P(N.ibm),N.ibm.r,ibmActive?"rgba(51,224,198,0.12)":"var(--surface)",ibmActive?"#33e0c6":"#1e2d45",ibmActive?1.8:1.2);
      circle(P(N.exp),N.exp.r,"rgba(99,102,241,0.1)","#6366f1",1.6);
      circle(P(N.qlab),N.qlab.r,"rgba(99,102,241,0.12)","#6366f1",2);

      lbl(N.exp, circuit.length>12 ? circuit.slice(0,12)+"…" : circuit, "left");
      lbl(N.qlab,"Q-LAB","above");
      lbl(N.ibm, hasIbm ? `ibm (${ab.ibm})` : "ibm", "right");
      lbl(N.ionq, hasIonq ? `ionq (${ab.ionq})` : "ionq", "right");
      lbl(N.rigetti, hasRigetti ? `rigetti (${ab.rigetti})` : "rigetti", "right");
      lbl(N.aer, hasAer ? `sim (${ab.aer})` : "aer_sim", "right");

      raf=requestAnimationFrame(frame);
    }

    const ro=new ResizeObserver(resize);
    ro.observe(canvas); resize();
    raf=requestAnimationFrame(frame);
    return ()=>{ cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div style={{
      margin:"0 0 20px",
      background:"rgba(99,102,241,0.04)",
      border:"1px solid var(--line)",
      borderRadius:12, overflow:"hidden", position:"relative",
    }}>
      <div style={{ position:"relative", width:"100%", aspectRatio:"21/6", maxHeight:160 }}>
        <canvas ref={ref} style={{ position:"absolute", inset:0, width:"100%", height:"100%" }} />
      </div>
      <span style={{
        position:"absolute", bottom:8, left:14,
        fontFamily:"ui-monospace,monospace", fontSize:9.5,
        letterSpacing:"0.15em", textTransform:"uppercase", color:"var(--muted)", opacity:0.5,
      }}>live routing fabric</span>
    </div>
  );
}

// Welcome workflow picker (empty state)
// ------------------------------------------------------------------
function QuickStart() {
  const workflows = [
    {
      emoji: "⚗️",
      title: "Track my experiments",
      desc: "Install the SDK, connect your API key, and every Qiskit circuit you run is captured automatically.",
      cta: "Set up the SDK",
      href: "/onboarding",
      accent: "#6366f1",
    },
    {
      emoji: "💰",
      title: "Find the cheapest QPU",
      desc: "Enter your circuit parameters and get an instant cost comparison across IBM, IonQ, Rigetti, and more.",
      cta: "Open Cost Oracle",
      href: "/cost-oracle",
      accent: "#10b981",
    },
    {
      emoji: "🤖",
      title: "Ask the Lab Assistant",
      desc: "Ask questions in plain English. The AI reads your experiment history and can execute cost estimates and searches for you.",
      cta: "Open Lab Assistant",
      href: "/assistant",
      accent: "#f59e0b",
    },
  ];
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Welcome to Q-Lab — what would you like to do?</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Your experiments will appear here once submitted</span>
      </div>
      <div style={{ padding: "20px 20px 0" }}>
        <DashFabric runs={[]} />
      </div>
      <div style={{ padding: "4px 20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {workflows.map((w) => (
          <a key={w.href} href={w.href} style={{ display: "flex", flexDirection: "column", gap: 14, padding: 20, background: "var(--surface)", border: `1px solid ${w.accent}30`, borderRadius: 12, textDecoration: "none", transition: "border-color 0.15s, transform 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = w.accent; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = `${w.accent}30`; (e.currentTarget as HTMLElement).style.transform = ""; }}>
            <div style={{ fontSize: 32 }}>{w.emoji}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 6 }}>{w.title}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{w.desc}</div>
            </div>
            <div style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: w.accent }}>
              {w.cta} →
            </div>
          </a>
        ))}
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

      {/* Chart — only when there's data */}
      {chartData.length > 0 && (
        <section className="panel">
          <div className="panel-header"><h2>Gate Depth — Last 20 Runs</h2></div>
          <div style={{ height: 240, padding: "8px 16px" }}>
            <GateDepthChart data={chartData} />
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && !error && !runs.length && <QuickStart />}

      {/* Live routing fabric — real backend usage from loaded runs */}
      {!loading && runs.length > 0 && <DashFabric runs={runs} />}

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
                      {(run.tags ?? []).length
                        ? (run.tags ?? []).map(t => (
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

export default function RunsPage() {
  return (
    <Suspense fallback={<main className="page"><div className="empty">Loading…</div></main>}>
      <RunsInner />
    </Suspense>
  );
}
