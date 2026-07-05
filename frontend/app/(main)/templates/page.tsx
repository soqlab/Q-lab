"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";

const API = "/qlab-api";

interface Template {
  template_id: string;
  name: string;
  slug: string;
  description: string;
  algorithm: string;
  category: string;
  author: string;
  institution?: string | null;
  qasm_circuit: string;
  python_code: string;
  parameters_schema: Record<string, unknown>;
  n_qubits_range: [number, number];
  tags: string[];
  paper_reference?: string | null;
  fork_count: number;
  run_count: number;
  star_count: number;
  is_verified: boolean;
  is_featured: boolean;
  created_at: string;
}

interface CategoryCount { category: string; count: number }

interface UseResult {
  qasm: string;
  python_code: string;
  run_instructions: string;
  name: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  education:    "#3b82f6",
  chemistry:    "#8b5cf6",
  optimization: "#f59e0b",
  benchmarking: "#06b6d4",
  cryptography: "#10b981",
  ml:           "#f97316",
  custom:       "var(--muted)",
};

const ALGO_CHIPS: Record<string, string> = {
  vqe: "VQE", qaoa: "QAOA", grover: "Grover", qft: "QFT", custom: "Custom",
};

const SORTS = [
  { value: "most_starred", label: "Most Starred" },
  { value: "most_forked",  label: "Most Forked" },
  { value: "most_run",     label: "Most Run" },
  { value: "newest",       label: "Newest" },
];

async function safeFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `HTTP ${r.status}`);
  }
  return r.json();
}

