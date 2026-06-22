"use client";

import { useEffect, useState, useCallback } from "react";

const API = "/qlab-api";

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  education: "#3b82f6",
  chemistry: "#8b5cf6",
  optimization: "#f59e0b",
  benchmarking: "#06b6d4",
  cryptography: "#10b981",
  ml: "#f97316",
  custom: "#6b7280",
};

const ALGO_CHIPS: Record<string, string> = {
  vqe: "VQE",
  qaoa: "QAOA",
  grover: "Grover",
  qft: "QFT",
  custom: "Custom",
};

// ─── Code block with copy ────────────────────────────────────────────────────

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
        <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>{label}</span>
        <button
          onClick={copy}
          style={{ background: "#1e293b", border: "1px solid #334155", color: copied ? "#10b981" : "#3b82f6", borderRadius: 6, padding: "0.3rem 0.7rem", cursor: "pointer", fontSize: 12 }}
        >
          {copied ? "Copied!" : `Copy ${label}`}
        </button>
      </div>
      <pre style={{
        background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
        padding: "1rem", overflowX: "auto", color: "#94a3b8", fontSize: "0.78rem",
        lineHeight: 1.6, maxHeight: 220, margin: 0,
      }}>
        {code}
      </pre>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function UseModal({ result, onClose }: { result: UseResult; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000099", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
    }} onClick={onClose}>
      <div
        style={{ background: "#1e293b", borderRadius: 16, border: "1px solid #334155", padding: "1.5rem", maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ color: "#e2e8f0", margin: 0, fontSize: 16, fontWeight: 700 }}>{result.name}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>x</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <CodeBlock code={result.qasm} label="QASM" />
          <CodeBlock code={result.python_code} label="Python" />
          <div style={{ background: "#0f172a", border: "1px solid #10b98133", borderRadius: 8, padding: "0.75rem 1rem", color: "#10b981", fontSize: 12 }}>
            {result.run_instructions}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Template card ───────────────────────────────────────────────────────────

