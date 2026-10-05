"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../lib/auth";

// ─── Inline CSS injected once ────────────────────────────────────────────────
const STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .lp-root {
    background: #0a0a0f;
    color: #f1f5f9;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Nav ── */
  .lp-nav {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 48px;
    height: 64px;
    background: rgba(10, 10, 15, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(99, 102, 241, 0.15);
  }

  .lp-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 800;
    color: #f1f5f9;
    letter-spacing: -0.5px;
    text-decoration: none;
  }

  .lp-logo-icon {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-radius: 8px;
    display: grid;
    place-items: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .lp-nav-links {
    display: flex;
    align-items: center;
    gap: 32px;
    list-style: none;
  }

  .lp-nav-links a {
    font-size: 14px;
    font-weight: 500;
    color: #94a3b8;
    text-decoration: none;
    transition: color 0.15s;
  }
  .lp-nav-links a:hover { color: #f1f5f9; }
  .lp-nav-links button {
    font-size: 14px;
    font-weight: 500;
    color: #94a3b8;
    transition: color 0.15s;
  }
  .lp-nav-links button:hover { color: #f1f5f9; }

  .lp-nav-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .lp-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s;
    white-space: nowrap;
    border: none;
  }

  .lp-btn-ghost {
    background: transparent;
    border: 1px solid rgba(99, 102, 241, 0.35);
    color: #a5b4fc;
  }
  .lp-btn-ghost:hover {
    background: rgba(99, 102, 241, 0.12);
    border-color: #6366f1;
    color: #c7d2fe;
  }

  .lp-btn-primary {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: #fff;
    box-shadow: 0 0 20px rgba(99, 102, 241, 0.35);
  }
  .lp-btn-primary:hover {
    opacity: 0.9;
    box-shadow: 0 0 28px rgba(99, 102, 241, 0.55);
    transform: translateY(-1px);
  }

  .lp-btn-large {
    height: 50px;
    padding: 0 28px;
    font-size: 15px;
    border-radius: 10px;
  }

  .lp-btn-outline-large {
    height: 50px;
    padding: 0 28px;
    font-size: 15px;
    border-radius: 10px;
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #94a3b8;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    text-decoration: none;
    font-weight: 600;
    transition: all 0.15s;
  }
  .lp-btn-outline-large:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #f1f5f9;
    background: rgba(255,255,255,0.04);
  }

  /* ── Hero ── */
  .lp-hero {
    min-height: calc(100vh - 64px);
    display: flex;
    align-items: center;
    padding: 80px 48px;
    position: relative;
    overflow: hidden;
  }

  .lp-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 800px 600px at 20% 50%, rgba(99,102,241,0.12) 0%, transparent 70%),
      radial-gradient(ellipse 600px 400px at 80% 30%, rgba(139,92,246,0.1) 0%, transparent 70%);
    pointer-events: none;
  }

  .lp-hero-grid {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 80px;
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .lp-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99, 102, 241, 0.3);
    color: #a5b4fc;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 6px 14px;
    border-radius: 999px;
    margin-bottom: 24px;
  }

  .lp-badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6366f1;
    animation: lp-pulse 2s ease-in-out infinite;
  }

  @keyframes lp-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  .lp-hero-headline {
    font-size: clamp(36px, 5vw, 58px);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -1.5px;
    color: #f8fafc;
    margin-bottom: 22px;
  }

  .lp-hero-headline span {
    background: linear-gradient(135deg, #818cf8, #a78bfa, #c084fc);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .lp-hero-sub {
    font-size: 18px;
    line-height: 1.7;
    color: #94a3b8;
    margin-bottom: 36px;
    max-width: 480px;
  }

  .lp-hero-ctas {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  /* ── Code card ── */
  .lp-code-card {
    background: #0d1117;
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 16px;
    overflow: hidden;
    box-shadow:
      0 0 0 1px rgba(99,102,241,0.08),
      0 24px 64px rgba(0,0,0,0.6),
      0 0 80px rgba(99,102,241,0.08);
  }

  .lp-code-bar {
    background: #161b22;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .lp-code-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .lp-code-filename {
    margin-left: 8px;
    font-size: 12px;
    color: #6b7280;
    font-family: "Cascadia Code", Consolas, monospace;
  }

  .lp-code-body {
    padding: 24px;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 13.5px;
    line-height: 1.8;
    color: #e2e8f0;
  }

  .lp-code-comment { color: #6b7280; }
  .lp-code-keyword { color: #a78bfa; }
  .lp-code-string  { color: #34d399; }
  .lp-code-func    { color: #60a5fa; }
  .lp-code-import  { color: #f9a8d4; }
  .lp-code-hl {
    background: rgba(99,102,241,0.12);
    border-left: 2px solid #6366f1;
    margin: 0 -24px;
    padding: 0 24px;
    display: block;
  }

  /* ── Stats strip ── */
  .lp-stats {
    background: rgba(15, 15, 25, 0.7);
    border-top: 1px solid rgba(255,255,255,0.05);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    padding: 36px 48px;
  }

  .lp-stats-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
  }

  .lp-stat {
    text-align: center;
    padding: 8px 24px;
    border-right: 1px solid rgba(255,255,255,0.06);
  }
  .lp-stat:last-child { border-right: none; }

  .lp-stat-value {
    font-size: 32px;
    font-weight: 800;
    background: linear-gradient(135deg, #818cf8, #a78bfa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -1px;
  }

  .lp-stat-label {
    font-size: 13px;
    color: #64748b;
    margin-top: 4px;
    font-weight: 500;
  }

  /* ── Section wrapper ── */
  .lp-section {
    padding: 100px 48px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .lp-section-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #6366f1;
    margin-bottom: 14px;
  }

  .lp-section-title {
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 800;
    letter-spacing: -1px;
    color: #f8fafc;
    line-height: 1.15;
    margin-bottom: 16px;
  }

  .lp-section-sub {
    font-size: 17px;
    color: #64748b;
    max-width: 540px;
    line-height: 1.65;
    margin-bottom: 60px;
  }

  /* ── Features grid ── */
  .lp-features-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }

  .lp-feature-card {
    background: rgba(15, 15, 25, 0.8);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px;
    padding: 28px;
    transition: all 0.2s;
    position: relative;
    overflow: hidden;
  }
  .lp-feature-card::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(99,102,241,0.04), transparent);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .lp-feature-card:hover {
    border-color: rgba(99,102,241,0.3);
    transform: translateY(-3px);
    box-shadow: 0 16px 40px rgba(0,0,0,0.4), 0 0 20px rgba(99,102,241,0.08);
  }
  .lp-feature-card:hover::before { opacity: 1; }

  .lp-feature-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-size: 22px;
    margin-bottom: 18px;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99,102,241,0.2);
  }

  .lp-feature-title {
    font-size: 16px;
    font-weight: 700;
    color: #f1f5f9;
    margin-bottom: 10px;
  }

  .lp-feature-desc {
    font-size: 14px;
    color: #64748b;
    line-height: 1.65;
  }

  /* ── How it works ── */
  .lp-steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 40px;
    position: relative;
  }

  .lp-steps::before {
    content: "";
    position: absolute;
    top: 24px;
    left: calc(16.66% + 24px);
    right: calc(16.66% + 24px);
    height: 1px;
    background: linear-gradient(90deg, #6366f1, #8b5cf6, #6366f1);
    opacity: 0.3;
  }

  .lp-step {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    position: relative;
    z-index: 1;
  }

  .lp-step-num {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: #fff;
    font-size: 18px;
    font-weight: 800;
    display: grid;
    place-items: center;
    box-shadow: 0 0 24px rgba(99,102,241,0.4);
    flex-shrink: 0;
  }

  .lp-step-title {
    font-size: 18px;
    font-weight: 700;
    color: #f1f5f9;
  }

  .lp-step-desc {
    font-size: 14px;
    color: #64748b;
    line-height: 1.65;
  }

  .lp-step-code {
    background: #0d1117;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    padding: 12px 16px;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 13px;
    color: #a78bfa;
    width: 100%;
  }

  /* ── CTA section ── */
  .lp-cta-section {
    padding: 100px 48px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .lp-cta-section::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 900px 500px at 50% 50%, rgba(99,102,241,0.1) 0%, transparent 70%);
    pointer-events: none;
  }

  .lp-cta-inner {
    position: relative;
    z-index: 1;
    max-width: 640px;
    margin: 0 auto;
  }

  .lp-cta-title {
    font-size: clamp(30px, 4vw, 48px);
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: -1.2px;
    line-height: 1.15;
    margin-bottom: 18px;
  }

  .lp-cta-sub {
    font-size: 17px;
    color: #64748b;
    line-height: 1.65;
    margin-bottom: 36px;
  }

  /* ── Footer ── */
  .lp-footer {
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 32px 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }

  .lp-footer-copy {
    font-size: 13px;
    color: #475569;
  }

  .lp-footer-links {
    display: flex;
    gap: 24px;
  }

  .lp-footer-links a {
    font-size: 13px;
    color: #475569;
    text-decoration: none;
    transition: color 0.15s;
  }
  .lp-footer-links a:hover { color: #94a3b8; }
  .lp-footer-links button { font-size: 13px; color: #475569; transition: color 0.15s; }
  .lp-footer-links button:hover { color: #94a3b8; }

  /* ── Divider ── */
  .lp-divider {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.05);
  }

  /* ── Responsive ── */
  @media (max-width: 900px) {
    .lp-nav { padding: 0 20px; }
    .lp-nav-links { display: none; }

    .lp-hero { padding: 60px 20px; min-height: auto; }
    .lp-hero-grid { grid-template-columns: 1fr; gap: 48px; }

    .lp-stats { padding: 32px 20px; }
    .lp-stats-inner { grid-template-columns: repeat(2, 1fr); gap: 24px; }
    .lp-stat { border-right: none; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .lp-stat:nth-child(odd) { border-right: 1px solid rgba(255,255,255,0.06); }
    .lp-stat:last-child, .lp-stat:nth-last-child(2):nth-child(odd) { border-bottom: none; }

    .lp-section { padding: 60px 20px; }
    .lp-features-grid { grid-template-columns: 1fr; }
    .lp-steps { grid-template-columns: 1fr; }
    .lp-steps::before { display: none; }

    .lp-cta-section { padding: 60px 20px; }
    .lp-footer { padding: 24px 20px; flex-direction: column; align-items: flex-start; }
  }

  @media (max-width: 600px) {
    .lp-hero-headline { font-size: 32px; }
    .lp-hero-sub { font-size: 16px; }
    .lp-hero-ctas { flex-direction: column; align-items: stretch; }
    .lp-btn-large, .lp-btn-outline-large { justify-content: center; }
  }
`;

// ─── Cost Oracle widget ──────────────────────────────────────────────────────
const PROVIDERS = [
  { id: "ibm_free",   name: "IBM Quantum (Free)",    color: "#6929c4", calc: (_q: number, _d: number, shots: number) => shots <= 10000 ? 0 : null },
  { id: "ionq",       name: "IonQ via AWS Braket",   color: "#0f62fe", calc: (_q: number, _d: number, shots: number) => 0.30 + shots * 0.00097 },
  { id: "rigetti",    name: "Rigetti via AWS",        color: "#2b5ce6", calc: (_q: number, _d: number, shots: number) => 0.30 + shots * 0.00035 },
  { id: "azure_ionq", name: "Azure Quantum (IonQ)",  color: "#0078d4", calc: (_q: number, _d: number, shots: number) => shots * 0.000975 },
  { id: "simulator",  name: "Aer Simulator (local)", color: "#10b981", calc: () => 0 },
];

function CostOracleWidget() {
  const [qubits, setQubits] = useState(2);
  const [depth, setDepth] = useState(5);
  const [shots, setShots] = useState(1024);

  const estimates = PROVIDERS.map(p => {
    const cost = p.calc(qubits, depth, shots);
    return { ...p, cost };
  }).sort((a, b) => {
    if (a.cost === null) return 1;
    if (b.cost === null) return -1;
    return a.cost - b.cost;
  });

  const maxCost = Math.max(...estimates.filter(e => e.cost !== null && e.cost > 0).map(e => e.cost as number), 0.01);

  return (
    <div style={{ background: "#0d1117", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 16, padding: 28, maxWidth: 540 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>
        Live Cost Estimate
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Qubits", val: qubits, set: setQubits, min: 1, max: 50 },
          { label: "Depth", val: depth, set: setDepth, min: 1, max: 200 },
          { label: "Shots", val: shots, set: setShots, min: 100, max: 20000 },
        ].map(({ label, val, set, min, max }) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
            <input
              type="range" min={min} max={max} value={val}
              onChange={e => set(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#6366f1" }}
            />
            <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", marginTop: 2, fontWeight: 600 }}>{val.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {estimates.map((p, i) => (
          <div key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i === 0 && p.cost === 0 && <span style={{ fontSize: 10, background: "#052e16", color: "#4ade80", border: "1px solid #16a34a", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>FREE</span>}
                {i === 0 && p.cost !== null && p.cost > 0 && <span style={{ fontSize: 10, background: "#1e1b4b", color: "#818cf8", border: "1px solid #3730a3", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>CHEAPEST</span>}
                <span style={{ fontSize: 13, color: "#e2e8f0" }}>{p.name}</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: p.cost === 0 ? "#4ade80" : "#f1f5f9", fontFamily: "monospace" }}>
                {p.cost === null ? "N/A" : p.cost === 0 ? "$0.00" : `$${p.cost.toFixed(3)}`}
              </span>
            </div>
            <div style={{ height: 4, background: "#1e293b", borderRadius: 999 }}>
              <div style={{ height: "100%", borderRadius: 999, background: p.color, width: p.cost === null ? "100%" : p.cost === 0 ? "2%" : `${Math.min(100, (p.cost / maxCost) * 100)}%`, transition: "width 0.3s", opacity: p.cost === null ? 0.2 : 1 }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, fontSize: 11, color: "#334155" }}>
        Cost per single circuit run. <a href="/register" style={{ color: "#6366f1" }}>Sign up</a> to compare any circuit with full detail.
      </div>
    </div>
  );
}

// ─── Feature card data ────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: "⚗️",
    title: "Experiment Tracking",
    desc: "Every circuit run is automatically captured — qubits, depth, gates, results, metadata. Zero boilerplate required.",
  },
  {
    icon: "📊",
    title: "Circuit Analytics",
    desc: "Visualise gate depth trends, non-Clifford ratios, and health scores across all your runs in real time.",
  },
  {
    icon: "🔌",
    title: "Multi-Provider",
    desc: "IBM Quantum, IonQ, Amazon Braket and more. One SDK, one dashboard, every backend you care about.",
  },
  {
    icon: "🤖",
    title: "AI Insights",
    desc: "Ask questions about your experiments in plain English. Q-Lab Copilot surfaces patterns your eyes would miss.",
  },
  {
    icon: "👥",
    title: "Collaboration",
    desc: "Share projects, annotate runs, and get live updates as teammates push results — no refresh needed.",
  },
  {
    icon: "📄",
    title: "Publication Tools",
    desc: "Export figures, auto-generate methods sections, and publish reproducible experiment packages to arXiv.",
  },
];

// ─── Hero routing fabric ─────────────────────────────────────────────────────
function HeroFabric() {
  const ref = useRef<HTMLCanvasElement>(null);
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
      code:      { x:.07, y:.50, r:5.5 },
      sdk:       { x:.27, y:.50, r:7   },
      qlab:      { x:.49, y:.50, r:13  },
      oracle:    { x:.49, y:.17, r:5   },
      assistant: { x:.49, y:.83, r:5   },
      ibm:       { x:.81, y:.18, r:8   },
      ionq:      { x:.86, y:.40, r:5.5 },
      rigetti:   { x:.86, y:.60, r:5.5 },
      aer:       { x:.81, y:.82, r:5.5 },
    };

    const P = (n: {x:number,y:number}) => ({ x: n.x * W, y: n.y * H });

    function bez(a:{x:number,y:number}, b:{x:number,y:number}) {
      const A = P(a), B = P(b), mx = (A.x+B.x)/2;
      ctx.beginPath(); ctx.moveTo(A.x,A.y);
      ctx.bezierCurveTo(mx,A.y,mx,B.y,B.x,B.y);
    }

    function ptBez(a:{x:number,y:number}, b:{x:number,y:number}, t:number) {
      const A=P(a),B=P(b),mx=(A.x+B.x)/2,u=1-t;
      return { x:u*u*u*A.x+3*u*u*t*mx+3*u*t*t*mx+t*t*t*B.x, y:u*u*u*A.y+3*u*u*t*A.y+3*u*t*t*B.y+t*t*t*B.y };
    }

    function edge(a:{x:number,y:number}, b:{x:number,y:number}, col:string, lw:number, alpha:number) {
      bez(a,b); ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.globalAlpha=alpha; ctx.stroke(); ctx.globalAlpha=1;
    }

    function circle(c:{x:number,y:number}, r:number, fill:string, stroke:string, lw:number) {
      ctx.beginPath(); ctx.arc(c.x,c.y,r,0,Math.PI*2);
      ctx.fillStyle=fill; ctx.fill();
      ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.stroke();
    }

    function label(n:{x:number,y:number}, text:string, side:"left"|"right"|"above"|"below") {
      ctx.fillStyle="rgba(148,163,184,0.75)";
      ctx.font="9px ui-monospace,monospace";
      ctx.textAlign = (side==="left"?"right":side==="right"?"left":"center") as CanvasTextAlign;
      const ox=side==="left"?-10:side==="right"?10:0;
      const oy=side==="above"?-12:side==="below"?14:3;
      ctx.fillText(text.toUpperCase(), P(n).x+ox, P(n).y+oy);
    }

    const PROVIDERS = [
      { node: N.ibm,     label: "ibm",     color: "#33e0c6", cycle: 3.1 },
      { node: N.ionq,    label: "ionq",    color: "#a78bfa", cycle: 2.9 },
      { node: N.rigetti, label: "rigetti", color: "#f472b6", cycle: 3.3 },
      { node: N.aer,     label: "aer_sim", color: "#60a5fa", cycle: 3.0 },
    ];
    const SWITCH_EVERY = 3.5; // seconds per provider

    function frame(ts:number) {
      if (!t0) t0=ts;
      const time=(ts-t0)/1000;
      ctx.clearRect(0,0,W,H);

      const provIdx = Math.floor(time / SWITCH_EVERY) % PROVIDERS.length;
      const prov = PROVIDERS[provIdx];
      const target = prov.node;

      // passive edges
      [[N.qlab,N.ionq],[N.qlab,N.rigetti],[N.qlab,N.aer],[N.qlab,N.oracle],[N.qlab,N.assistant],[N.qlab,N.ibm]]
        .forEach(([a,b])=>edge(a,b,"#1e2d45",1,1));
      // active edges
      [[N.code,N.sdk],[N.sdk,N.qlab],[N.qlab,target]]
        .forEach(([a,b])=>edge(a,b,"#6366f1",1.7,0.55));

      if (!reduce) {
        // particles
        ([[N.code,N.sdk,2.3],[N.sdk,N.qlab,2.7],[N.qlab,target,prov.cycle]] as any[]).forEach(([a,b,cyc])=>{
          for(let k=0;k<3;k++){
            const ph=((time/cyc)+k/3)%1;
            const pt=ptBez(a,b,ph);
            ctx.globalAlpha=0.25+0.75*Math.sin(ph*Math.PI);
            ctx.fillStyle=prov.color;
            ctx.beginPath(); ctx.arc(pt.x,pt.y,2.8,0,Math.PI*2); ctx.fill();
          }
        });
        ctx.globalAlpha=1;
        // hub ring
        const C=P(N.qlab), pulse=0.45-0.45*Math.abs(Math.sin(time*1.8));
        ctx.globalAlpha=pulse;
        ctx.beginPath(); ctx.arc(C.x,C.y,N.qlab.r+7+5*Math.abs(Math.sin(time*1.8)),0,Math.PI*2);
        ctx.strokeStyle="#6366f1"; ctx.lineWidth=1.2; ctx.stroke();
        ctx.globalAlpha=1;
      }

      // nodes — active provider gets glow treatment
      PROVIDERS.forEach(p => {
        const isActive = p.node === target;
        circle(P(p.node), p.node.r,
          isActive ? `${p.color}1a` : "#070c1a",
          isActive ? p.color : "#1e2d45",
          isActive ? 1.8 : 1.5);
      });
      [[N.oracle,"#1e2d45"],[N.assistant,"#1e2d45"]]
        .forEach(([n,s]) => circle(P(n as any),(n as any).r,"#070c1a",s as string,1.5));
      circle(P(N.sdk), N.sdk.r, "rgba(99,102,241,0.1)", "#6366f1", 1.7);
      circle(P(N.code),N.code.r,"rgba(99,102,241,0.1)","#6366f1",1.5);
      circle(P(N.qlab),N.qlab.r,"rgba(99,102,241,0.15)","#6366f1",2);

      label(N.code,"code","left");
      label(N.sdk,"sdk","above");
      label(N.qlab,"Q-LAB","above");
      label(N.oracle,"cost oracle","above");
      label(N.assistant,"assistant","below");
      PROVIDERS.forEach(p => {
        const isActive = p.node === target;
        label(p.node, isActive ? `${p.label} ★` : p.label, "right");
      });

      raf=requestAnimationFrame(frame);
    }

    const ro=new ResizeObserver(resize);
    ro.observe(canvas); resize();
    raf=requestAnimationFrame(frame);
    return ()=>{ cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div style={{
      background:"radial-gradient(130% 130% at 65% 10%,rgba(99,102,241,0.07),transparent 60%),#080c18",
      border:"1px solid rgba(99,102,241,0.2)",
      borderRadius:18, overflow:"hidden", position:"relative",
      boxShadow:"0 24px 64px rgba(0,0,0,0.5)",
    }}>
      <div style={{ position:"relative", width:"100%", aspectRatio:"16/11", maxHeight:420 }}>
        <canvas ref={ref} style={{ position:"absolute", inset:0, width:"100%", height:"100%" }} />
      </div>
      <span style={{
        position:"absolute", bottom:10, left:16,
        fontFamily:"ui-monospace,monospace", fontSize:10,
        letterSpacing:"0.17em", textTransform:"uppercase", color:"#3d506a",
      }}>live routing fabric · q-lab</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMsg, setContactMsg] = useState("");
  const [contactStatus, setContactStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContactStatus("sending");
    try {
      const res = await fetch("/qlab-api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: contactName, email: contactEmail, message: contactMsg }),
      });
      if (!res.ok) throw new Error();
      setContactStatus("sent");
      setContactName(""); setContactEmail(""); setContactMsg("");
    } catch {
      setContactStatus("error");
    }
  }

  function openContact() { setContactOpen(true); setContactStatus("idle"); }

  // Authenticated users visiting "/" get a dashboard link, not a redirect,
  // so they can still read the landing page but have a clear path in.
  const isAuthed = mounted && !loading && !!user;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div className="lp-root">
        {/* ── Navbar ─────────────────────────────────────────────────────── */}
        <nav className="lp-nav">
          <a href="/" className="lp-logo">
            <span className="lp-logo-icon">⚛</span>
            Q-Lab
          </a>

          <ul className="lp-nav-links">
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How it works</a></li>
            <li><a href="https://github.com/soqlab/Q-lab" target="_blank" rel="noopener noreferrer">GitHub</a></li>
            <li><button onClick={openContact} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>Contact</button></li>
          </ul>

          <div className="lp-nav-actions">
            {isAuthed ? (
              <>
                <Link href="/runs" className="lp-btn lp-btn-ghost">
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="lp-btn lp-btn-ghost">
                  Sign In
                </Link>
                <Link href="/register" className="lp-btn lp-btn-primary">
                  Get Started Free
                </Link>
              </>
            )}
          </div>
        </nav>

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-grid">
            {/* Left column */}
            <div>
              <div className="lp-badge">
                <span className="lp-badge-dot" />
                MIT License · Open Source · Self-Hostable
              </div>

              <h1 className="lp-hero-headline">
                Experiment Tracking for{" "}
                <span>Quantum Researchers</span>
              </h1>

              <p className="lp-hero-sub">
                Log, compare, and reproduce Qiskit experiments across IBM Quantum, IonQ, and Braket — one SDK call, zero configuration.
              </p>

              <div className="lp-hero-ctas">
                {isAuthed ? (
                  <Link href="/runs" className="lp-btn lp-btn-primary lp-btn-large">
                    Go to Dashboard →
                  </Link>
                ) : (
                  <>
                    <Link href="/register" className="lp-btn lp-btn-primary lp-btn-large">
                      Get Started Free →
                    </Link>
                    <a href="https://github.com/soqlab/Q-lab/blob/main/SELF_HOSTING.md" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-outline-large">
                      🖥 Self-Host
                    </a>
                  </>
                )}
              </div>

              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <a href="https://github.com/soqlab/Q-lab" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 6, padding: "4px 10px", textDecoration: "none", fontFamily: "ui-monospace,monospace" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
                  MIT · Open Source
                </a>
                <a href="https://github.com/soqlab/Q-lab/blob/main/SELF_HOSTING.md" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 6, padding: "4px 10px", textDecoration: "none", fontFamily: "ui-monospace,monospace" }}>
                  🖥 Self-hostable
                </a>
              </div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#3d506a", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "ui-monospace,monospace" }}>Featured on</span>
                <a href="https://buildlist.io/?ref=cb60ee99-6bed-47ba-93c6-08916112a6e4" target="_blank" rel="noopener noreferrer">
                  <img src="https://buildlist.io/badge.svg" alt="Featured on Buildlist" style={{ height: 28, width: "auto", opacity: 0.85, verticalAlign: "middle" }} />
                </a>
                <a target="_blank" rel="noopener noreferrer" href="https://betalist.com/startups/q-lab?utm_campaign=badge-q-lab&utm_medium=badge&utm_source=badge-featured">
                  <img alt="Featured on BetaList" width="117" height="40" style={{ width: 117, height: 40, opacity: 0.85, verticalAlign: "middle" }} src="https://betalist.com/badges/featured?id=180588&theme=dark" />
                </a>
                <a href="https://peerpush.com/p/q-lab" target="_blank" rel="noopener noreferrer">
                  <img src="https://peerpush.com/p/q-lab/badge.png" alt="Q-Lab on PeerPush" style={{ height: 28, width: "auto", opacity: 0.85, verticalAlign: "middle" }} />
                </a>
              </div>
            </div>

            {/* Right column — routing fabric */}
            <HeroFabric />
          </div>
        </section>

        {/* ── Stats strip ────────────────────────────────────────────────── */}
        <div className="lp-stats">
          <div className="lp-stats-inner">
            {[
              { value: "1 line", label: "SDK Setup" },
              { value: "IBM · IonQ · Braket", label: "Supported Providers" },
              { value: "Open Source", label: "Codebase" },
              { value: "Free Tier", label: "No credit card" },
            ].map((s) => (
              <div key={s.label} className="lp-stat">
                <div className="lp-stat-value">{s.value}</div>
                <div className="lp-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <hr className="lp-divider" />

        {/* ── Cost Oracle ────────────────────────────────────────────────────── */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "100px 48px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div>
            <div className="lp-section-label">Cost Oracle</div>
            <h2 className="lp-section-title">Know the cost before you run</h2>
            <p className="lp-section-sub">
              Enterprises are terrified of runaway QPU bills. Q-Lab tells you exactly what your circuit will cost across every provider — before you submit a single shot.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                "Real pricing across IBM, IonQ, Rigetti, Azure, and more",
                "Adjust qubits, depth, and shots — costs update instantly",
                "Routes to the cheapest provider that meets your fidelity target",
              ].map(f => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "#94a3b8" }}>
                  <span style={{ color: "#6366f1", marginTop: 1, flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <a href="/register" className="lp-btn lp-btn-primary">Try Cost Oracle Free →</a>
          </div>
          <CostOracleWidget />
        </div>

        <hr className="lp-divider" />

        {/* ── Features ───────────────────────────────────────────────────── */}
        <div className="lp-section" id="features">
          <div className="lp-section-label">Features</div>
          <h2 className="lp-section-title">
            Everything a quantum research team needs
          </h2>
          <p className="lp-section-sub">
            From circuit capture to publication, Q-Lab handles the full lifecycle
            so you can focus on the science.
          </p>

          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <div className="lp-feature-title">{f.title}</div>
                <div className="lp-feature-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <hr className="lp-divider" />

        {/* ── How it works ───────────────────────────────────────────────── */}
        <div className="lp-section" id="how-it-works">
          <div className="lp-section-label">How it works</div>
          <h2 className="lp-section-title">
            Up and running in under 60 seconds
          </h2>
          <p className="lp-section-sub">
            No configuration files. No YAML. Just one line and you&apos;re tracking.
          </p>

          <div className="lp-steps">
            {[
              {
                num: "1",
                title: "Install the SDK",
                desc: "One pip command, no system dependencies. Works alongside any Qiskit or PennyLane workflow you already have.",
                code: `pip install qlab-sdk`,
              },
              {
                num: "2",
                title: "Enable auto-tracking",
                desc: "Call qlab.auto_track() once. Q-Lab automatically patches Qiskit's Sampler and Estimator — no other code changes needed.",
                code: `qlab.auto_track(api_key="YOUR_API_KEY")`,
              },
              {
                num: "3",
                title: "Track everything",
                desc: "Every circuit execution is captured — backend, depth, qubit count, results, calibration data, and timestamps.",
                code: "# nothing else required",
              },
            ].map((step) => (
              <div key={step.num} className="lp-step">
                <div className="lp-step-num">{step.num}</div>
                <div className="lp-step-title">{step.title}</div>
                <div className="lp-step-desc">{step.desc}</div>
                <div className="lp-step-code">{step.code}</div>
              </div>
            ))}
          </div>
        </div>

        <hr className="lp-divider" />

        {/* ── Open source CTA ────────────────────────────────────────────── */}
        <div className="lp-cta-section">
          <div className="lp-cta-inner">
            <h2 className="lp-cta-title">
              Free to use. Free to run yourself.
            </h2>
            <p className="lp-cta-sub">
              Use the hosted version at no cost, deploy your own instance in minutes, or contribute to the codebase.
              MIT license — no strings attached.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 36, textAlign: "left" }}>
              {[
                {
                  icon: "☁️",
                  title: "Use hosted",
                  desc: "Sign up and start tracking immediately. No setup, free forever.",
                  cta: isAuthed ? null : { label: "Get Started →", href: "/register", internal: true },
                },
                {
                  icon: "🖥",
                  title: "Self-host",
                  desc: "Run Q-Lab on your own servers. Docker Compose, one command.",
                  cta: { label: "Read the guide →", href: "https://github.com/soqlab/Q-lab/blob/main/SELF_HOSTING.md", internal: false },
                },
                {
                  icon: "🔧",
                  title: "Contribute",
                  desc: "Fix bugs, add providers, improve the SDK. All PRs welcome.",
                  cta: { label: "CONTRIBUTING.md →", href: "https://github.com/soqlab/Q-lab/blob/main/CONTRIBUTING.md", internal: false },
                },
              ].map(card => (
                <div key={card.title} style={{ background: "rgba(15,15,25,0.8)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "22px 20px" }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>{card.icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>{card.title}</div>
                  <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, marginBottom: 14 }}>{card.desc}</div>
                  {card.cta && (
                    card.cta.internal
                      ? <Link href={card.cta.href} style={{ fontSize: 13, color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>{card.cta.label}</Link>
                      : <a href={card.cta.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>{card.cta.label}</a>
                  )}
                </div>
              ))}
            </div>
            <a href="https://github.com/soqlab/Q-lab" target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 16px", textDecoration: "none", fontFamily: "ui-monospace,monospace" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.744 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
              ⭐ Star on GitHub
            </a>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="lp-footer">
          <span className="lp-footer-copy">
            © {new Date().getFullYear()} Q-Lab — MIT License. Built in the open.
          </span>
          <div className="lp-footer-links">
            <a href="https://github.com/soqlab/Q-lab" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://github.com/soqlab/Q-lab/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing</a>
            <a href="https://github.com/soqlab/Q-lab/blob/main/SELF_HOSTING.md" target="_blank" rel="noopener noreferrer">Self-Host</a>
            <button onClick={openContact} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>Contact</button>
            {!isAuthed && (
              <>
                <Link href="/login">Sign In</Link>
                <Link href="/register">Register</Link>
              </>
            )}
          </div>
        </footer>
      </div>

      {/* ── Contact modal ───────────────────────────────────────────────── */}
      {contactOpen && (
        <div onClick={() => setContactOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#111827", border: "1px solid #1e293b", borderRadius: 16,
            padding: "36px 32px", width: "100%", maxWidth: 480,
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ color: "#f1f5f9", fontSize: 20, fontWeight: 700, margin: 0 }}>Get in touch</h2>
              <button onClick={() => setContactOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>

            {contactStatus === "sent" ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
                <div style={{ color: "#10b981", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Message sent!</div>
                <div style={{ color: "#94a3b8", fontSize: 14 }}>{"We'll get back to you as soon as possible."}</div>
                <button onClick={() => setContactOpen(false)} style={{ marginTop: 20, padding: "10px 28px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>Close</button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleContactSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</label>
                  <input
                    required value={contactName} onChange={(e) => setContactName(e.target.value)}
                    placeholder="Your name"
                    style={{ width: "100%", padding: "10px 14px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</label>
                  <input
                    required type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="you@example.com"
                    style={{ width: "100%", padding: "10px 14px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Message</label>
                  <textarea
                    required rows={4} value={contactMsg} onChange={(e) => setContactMsg(e.target.value)}
                    placeholder="Tell us about your research or ask anything…"
                    style={{ width: "100%", padding: "10px 14px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", fontSize: 14, outline: "none", resize: "vertical" }}
                  />
                </div>
                {contactStatus === "error" && (
                  <div style={{ color: "#f87171", fontSize: 13 }}>Something went wrong — please try again or email us directly.</div>
                )}
                <button
                  type="submit" disabled={contactStatus === "sending"}
                  style={{ padding: "12px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, cursor: contactStatus === "sending" ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 15, opacity: contactStatus === "sending" ? 0.7 : 1 }}
                >
                  {contactStatus === "sending" ? "Sending…" : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
