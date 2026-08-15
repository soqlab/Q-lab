"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Activity, BarChart2, Bell, Clock, Cpu, FlaskConical, Folder, GitCompare, Globe, Grid, History, LineChart, MessageSquare, Radio, ScatterChart, Send, Settings, Shield, Users, Zap, FlaskRound, Share2, Play, Download, DollarSign, Lock, ScrollText, GitBranch, GitCommit, Atom, Key, BellRing, Layers, Server, Sliders, BookOpen, AlertTriangle, Dna, HeartPulse, Search, AlertOctagon, Shuffle, RefreshCw, ArrowRightLeft, Lightbulb, Fingerprint, TrendingDown, GitMerge, Navigation, Terminal, Award, Filter, Wand2, BarChart3, Trophy, Network, ShieldCheck, Workflow, Rocket, TrendingUp, Brain, Calculator, FileImage, Wifi, BookMarked, Timer, Scan, FileCode, Bug, Target, Scissors, ShoppingCart, Building2, Waves, Eye, Microscope, BookText, Database, Bot, Beaker, MonitorDot, Coins, GitPullRequest, BadgeCheck, Wrench, GraduationCap, Briefcase, Boxes, Globe2, Package, ChevronDown, ChevronRight } from "lucide-react";
import { useAuth } from "../../lib/auth";

type NavItem = { href: string; icon: React.ElementType; label: string; badge?: string };