function TemplateCard({
  t, onStar, onFork, onUse, featured,
}: {
  t: Template;
  onStar: (id: string) => void;
  onFork: (id: string) => void;
  onUse: (id: string) => void;
  featured?: boolean;
}) {
  const catColor = CATEGORY_COLORS[t.category] ?? "#6b7280";

  return (
    <div style={{
      background: "#1e293b",
      borderRadius: 12,
      border: `1px solid ${featured ? catColor + "55" : "#334155"}`,
      padding: "1.25rem",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minWidth: featured ? 260 : undefined,
      width: featured ? 280 : undefined,
      flexShrink: featured ? 0 : undefined,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{t.name}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <span style={{ background: catColor + "22", color: catColor, border: `1px solid ${catColor}44`, borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>
              {t.category}
            </span>
            {t.algorithm !== "custom" && (
              <span style={{ background: "#33415522", color: "#94a3b8", borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
                {ALGO_CHIPS[t.algorithm] ?? t.algorithm}
              </span>
            )}
            <span style={{ background: "#0f172a", color: "#64748b", borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
              {t.n_qubits_range[0] === t.n_qubits_range[1] ? `${t.n_qubits_range[0]}q` : `${t.n_qubits_range[0]}-${t.n_qubits_range[1]}q`}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          {t.is_verified && <span title="Verified" style={{ fontSize: 14 }}>✓</span>}
          {t.is_featured && <span title="Featured" style={{ fontSize: 12, color: "#f59e0b" }}>★</span>}
        </div>
      </div>

      {/* Description */}
      <p style={{ color: "#94a3b8", fontSize: 12, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {t.description}
      </p>

      {/* Author */}
      <div style={{ color: "#475569", fontSize: 11 }}>
        {t.author}{t.institution ? ` · ${t.institution}` : ""}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b" }}>
        <span title="Stars">★ {t.star_count}</span>
        <span title="Forks">⑂ {t.fork_count}</span>
        <span title="Runs">▷ {t.run_count}</span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button
          onClick={() => onStar(t.template_id)}
          style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", color: "#f59e0b", borderRadius: 6, padding: "0.4rem", cursor: "pointer", fontSize: 12 }}
        >
          Star
        </button>
        <button
          onClick={() => onFork(t.template_id)}
          style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "0.4rem", cursor: "pointer", fontSize: 12 }}
        >
          Fork
        </button>
        <button
          onClick={() => onUse(t.template_id)}
          style={{ flex: 2, background: "#3b82f6", border: "none", color: "#fff", borderRadius: 6, padding: "0.4rem", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          Use Template
        </button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const SORTS = [
  { value: "most_starred", label: "Most Starred" },
  { value: "most_forked", label: "Most Forked" },
  { value: "most_run", label: "Most Run" },
  { value: "newest", label: "Newest" },
];

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
      if (activeAlgo) params.set("algorithm", activeAlgo);
      if (search) params.set("search", search);
      params.set("sort", sort);

      const [t, f, c] = await Promise.all([
        fetch(`${API}/api/v1/experiment-templates/?${params}`).then(r => r.json()),
        fetch(`${API}/api/v1/experiment-templates/featured`).then(r => r.json()),
        fetch(`${API}/api/v1/experiment-templates/categories`).then(r => r.json()),
      ]);
      setTemplates(Array.isArray(t) ? t : []);
      setFeatured(Array.isArray(f) ? f : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
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
      const res = await fetch(`${API}/api/v1/experiment-templates/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parameters: {} }),
      }).then(r => r.json());
      setUseResult({ qasm: res.qasm, python_code: res.python_code, run_instructions: res.run_instructions, name: res.name });
    } catch {
      // ignore
    }
  };

  const totalTemplates = templates.length;
  const totalForks = templates.reduce((s, t) => s + t.fork_count, 0);
  const totalRuns = templates.reduce((s, t) => s + t.run_count, 0);

  const algorithms = [...new Set(templates.map(t => t.algorithm).filter(a => a !== "custom"))];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
      {/* Hero */}
      <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "#e2e8f0", margin: "0 0 0.4rem 0" }}>
          Experiment Template Marketplace
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.95rem" }}>
          Community-curated quantum circuits. Fork, star, and run in one click.
        </p>
        {/* Stat strip */}
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: "1rem" }}>
          {[
            { label: "Templates", value: totalTemplates },
            { label: "Total Forks", value: totalForks },
            { label: "Total Runs", value: totalRuns },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ color: "#3b82f6", fontSize: 22, fontWeight: 800 }}>{value}</div>
              <div style={{ color: "#64748b", fontSize: 11 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Featured horizontal scroll */}
      {featured.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 600, marginBottom: "0.75rem" }}>Featured</h2>
          <div style={{ display: "flex", gap: "1rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
            {featured.map(t => (
              <TemplateCard key={t.template_id} t={t} onStar={handleStar} onFork={handleFork} onUse={handleUse} featured />
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates…"
          style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "0.5rem 0.9rem", fontSize: 13, width: 200 }}
        />

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveCategory(null)}
            style={{ padding: "0.4rem 0.9rem", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: !activeCategory ? "#3b82f6" : "#1e293b", color: !activeCategory ? "#fff" : "#64748b" }}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c.category}
              onClick={() => setActiveCategory(activeCategory === c.category ? null : c.category)}
              style={{ padding: "0.4rem 0.9rem", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: activeCategory === c.category ? "#3b82f6" : "#1e293b", color: activeCategory === c.category ? "#fff" : "#94a3b8" }}
            >
              {c.category} <span style={{ opacity: 0.7 }}>({c.count})</span>
            </button>
          ))}
        </div>

        {/* Algorithm filter */}
        {algorithms.length > 0 && (
          <select
            value={activeAlgo ?? ""}
            onChange={e => setActiveAlgo(e.target.value || null)}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", padding: "0.45rem 0.75rem", fontSize: 12 }}
          >
            <option value="">All Algorithms</option>
            {algorithms.map(a => <option key={a} value={a}>{ALGO_CHIPS[a] ?? a}</option>)}
          </select>
        )}

        {/* Sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", padding: "0.45rem 0.75rem", fontSize: 12, marginLeft: "auto" }}
        >
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Main grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "#64748b" }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "#475569" }}>No templates found.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {templates.map(t => (
            <TemplateCard key={t.template_id} t={t} onStar={handleStar} onFork={handleFork} onUse={handleUse} />
          ))}
        </div>
      )}

      {/* Use modal */}
      {useResult && <UseModal result={useResult} onClose={() => setUseResult(null)} />}
    </div>
  );
}