// ── Code block with copy ──────────────────────────────────────────────────────
function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{label}</span>
        <button
          onClick={copy}
          className="button secondary"
          style={{ height: 28, fontSize: 11 }}
        >
          {copied ? "Copied!" : `Copy ${label}`}
        </button>
      </div>
      <pre style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8,
        padding: "12px 14px", overflowX: "auto", color: "var(--text)", fontSize: 11,
        lineHeight: 1.6, maxHeight: 220, margin: 0, fontFamily: "ui-monospace,monospace",
      }}>
        {code}
      </pre>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function UseModal({ result, onClose }: { result: UseResult; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div
        className="panel"
        style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", borderRadius: 16, margin: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 style={{ margin: 0, fontSize: 15 }}>{result.name}</h2>
          <button onClick={onClose} className="button secondary" style={{ height: 30, width: 30, padding: 0, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <CodeBlock code={result.qasm} label="QASM" />
          <CodeBlock code={result.python_code} label="Python" />
          <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, padding: "10px 14px", color: "var(--ok)", fontSize: 12 }}>
            {result.run_instructions}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────
function TemplateCard({
  t, onStar, onFork, onUse, featured,
}: {
  t: Template;
  onStar: (id: string) => void;
  onFork: (id: string) => void;
  onUse: (id: string) => void;
  featured?: boolean;
}) {
  const catColor = CATEGORY_COLORS[t.category] ?? "var(--muted)";
  const [hover, setHover] = useState(false);

  return (
    <div
      style={{
        background: "var(--surface)", borderRadius: 12,
        border: `1px solid ${hover ? catColor : "var(--line)"}`,
        padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10,
        minWidth: featured ? 260 : undefined, width: featured ? 280 : undefined,
        flexShrink: featured ? 0 : undefined,
        transition: "border-color 0.15s",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{t.name}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <span style={{ background: catColor + "20", color: catColor, border: `1px solid ${catColor}40`, borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>
              {t.category}
            </span>
            {t.algorithm !== "custom" && (
              <span style={{ background: "var(--info-bg)", color: "var(--muted)", borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
                {ALGO_CHIPS[t.algorithm] ?? t.algorithm}
              </span>
            )}
            <span style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
              {t.n_qubits_range[0] === t.n_qubits_range[1] ? `${t.n_qubits_range[0]}q` : `${t.n_qubits_range[0]}-${t.n_qubits_range[1]}q`}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          {t.is_verified && <span title="Verified" style={{ fontSize: 13, color: "var(--ok)" }}>✓</span>}
          {t.is_featured && <span title="Featured" style={{ fontSize: 12, color: "#f59e0b" }}>★</span>}
        </div>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {t.description}
      </p>

      <div style={{ color: "var(--muted)", fontSize: 11 }}>
        {t.author}{t.institution ? ` · ${t.institution}` : ""}
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)" }}>
        <span title="Stars">★ {t.star_count}</span>
        <span title="Forks">⑂ {t.fork_count}</span>
        <span title="Runs">▷ {t.run_count}</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button onClick={() => onStar(t.template_id)} className="button secondary" style={{ flex: 1, height: 30, fontSize: 12, color: "#f59e0b" }}>
          Star
        </button>
        <button onClick={() => onFork(t.template_id)} className="button secondary" style={{ flex: 1, height: 30, fontSize: 12 }}>
          Fork
        </button>
        <button onClick={() => onUse(t.template_id)} className="button" style={{ flex: 2, height: 30, fontSize: 12 }}>
          Use Template
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TemplateMarketplacePage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [featured, setFeatured] = useState<Template[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeAlgo, setActiveAlgo] = useState<string | null>(null);
  const [sort, setSort] = useState("most_starred");

  const [useResult, setUseResult] = useState<UseResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeCategory) params.set("category", activeCategory);
      if (activeAlgo)     params.set("algorithm", activeAlgo);
      if (search)         params.set("search", search);
      params.set("sort", sort);

      const [t, f, c] = await Promise.all([
        safeFetch(`${API}/api/v1/experiment-templates/?${params}`),
        safeFetch(`${API}/api/v1/experiment-templates/featured`),
        safeFetch(`${API}/api/v1/experiment-templates/categories`),
      ]);
      setTemplates(Array.isArray(t) ? t : []);
      setFeatured(Array.isArray(f) ? f : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load templates";
      setError(msg.includes("fetch") ? "Backend is warming up — please retry in a moment." : msg);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, activeAlgo, search, sort]);

  useEffect(() => { load(); }, [load]);

  const handleStar = async (id: string) => {
    await fetch(`${API}/api/v1/experiment-templates/${id}/star`, { method: "POST" }).catch(() => null);
    load();
  };

  const handleFork = async (id: string) => {
    await fetch(`${API}/api/v1/experiment-templates/${id}/fork`, { method: "POST" }).catch(() => null);
    load();
  };

  const handleUse = async (id: string) => {
    try {
      const res = await safeFetch(`${API}/api/v1/experiment-templates/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameters: {} }),
      });
      setUseResult({ qasm: res.qasm, python_code: res.python_code, run_instructions: res.run_instructions, name: res.name });
    } catch { /* ignore */ }
  };

  const totalForks = templates.reduce((s, t) => s + t.fork_count, 0);
  const totalRuns  = templates.reduce((s, t) => s + t.run_count, 0);
  const algorithms = [...new Set(templates.map(t => t.algorithm).filter(a => a !== "custom"))];

  return (
    <main className="page">
      {/* Hero */}
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: "0 0 6px" }}>
          Experiment Template Marketplace
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Community-curated quantum circuits. Fork, star, and run in one click.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginTop: 16 }}>
          {[
            { label: "Templates", value: templates.length },
            { label: "Total Forks", value: totalForks },
            { label: "Total Runs", value: totalRuns },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ color: "var(--strong)", fontSize: 22, fontWeight: 800 }}>{value}</div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 16px", color: "var(--danger)", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{error}</span>
          <button className="button secondary" style={{ height: 30, fontSize: 12, flexShrink: 0 }} onClick={() => void load()}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Featured scroll */}
      {featured.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Featured</h2>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
            {featured.map(t => (
              <TemplateCard key={t.template_id} t={t} onStar={handleStar} onFork={handleFork} onUse={handleUse} featured />
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && void load()}
          placeholder="Search templates…"
          style={{ width: 200 }}
        />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveCategory(null)}
            className={activeCategory ? "button secondary" : "button"}
            style={{ height: 32, fontSize: 12 }}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c.category}
              onClick={() => setActiveCategory(activeCategory === c.category ? null : c.category)}
              className={activeCategory === c.category ? "button" : "button secondary"}
              style={{ height: 32, fontSize: 12 }}
            >
              {c.category} <span style={{ opacity: 0.7 }}>({c.count})</span>
            </button>
          ))}
        </div>
        {algorithms.length > 0 && (
          <select
            className="input"
            value={activeAlgo ?? ""}
            onChange={e => setActiveAlgo(e.target.value || null)}
            style={{ width: 150 }}
          >
            <option value="">All Algorithms</option>
            {algorithms.map(a => <option key={a} value={a}>{ALGO_CHIPS[a] ?? a}</option>)}
          </select>
        )}
        <select
          className="input"
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{ width: 150, marginLeft: "auto" }}
        >
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)", fontSize: 14 }}>
          Loading templates…
        </div>
      ) : templates.length === 0 && !error ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)", fontSize: 14 }}>
          No templates found.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {templates.map(t => (
            <TemplateCard key={t.template_id} t={t} onStar={handleStar} onFork={handleFork} onUse={handleUse} />
          ))}
        </div>
      )}

      {useResult && <UseModal result={useResult} onClose={() => setUseResult(null)} />}
    </main>
  );
}
