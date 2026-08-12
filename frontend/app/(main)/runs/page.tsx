"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RefreshCw, Wifi, Download } from "lucide-react";
import { createRunStream, healthColor, qlabApiPath, QLabRun, searchRuns } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useToast } from "../../../lib/toast";


// ------------------------------------------------------------------
// ─── Dashboard routing fabric ─────────────────────────────────────────────────
function DashFabric({ runs: initialRuns }: { runs: QLabRun[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { token } = useAuth();
  const [liveRuns, setLiveRuns] = useState<QLabRun[]>(initialRuns);

  // Poll for fresh backend stats every 30 seconds
  useEffect(() => {
    setLiveRuns(initialRuns);
  }, [initialRuns]);

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      try {
        const res = await fetch("/qlab-api/api/v1/runs?limit=50", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setLiveRuns(Array.isArray(data) ? data : data.items ?? []);
        }
      } catch {}
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [token]);

  // Derive active backends from real runs
  const activeBackends = useMemo(() => {
    const recent = liveRuns.slice(0, 20);
    const counts: Record<string, number> = {};
    recent.forEach(r => {
      const b = (r.backend || "").toLowerCase();
      if (b.includes("ibm"))     counts.ibm     = (counts.ibm || 0) + 1;
      if (b.includes("ionq"))    counts.ionq    = (counts.ionq || 0) + 1;
      if (b.includes("rigetti")) counts.rigetti = (counts.rigetti || 0) + 1;
      if (b.includes("aer") || b.includes("sim") || b === "") counts.aer = (counts.aer || 0) + 1;
    });
    return counts;
  }, [liveRuns]);

  const latestCircuit = liveRuns[0]?.circuit_name || liveRuns[0]?.run_id?.slice(0, 8) || "experiment";

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

      // passive edges — always shown as faint infrastructure
      edge(N.qlab,N.ionq,"#1e2d45",1,hasIonq?0.3:0.5);
      edge(N.qlab,N.rigetti,"#1e2d45",1,hasRigetti?0.3:0.5);
      edge(N.qlab,N.aer,"#1e2d45",1,hasAer?0.3:0.5);
      edge(N.qlab,N.ibm,"#1e2d45",1,hasIbm?0.3:0.5);

      // active edges — only for backends with real run data
      if (hasIbm)     edge(N.qlab,N.ibm,"#6366f1",1.8,0.6);
      if (hasIonq)    edge(N.qlab,N.ionq,"#a78bfa",1.5,0.5);
      if (hasRigetti) edge(N.qlab,N.rigetti,"#a78bfa",1.5,0.5);
      if (hasAer)     edge(N.qlab,N.aer,"#33e0c6",1.5,0.5);
      if (hasAny)     edge(N.exp,N.qlab,"#6366f1",1.6,0.55);

      if (!reduce && hasAny) {
        // particles only to backends that have real runs
        const activePaths: [typeof N.exp, typeof N.ibm, number][] = [[N.exp,N.qlab,2.2]];
        if (chosen==="ibm")     activePaths.push([N.qlab,N.ibm,2.8]);
        if (chosen==="ionq")    activePaths.push([N.qlab,N.ionq,3.0]);
        if (chosen==="rigetti") activePaths.push([N.qlab,N.rigetti,3.0]);
        if (chosen==="aer")     activePaths.push([N.qlab,N.aer,2.6]);

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

      const ibmActive=chosen==="ibm" && hasAny;
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
      }}>live routing fabric · {liveRuns.length} runs · refreshes every 30s</span>
    </div>
  );
}

const QUICK_ACTIONS = [
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

function QuickActions() {
  return (
    <div style={{ padding: "4px 20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      {QUICK_ACTIONS.map((w) => (
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
  );
}

// Empty state — no runs yet
function QuickStart() {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Welcome to Q-Lab — what would you like to do?</h2>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Your experiments will appear here once submitted</span>
      </div>
      <div style={{ padding: "20px 20px 0" }}>
        <DashFabric runs={[]} />
      </div>
      <QuickActions />
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

  async function loadRuns() {
    setLoading(true);
    setError(null);
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

      {/* Empty state */}
      {!loading && !error && !runs.length && <QuickStart />}

      {/* Live routing fabric + quick action cards */}
      {!loading && runs.length > 0 && (
        <section className="panel">
          <DashFabric runs={runs} />
          <QuickActions />
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
