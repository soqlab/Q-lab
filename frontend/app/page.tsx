"use client";

import { useEffect, useState } from "react";
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
            <li><a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a></li>
            <li><button onClick={openContact} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", font: "inherit", padding: 0 }}>Contact</button></li>
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
                Now in public beta
              </div>

              <h1 className="lp-hero-headline">
                The Research Platform{" "}
                <span>Quantum Scientists</span>{" "}
                Actually Use
              </h1>

              <p className="lp-hero-sub">
                Track experiments across IBM Quantum, IonQ, and Braket. Collaborate
                in real-time. Never lose a result again.
              </p>

              <div className="lp-hero-ctas">
                {isAuthed ? (
                  <Link href="/runs" className="lp-btn lp-btn-primary lp-btn-large">
                    Go to Dashboard →
                  </Link>
                ) : (
                  <Link href="/register" className="lp-btn lp-btn-primary lp-btn-large">
                    Get Started Free →
                  </Link>
                )}
              </div>
            </div>

            {/* Right column — code card */}
            <div className="lp-code-card">
              <div className="lp-code-bar">
                <span className="lp-code-dot" style={{ background: "#ff5f57" }} />
                <span className="lp-code-dot" style={{ background: "#ffbd2e" }} />
                <span className="lp-code-dot" style={{ background: "#28c840" }} />
                <span className="lp-code-filename">bell_state.py</span>
              </div>
              <div className="lp-code-body">
                <span className="lp-code-keyword">import</span>{" "}
                <span className="lp-code-import">qlab</span>
                {"\n"}
                <span className="lp-code-hl">
                  <span className="lp-code-func">qlab</span>
                  <span style={{ color: "#f1f5f9" }}>.</span>
                  <span className="lp-code-func">init</span>
                  <span style={{ color: "#f1f5f9" }}>()</span>
                  {"  "}
                  <span className="lp-code-comment"># that&apos;s it</span>
                </span>
                {"\n"}
                <span className="lp-code-keyword">from</span>{" "}
                <span className="lp-code-import">qiskit</span>{" "}
                <span className="lp-code-keyword">import</span>{" "}
                <span style={{ color: "#f1f5f9" }}>QuantumCircuit</span>
                {"\n\n"}
                <span style={{ color: "#f1f5f9" }}>qc</span>{" = "}
                <span className="lp-code-func">QuantumCircuit</span>
                <span style={{ color: "#f1f5f9" }}>(2)</span>
                {"\n"}
                <span style={{ color: "#f1f5f9" }}>qc</span>
                <span style={{ color: "#f1f5f9" }}>.</span>
                <span className="lp-code-func">h</span>
                <span style={{ color: "#f1f5f9" }}>(0); qc.</span>
                <span className="lp-code-func">cx</span>
                <span style={{ color: "#f1f5f9" }}>(0, 1)</span>
                {"\n"}
                <span className="lp-code-comment">
                  # ↑ Q-Lab tracks it automatically
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stats strip ────────────────────────────────────────────────── */}
        <div className="lp-stats">
          <div className="lp-stats-inner">
            {[
              { value: "80+", label: "Integrated Tools" },
              { value: "IBM · IonQ · Braket", label: "Supported Providers" },
              { value: "Real-time", label: "Collaboration" },
              { value: "Zero Config", label: "SDK Setup" },
            ].map((s) => (
              <div key={s.label} className="lp-stat">
                <div className="lp-stat-value">{s.value}</div>
                <div className="lp-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
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
            No configuration files. No YAML. Just three lines and you&apos;re tracking.
          </p>

          <div className="lp-steps">
            {[
              {
                num: "1",
                title: "Install the SDK",
                desc: "One pip command, no system dependencies. Works alongside any Qiskit or PennyLane workflow you already have.",
                code: "pip install qlab-sdk",
              },
              {
                num: "2",
                title: "Initialise once",
                desc: "Call qlab.init() at the top of your script or notebook. Q-Lab patches Qiskit's QuantumCircuit transparently.",
                code: "qlab.init()",
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

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        <div className="lp-cta-section">
          <div className="lp-cta-inner">
            <h2 className="lp-cta-title">
              Ready to build quantum experiments that matter?
            </h2>
            <p className="lp-cta-sub">
              Join researchers who use Q-Lab to capture, compare, and reproduce
              every circuit run — from prototype to publication.
            </p>
            {isAuthed ? (
              <Link href="/runs" className="lp-btn lp-btn-primary lp-btn-large">
                Open Dashboard →
              </Link>
            ) : (
              <Link href="/register" className="lp-btn lp-btn-primary lp-btn-large">
                Start for Free →
              </Link>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="lp-footer">
          <span className="lp-footer-copy">
            © {new Date().getFullYear()} Q-Lab. Quantum experiment tracking for research teams.
          </span>
          <div className="lp-footer-links">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <button onClick={openContact} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", font: "inherit", padding: 0 }}>
              Contact
            </button>
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