const GROUPS: { label: string; defaultOpen: boolean; items: NavItem[] }[] = [
  {
    label: "Core",
    defaultOpen: true,
    items: [
      { href: "/runs", icon: History, label: "Run History" },
      { href: "/analytics", icon: LineChart, label: "Analytics" },
      { href: "/projects", icon: Folder, label: "Projects" },
      { href: "/timeline", icon: Clock, label: "Timeline" },
      { href: "/assistant", icon: Bot, label: "Lab Assistant" },
      { href: "/onboarding", icon: Rocket, label: "Quick Start" },
    ],
  },
  {
    label: "Experiments",
    defaultOpen: true,
    items: [
      { href: "/campaigns", icon: FlaskConical, label: "Campaigns" },
      { href: "/sweep", icon: ScatterChart, label: "Param Sweep" },
      { href: "/benchmarks", icon: BarChart2, label: "Benchmarks" },
      { href: "/compare", icon: GitCompare, label: "Compare Runs" },
      { href: "/compare/matrix", icon: Grid, label: "Matrix Compare" },
      { href: "/compare/stats", icon: BarChart2, label: "Stats Compare" },
      { href: "/predict", icon: Brain, label: "Predict / Timing" },
      { href: "/templates", icon: BookOpen, label: "Templates" },
      { href: "/design", icon: FlaskRound, label: "Exp Design" },
      { href: "/preregister", icon: Lock, label: "Pre-register" },
    ],
  },
  {
    label: "Circuits",
    defaultOpen: false,
    items: [
      { href: "/circuit-designer", icon: Wand2, label: "Circuit Designer" },
      { href: "/nl2qasm", icon: Terminal, label: "NL → QASM" },
      { href: "/search/circuits", icon: ScatterChart, label: "Circuit Search" },
      { href: "/circuits/versions", icon: GitCommit, label: "Circuit Versions" },
      { href: "/analyze", icon: Search, label: "Circuit Analyzer" },
      { href: "/evolve", icon: Dna, label: "Circuit Evolver" },
      { href: "/dna", icon: Fingerprint, label: "Circuit DNA" },
      { href: "/circuit-debugger", icon: Bug, label: "Circuit Debugger" },
      { href: "/circuit-ancestry", icon: GitCommit, label: "Circuit Ancestry" },
      { href: "/circuit-knitting", icon: Scissors, label: "Circuit Knitting" },
      { href: "/mirror-circuit", icon: Shuffle, label: "Mirror Circuit" },
      { href: "/circuit-marketplace", icon: ShoppingCart, label: "Circuit Market" },
      { href: "/bloch-animator", icon: Globe, label: "Bloch Animator" },
      { href: "/figure-gen", icon: FileImage, label: "Figure Generator" },
      { href: "/code-export", icon: Download, label: "Code Exporter" },
    ],
  },
  {
    label: "Hardware",
    defaultOpen: false,
    items: [
      { href: "/hardware", icon: Cpu, label: "Hardware Rec" },
      { href: "/calibration", icon: Radio, label: "Calibration" },
      { href: "/backends", icon: Cpu, label: "Backends" },
      { href: "/hardware-drift", icon: Activity, label: "HW Drift Alerts" },
      { href: "/calibration-monitor", icon: HeartPulse, label: "Cal Monitor" },
      { href: "/network", icon: Globe, label: "Cal Network" },
      { href: "/cal-forecast", icon: HeartPulse, label: "Cal Forecast" },
      { href: "/compare/backends", icon: GitCompare, label: "Backend Compare" },
      { href: "/backend-emulator", icon: Cpu, label: "Backend Emulator" },
      { href: "/settings/decoherence", icon: AlertTriangle, label: "Decoherence" },
      { href: "/hardware-jobs", icon: Server, label: "Hardware Jobs" },
      { href: "/global-cal", icon: Globe, label: "Global Cal DB" },
      { href: "/providers", icon: Server, label: "Multi-Provider" },
      { href: "/costs", icon: DollarSign, label: "QPU Costs" },
      { href: "/cost-arbitrage", icon: Coins, label: "Cost Arbitrage" },
      { href: "/cost-oracle", icon: DollarSign, label: "Cost Oracle" },
    ],
  },
  {
    label: "AI & Analysis",
    defaultOpen: false,
    items: [
      { href: "/ask", icon: MessageSquare, label: "AI Research" },
      { href: "/search/natural", icon: MessageSquare, label: "NLQ Search" },
      { href: "/recommend", icon: Lightbulb, label: "Recommender" },
      { href: "/autopilot", icon: Rocket, label: "Autopilot" },
      { href: "/qfm", icon: Brain, label: "QFM AI" },
      { href: "/hypothesis", icon: BarChart3, label: "Hypothesis Engine" },
      { href: "/hypotheses", icon: Lightbulb, label: "Hypotheses" },
      { href: "/bayes-opt", icon: TrendingDown, label: "Bayes Opt" },
      { href: "/bayes-uncertainty", icon: BarChart3, label: "Bayes Uncertainty" },
      { href: "/causal", icon: Share2, label: "Causal Analysis" },
      { href: "/causal-inference", icon: GitMerge, label: "Causal Inference" },
      { href: "/anomaly-physics", icon: AlertOctagon, label: "Physics Checker" },
      { href: "/stats-engine", icon: Calculator, label: "Stats Engine" },
      { href: "/multi-comparisons", icon: Calculator, label: "Multi-Comparisons" },
      { href: "/rl-optimizer", icon: Bot, label: "RL Optimizer" },
      { href: "/synthetic-data", icon: Beaker, label: "Synthetic Data" },
    ],
  },
  {
    label: "Quantum Tools",
    defaultOpen: false,
    items: [
      { href: "/qec", icon: Shield, label: "QEC Synthesizer" },
      { href: "/statetomo", icon: Atom, label: "State Tomography" },
      { href: "/tomography", icon: Scan, label: "Tomography" },
      { href: "/gate-tomo", icon: Scan, label: "Gate Tomography" },
      { href: "/process-tomo", icon: Scan, label: "Process Tomography" },
      { href: "/qv", icon: Layers, label: "Quantum Volume" },
      { href: "/qvbench", icon: Award, label: "QV Benchmarker" },
      { href: "/rb-suite", icon: BarChart3, label: "RB Suite" },
      { href: "/rb-gst", icon: BarChart2, label: "RB / GST / SPAM" },
      { href: "/xeb", icon: Target, label: "XEB Fidelity" },
      { href: "/zne-pec", icon: Filter, label: "ZNE / PEC" },
      { href: "/error-mitigate", icon: Filter, label: "Error Mitigation" },
      { href: "/auto-mitigation", icon: Wand2, label: "Auto-Mitigation", badge: "Preview" },
      { href: "/error-budget", icon: BarChart3, label: "Error Budget" },
      { href: "/dd-optimizer", icon: Wand2, label: "DD Optimizer" },
      { href: "/syndrome-decoder", icon: ShieldCheck, label: "Syndrome Decoder" },
      { href: "/cliffordt", icon: Layers, label: "Clifford+T Counter" },
      { href: "/clifford-sim", icon: Network, label: "Clifford Sim" },
      { href: "/tensor-network", icon: Workflow, label: "Tensor Network" },
      { href: "/entanglement", icon: GitBranch, label: "Entanglement Map" },
      { href: "/trotter", icon: Activity, label: "Trotter Evolution" },
      { href: "/landscape", icon: TrendingDown, label: "VQE Landscape" },
      { href: "/variational", icon: Atom, label: "Variational" },
      { href: "/hamiltonian", icon: Calculator, label: "Hamiltonian Studio" },
      { href: "/qaoa", icon: Network, label: "QAOA Solver" },
      { href: "/qml", icon: Brain, label: "QML Workbench" },
      { href: "/qml-datasets", icon: Boxes, label: "QML Datasets" },
      { href: "/quantum-chem", icon: FlaskConical, label: "Quantum Chem" },
      { href: "/quantum-sensing", icon: Navigation, label: "Quantum Sensing" },
      { href: "/quantum-finance", icon: DollarSign, label: "Quantum Finance", badge: "Preview" },
      { href: "/quantum-network", icon: Wifi, label: "Quantum Network" },
      { href: "/quantum-internet", icon: Globe2, label: "Quantum Internet" },
      { href: "/protocol-sim", icon: ShieldCheck, label: "QKD Simulator" },
      { href: "/channel-capacity", icon: Radio, label: "Channel Capacity" },
      { href: "/noise-model", icon: Sliders, label: "Noise Model" },
      { href: "/noise-marketplace", icon: ShieldCheck, label: "Noise Market" },
      { href: "/noiserouter", icon: Navigation, label: "Noise Router" },
      { href: "/spectral-noise", icon: Waves, label: "Spectral Noise" },
      { href: "/pulse-control", icon: Waves, label: "Pulse Control" },
      { href: "/unitary-synth", icon: Wand2, label: "Unitary Synth" },
      { href: "/transpile", icon: ArrowRightLeft, label: "Transpiler" },
      { href: "/transpiler-hub", icon: ArrowRightLeft, label: "Transpiler Hub" },
      { href: "/gates", icon: Sliders, label: "Gate Char" },
      { href: "/ensemble", icon: GitMerge, label: "Backend Ensemble" },
      { href: "/semantic-search", icon: Search, label: "Circuit Sim. Search" },
      { href: "/chaos", icon: AlertOctagon, label: "Chaos Engineering" },
      { href: "/qrng", icon: Shuffle, label: "Quantum RNG" },
      { href: "/speedup", icon: Rocket, label: "Speedup Certifier" },
      { href: "/complexity", icon: TrendingUp, label: "Complexity Analyzer" },
      { href: "/advantage", icon: Zap, label: "Advantage Detector" },
      { href: "/advantage-timeline", icon: Timer, label: "Advantage Timeline" },
      { href: "/certify", icon: BadgeCheck, label: "Advantage Certifier" },
      { href: "/resource-estimator", icon: Award, label: "Resource Estimator" },
      { href: "/optimizer-hub", icon: Trophy, label: "Optimizer Hub" },
      { href: "/hpc-bridge", icon: Server, label: "HPC Bridge" },
    ],
  },
  {
    label: "Publishing",
    defaultOpen: false,
    items: [
      { href: "/doi", icon: BookMarked, label: "DOI / ORCID" },
      { href: "/peer-review", icon: FileCode, label: "Peer Review" },
      { href: "/fair", icon: ShieldCheck, label: "FAIR Compliance" },
      { href: "/grants", icon: Award, label: "Grant Reports" },
      { href: "/carbon", icon: Beaker, label: "Carbon Footprint" },
      { href: "/reproducibility", icon: RefreshCw, label: "Reproducibility" },
      { href: "/federated", icon: Globe2, label: "Fed. Registry" },
      { href: "/arxiv", icon: BookMarked, label: "arXiv Search" },
      { href: "/arxiv-feed", icon: BookOpen, label: "arXiv Feed" },
      { href: "/arxiv-radar", icon: Radio, label: "arXiv Radar" },
      { href: "/paper-draft", icon: ScrollText, label: "Paper Draft" },
      { href: "/methods-gen", icon: ScrollText, label: "Methods Gen" },
      { href: "/grant-proposal", icon: ScrollText, label: "Grant Proposals" },
      { href: "/dataset-publish", icon: Database, label: "Dataset Publisher" },
      { href: "/conference", icon: FileImage, label: "Conference Builder" },
      { href: "/meta-analysis", icon: BookText, label: "Meta-Analysis" },
      { href: "/research-graph", icon: Network, label: "Research Graph" },
      { href: "/research-pipeline", icon: Workflow, label: "Research Pipeline" },
      { href: "/replication", icon: RefreshCw, label: "Replication Mkt" },
      { href: "/paper-replication", icon: RefreshCw, label: "Paper Replication" },
      { href: "/blind-analysis", icon: Eye, label: "Blind Analysis" },
      { href: "/oed", icon: Microscope, label: "Optimal Exp Design" },
    ],
  },
  {
    label: "Integrations",
    defaultOpen: false,
    items: [
      { href: "/integrations", icon: GitPullRequest, label: "GitHub + Slack" },
      { href: "/github-ci", icon: GitPullRequest, label: "GitHub CI" },
      { href: "/webhooks", icon: Zap, label: "Webhooks" },
      { href: "/cicd", icon: GitBranch, label: "CI/CD" },
      { href: "/dispatch", icon: Send, label: "Dispatch Queue" },
      { href: "/jobs", icon: Play, label: "Job Executor" },
      { href: "/job-scheduler", icon: Timer, label: "Job Scheduler" },
      { href: "/queue", icon: Server, label: "Queue Intel" },
      { href: "/live-monitor", icon: MonitorDot, label: "Live Monitor" },
      { href: "/ingest", icon: Download, label: "Ingest" },
      { href: "/offline-export", icon: Download, label: "Offline Export" },
      { href: "/environment", icon: Layers, label: "Env Snapshots" },
      { href: "/plugins", icon: Package, label: "Plugins" },
      { href: "/collab-notebook", icon: FileCode, label: "Collab Notebooks", badge: "Preview" },
      { href: "/notebook", icon: FileCode, label: "Notebooks" },
    ],
  },
  {
    label: "Team & Community",
    defaultOpen: false,
    items: [
      { href: "/team", icon: Users, label: "Team" },
      { href: "/departments", icon: Building2, label: "Departments" },
      { href: "/researchers", icon: GraduationCap, label: "Researchers" },
      { href: "/institute", icon: Building2, label: "Institute Dashboard" },
      { href: "/collab", icon: Users, label: "Collab Rooms" },
      { href: "/social", icon: Share2, label: "Social Graph" },
      { href: "/challenges", icon: Trophy, label: "Challenges" },
      { href: "/benchmark-leaderboard", icon: Trophy, label: "Live Leaderboard" },
      { href: "/learn", icon: GraduationCap, label: "Learning Paths" },
      { href: "/talent", icon: Briefcase, label: "Talent Board" },
      { href: "/registry", icon: BookMarked, label: "Exp Registry" },
      { href: "/cross-bench", icon: BarChart3, label: "Cross-Bench" },
      { href: "/copilot", icon: MessageSquare, label: "Q-Lab Copilot" },
      { href: "/lab-inventory", icon: Wrench, label: "Lab Inventory" },
    ],
  },
  {
    label: "Settings",
    defaultOpen: false,
    items: [
      { href: "/feedback", icon: MessageSquare, label: "Send Feedback" },
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/settings/policy", icon: Shield, label: "Policy Gates" },
      { href: "/settings/rbac", icon: Lock, label: "RBAC" },
      { href: "/settings/audit", icon: ScrollText, label: "Audit Log" },
      { href: "/settings/alerts", icon: Bell, label: "Alerts" },
      { href: "/settings/notifications", icon: BellRing, label: "Notifications" },
      { href: "/credentials", icon: Key, label: "Credentials" },
      { href: "/gdpr", icon: Lock, label: "GDPR Tools" },
      { href: "/billing", icon: Coins, label: "Usage & Billing" },
    ],
  },
];

