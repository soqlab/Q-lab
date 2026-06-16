"use client";
import { useEffect, useState } from "react";
import { Suggestion, RecommendationResponse, getRecommendations } from "../../../lib/api";
import { Lightbulb, ChevronRight, Search, Zap } from "lucide-react";

const STRATEGY_META: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  by_popularity:         { label: "Popular Unrun",     color: "#3b82f6", icon: "🔥", desc: "Templates popular with others that you haven't tried yet" },
  by_progression:        { label: "Progression",       color: "#8b5cf6", icon: "📈", desc: "Curated next-step experiments based on your recent work" },
  by_backend_diversity:  { label: "Backend Diversity",  color: "#f59e0b", icon: "🌐", desc: "Try experiments on backends you haven't used yet" },
  by_parameter_scaling:  { label: "Parameter Scaling",  color: "#10b981", icon: "⬆️", desc: "Scale up qubit count or depth from your recent experiments" },
};

function SuggestionCard({ s, strategy }: { s: Suggestion; strategy: string }) {
  const meta = STRATEGY_META[strategy] ?? { label: strategy, color: "#64748b", icon: "💡", desc: "" };
  const name = s.name ?? s.template?.name ?? "Unnamed";
  const category = s.template?.category;
  const nQubits = s.template?.n_qubits;
  const backend = s.suggested_backend ?? s.reference_backend;
  return (
    <div style={{ background: "#1e293b", borderRadius: 10, border: `1px solid ${meta.color}30`, padding: "0.9rem", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: "1rem" }}>{meta.icon}</span>
            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>{name}</span>
          </div>
          <div style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: 6 }}>{s.reason}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ background: meta.color + "22", color: meta.color, fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: 4 }}>{meta.label}</span>
            <span style={{ background: "#334155", color: "#94a3b8", fontSize: "0.68rem", padding: "1px 6px", borderRadius: 4 }}>{s.type}</span>
            {category && <span style={{ background: "#0f172a", color: "#64748b", fontSize: "0.68rem", padding: "1px 6px", borderRadius: 4 }}>{category}</span>}
            {nQubits && <span style={{ background: "#0f172a", color: "#64748b", fontSize: "0.68rem", padding: "1px 6px", borderRadius: 4 }}>{nQubits}q</span>}
            {backend && <span style={{ background: "#0f172a", color: "#64748b", fontSize: "0.68rem", padding: "1px 6px", borderRadius: 4 }}>{backend}</span>}
          </div>
        </div>
        <button
          style={{ display: "flex", alignItems: "center", gap: 4, background: meta.color, color: "#fff", border: "none", borderRadius: 6, padding: "0.35rem 0.65rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, marginLeft: 10, flexShrink: 0 }}>
          Use <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

export default function RecommendPage() {
  const [runId, setRunId] = useState("");
  const [limit, setLimit] = useState(12);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStrategy, setActiveStrategy] = useState<string>("all");

  useEffect(() => { fetchRecommendations(); }, []);

  const fetchRecommendations = async () => {
    setLoading(true); setError(null);
    try { setResult(await getRecommendations(runId || undefined, limit)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const strategyLists: Record<string, Suggestion[]> = result
    ? {
        by_popularity: result.by_popularity,
        by_progression: result.by_progression,
        by_backend_diversity: result.by_backend_diversity,
        by_parameter_scaling: result.by_parameter_scaling,
      }
    : {};

  const allSuggestions = result?.all_suggestions ?? [];
  const strategyCounts = Object.fromEntries(
    Object.entries(strategyLists).map(([k, v]) => [k, v.length])
  );

  const visibleItems: Array<{ s: Suggestion; strategy: string }> =
    activeStrategy === "all"
      ? allSuggestions.map(s => ({ s, strategy: "by_popularity" }))
      : (strategyLists[activeStrategy] ?? []).map(s => ({ s, strategy: activeStrategy }));

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
          <Lightbulb size={28} color="#f59e0b" /> AI Experiment Recommender
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
          Content-based recommendations from 4 strategies: domain progression, popular unrun templates, backend diversity, and parameter scaling.
        </p>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
          Base Run ID (optional)
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <input value={runId} onChange={e => setRunId(e.target.value)} placeholder="run_abc123"
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", fontFamily: "monospace", fontSize: "0.82rem", width: 200 }} />
            <button onClick={fetchRecommendations} disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#f59e0b", color: "#0f172a", border: "none", borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontWeight: 700, opacity: loading ? 0.6 : 1, fontSize: "0.85rem" }}>
              <Search size={14} /> {loading ? "Loading…" : "Get Recommendations"}
            </button>
          </div>
        </label>
        <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
          Limit: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{limit}</span>
          <input type="range" min={4} max={24} step={4} value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ display: "block", marginTop: 4, width: 120, accentColor: "#f59e0b" }} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "1.5rem" }}>
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1rem" }}>
            <h3 style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 600, marginBottom: 10 }}>Strategy Filter</h3>
            <button onClick={() => setActiveStrategy("all")}
              style={{ display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", background: activeStrategy === "all" ? "#0f172a" : "transparent", border: `1px solid ${activeStrategy === "all" ? "#475569" : "transparent"}`, borderRadius: 6, padding: "0.45rem 0.6rem", cursor: "pointer", marginBottom: 4 }}>
              <span style={{ color: "#e2e8f0", fontSize: "0.85rem" }}>All Suggestions</span>
              <span style={{ background: "#334155", color: "#94a3b8", borderRadius: 99, fontSize: "0.72rem", padding: "1px 7px" }}>{allSuggestions.length}</span>
            </button>
            {Object.entries(STRATEGY_META).map(([key, meta]) => (
              <button key={key} onClick={() => setActiveStrategy(key)}
                style={{ display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", background: activeStrategy === key ? meta.color + "18" : "transparent", border: `1px solid ${activeStrategy === key ? meta.color + "40" : "transparent"}`, borderRadius: 6, padding: "0.45rem 0.6rem", cursor: "pointer", marginBottom: 4 }}>
                <span style={{ color: activeStrategy === key ? meta.color : "#94a3b8", fontSize: "0.82rem" }}>{meta.icon} {meta.label}</span>
                <span style={{ background: activeStrategy === key ? meta.color + "22" : "#334155", color: activeStrategy === key ? meta.color : "#64748b", borderRadius: 99, fontSize: "0.72rem", padding: "1px 7px" }}>{strategyCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>

          {result && (
            <div style={{ background: "#1e293b", borderRadius: 10, border: "1px solid #334155", padding: "0.75rem", marginTop: "1rem" }}>
              <div style={{ color: "#64748b", fontSize: "0.72rem", marginBottom: 4 }}>Context</div>
              <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>{result.context.recent_runs_analyzed} recent runs analyzed</div>
              {result.context.backends_seen.length > 0 && (
                <div style={{ color: "#64748b", fontSize: "0.72rem", marginTop: 4 }}>Backends: {result.context.backends_seen.join(", ")}</div>
              )}
            </div>
          )}
        </div>

        <div>
          {result ? (
            <div>
              {activeStrategy !== "all" && STRATEGY_META[activeStrategy] && (
                <div style={{ background: STRATEGY_META[activeStrategy].color + "12", borderRadius: 10, border: `1px solid ${STRATEGY_META[activeStrategy].color}30`, padding: "0.75rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "1.2rem" }}>{STRATEGY_META[activeStrategy].icon}</span>
                  <div>
                    <div style={{ color: STRATEGY_META[activeStrategy].color, fontWeight: 700, fontSize: "0.9rem" }}>{STRATEGY_META[activeStrategy].label}</div>
                    <div style={{ color: "#64748b", fontSize: "0.78rem" }}>{STRATEGY_META[activeStrategy].desc}</div>
                  </div>
                </div>
              )}

              {visibleItems.length === 0 ? (
                <div style={{ textAlign: "center", color: "#475569", padding: "3rem" }}>
                  <Lightbulb size={40} style={{ opacity: 0.15, marginBottom: 10 }} />
                  <p>No recommendations available for this strategy yet. Run more experiments to generate context.</p>
                </div>
              ) : (
                visibleItems.slice(0, limit).map(({ s, strategy }, i) => (
                  <SuggestionCard key={i} s={s} strategy={activeStrategy !== "all" ? activeStrategy : strategy} />
                ))
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#475569" }}>
              <Lightbulb size={60} style={{ opacity: 0.12, marginBottom: 16 }} />
              {loading ? <p>Loading recommendations…</p> : <p>Fetch recommendations to see suggestions.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
