"use client";

import { useEffect, useState } from "react";
import { fetchExperimentDesign, fetchProjects, ExperimentDesignResult, ExperimentSuggestion, Project } from "../../../lib/api";

function SuggestionCard({ s, rank }: { s: ExperimentSuggestion; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <div style={{ border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden", background: "#0f172a" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "none", border: "none", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#4f46e5", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            #{rank}
          </span>
          <div style={{ textAlign: "left" }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
              {s.num_qubits}q · depth {s.depth} · {s.shots.toLocaleString()} shots · opt {s.optimization_level}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              Health: <span style={{ color: "#34d399", fontWeight: 600 }}>{s.predicted_health.toFixed(1)}</span>
              {" "}±{s.uncertainty.toFixed(1)}
              {" "}· EI: <span style={{ color: "#818cf8" }}>{s.expected_improvement.toFixed(3)}</span>
            </p>
          </div>
        </div>
        <span style={{ color: "#475569", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "12px 18px 18px", borderTop: "1px solid #1e293b" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Configuration</p>
              {[
                ["Qubits", s.num_qubits],
                ["Circuit Depth", s.depth],
                ["Shots", s.shots.toLocaleString()],
                ["Opt Level", s.optimization_level],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, borderBottom: "1px solid #0f172a" }}>
                  <span style={{ color: "#64748b" }}>{label}</span>
                  <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            <div>
              <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>GP Estimates</p>
              {[
                ["Predicted Health", <span key="v" style={{ color: "#34d399", fontWeight: 600 }}>{s.predicted_health.toFixed(2)}</span>],
                ["Uncertainty (1σ)", <span key="v" style={{ color: "#fbbf24", fontWeight: 600 }}>±{s.uncertainty.toFixed(2)}</span>],
                ["Exp. Improvement", <span key="v" style={{ color: "#818cf8", fontWeight: 600 }}>{s.expected_improvement.toFixed(4)}</span>],
                ["Novelty", <span key="v" style={{ color: "#c084fc", fontWeight: 600 }}>{s.novelty.toFixed(3)}</span>],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, borderBottom: "1px solid #0f172a" }}>
                  <span style={{ color: "#64748b" }}>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: "#475569" }}>Predicted health score</p>
            <div style={{ height: 6, background: "#1e293b", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, s.predicted_health)}%`, background: "linear-gradient(90deg, #4f46e5, #34d399)", borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#334155", marginTop: 4 }}>
              <span>0</span>
              <span style={{ color: "#34d399" }}>{s.predicted_health.toFixed(1)}</span>
              <span>100</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExperimentDesignPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [slug, setSlug] = useState("");
  const [n, setN] = useState(5);
  const [data, setData] = useState<ExperimentDesignResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) setSlug(ps[0].slug);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (slug) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  function run() {
    if (!slug.trim()) return;
    setLoading(true);
    setErr(null);
    setData(null);
    fetchExperimentDesign(slug.trim(), n)
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#f1f5f9" }}>Bayesian Experiment Design</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>
          Gaussian Process surrogate model suggests next experiments to maximise your quantum circuit health score.
        </p>
      </div>

      {/* Controls */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 20px", marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Project
            </label>
            {projects.length > 0 ? (
              <select
                value={slug}
                onChange={e => setSlug(e.target.value)}
                style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#f1f5f9", outline: "none", cursor: "pointer" }}
              >
                {projects.map(p => (
                  <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
                ))}
              </select>
            ) : (
              <input
                value={slug}
                onChange={e => setSlug(e.target.value)}
                onKeyDown={e => e.key === "Enter" && run()}
                placeholder="my-project-slug"
                style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#f1f5f9", outline: "none" }}
              />
            )}
          </div>

          <div style={{ width: 130 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              Suggestions
            </label>
            <select
              value={n}
              onChange={e => setN(Number(e.target.value))}
              style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#f1f5f9", outline: "none", cursor: "pointer" }}
            >
              {[3, 5, 8, 10].map(v => <option key={v} value={v}>{v} suggestions</option>)}
            </select>
          </div>

          <button
            onClick={run}
            disabled={loading || !slug.trim()}
            style={{
              padding: "10px 22px", background: loading ? "#312e81" : "#4f46e5", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
              opacity: !slug.trim() ? 0.4 : 1, transition: "background 0.15s", whiteSpace: "nowrap",
            }}
          >
            {loading ? "Computing…" : "Run"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: "12px 16px", fontSize: 14, color: "#f87171", marginBottom: 20 }}>
          {err}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#475569", fontSize: 14 }}>
          Running Gaussian Process optimisation…
        </div>
      )}

      {data && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 20, padding: "14px 18px", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 13 }}>
            <span style={{ color: "#64748b" }}>Trained on <strong style={{ color: "#f1f5f9" }}>{data.n_training_runs}</strong> runs</span>
            <span style={{ color: "#64748b" }}>Best health: <strong style={{ color: "#34d399" }}>{data.best_health_seen.toFixed(1)}</strong></span>
            <span style={{ color: "#64748b" }}>GP length scale: <strong style={{ color: "#f1f5f9" }}>{data.length_scale.toFixed(3)}</strong></span>
          </div>

          {data.suggestions.map((s, i) => (
            <SuggestionCard key={i} s={s} rank={i + 1} />
          ))}

          <p style={{ fontSize: 11, color: "#334155", textAlign: "right" }}>
            Computed {data.computed_at.slice(0, 19).replace("T", " ")} UTC
          </p>
        </div>
      )}
    </div>
  );
}