function NavGroup({
  label,
  defaultOpen,
  items,
  pathname,
}: {
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
  pathname: string;
}) {
  const storageKey = `qlab_nav_${label}`;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) setOpen(saved === "1");
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem(storageKey, next ? "1" : "0");
  }

  const hasActive = items.some((i) => i.href === pathname);

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={toggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: hasActive ? "var(--nav-active-bg, rgba(99,102,241,0.08))" : "transparent",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          color: "var(--color-muted, #5f6f80)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        <span>{label}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div style={{ paddingLeft: 4 }}>
          {items.map(({ href, icon: Icon, label: lbl, badge }) => (
            <Link
              key={href}
              className={`nav-link${pathname === href ? " active" : ""}`}
              href={href}
            >
              <Icon size={18} aria-hidden="true" />
              <span style={{ flex: 1 }}>{lbl}</span>
              {badge && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", background: "rgba(245,158,11,0.15)", color: "#f59e0b", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                  {badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AIQuotaBar() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<{ used: number; limit: number; remaining: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/qlab-api/api/v1/ai-usage", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setUsage(d); })
      .catch(() => {});
  }, [token]);

  if (!usage) return null;

  const pct = Math.round((usage.used / usage.limit) * 100);
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#6366f1";

  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          AI Credits
        </span>
        <span style={{ fontSize: 11, color: pct >= 90 ? "#ef4444" : "#64748b", fontWeight: 600 }}>
          {usage.remaining}/{usage.limit}
        </span>
      </div>
      <div style={{ height: 4, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999, transition: "width 0.3s" }} />
      </div>
      {usage.remaining === 0 && (
        <p style={{ margin: "5px 0 0", fontSize: 10, color: "#ef4444" }}>Limit reached — resets midnight UTC</p>
      )}
    </div>
  );
}

function GetStartedBanner() {
  const { token } = useAuth();
  const [hasRuns, setHasRuns] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("qlab_gs_dismissed")) { setDismissed(true); return; }
    if (!token) return;
    fetch("/qlab-api/api/v1/runs?limit=1", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setHasRuns(d && d.items ? d.items.length > 0 : (Array.isArray(d) ? d.length > 0 : null)))
      .catch(() => {});
  }, [token]);

  function dismiss() {
    localStorage.setItem("qlab_gs_dismissed", "1");
    setDismissed(true);
  }

  if (dismissed || hasRuns === null || hasRuns === true) return null;

  return (
    <div style={{ margin: "8px 8px 4px", background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 10, padding: "12px 14px", position: "relative" }}>
      <button onClick={dismiss} style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, lineHeight: 1, padding: 2 }}>×</button>
      <div style={{ fontSize: 18, marginBottom: 6 }}>🚀</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Ready to track your first run?</div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>Set up the SDK in under 2 minutes.</div>
      <a href="/onboarding" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#fff", background: "#6366f1", padding: "6px 12px", borderRadius: 6, textDecoration: "none" }}>
        Get Started →
      </a>
    </div>
  );
}

export default function SideNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <nav className="nav" aria-label="Primary">
      <GetStartedBanner />
      {GROUPS.map((group) => (
        <NavGroup
          key={group.label}
          label={group.label}
          defaultOpen={group.defaultOpen}
          items={group.items}
          pathname={pathname}
        />
      ))}
      <AIQuotaBar />
    </nav>
  );
}
