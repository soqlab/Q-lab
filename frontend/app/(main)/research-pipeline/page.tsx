"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createResearchPipeline,
  advanceResearchPipeline,
  listResearchPipelines,
  ResearchPipeline,
  PipelineStage,
} from "@/lib/api";

const STAGE_ORDER = [
  "hypothesis",
  "literature_review",
  "experimental_design",
  "implementation",
  "execution",
  "analysis",
  "validation",
  "writing",
  "submission",
];

function stageIcon(status: string): { icon: string; color: string } {
  if (status === "completed") return { icon: "✓", color: "var(--ok)" };
  if (status === "active") return { icon: "▶", color: "var(--strong)" };
  return { icon: "○", color: "var(--muted)" };
}

function StageStepper({
  stages,
  currentStage,
}: {
  stages: PipelineStage[];
  currentStage: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {(stages ?? []).map((stage, i) => {
        const { icon, color } = stageIcon(stage.status);
        const isActive = stage.name === currentStage;

        const circleStyle = isActive
          ? {
              border: "2px solid var(--strong)",
              background: "rgba(30,27,75,0.9)",
              color: "var(--strong)",
            }
          : stage.status === "completed"
          ? {
              border: "2px solid var(--ok)",
              background: "rgba(16,185,129,0.1)",
              color: "var(--ok)",
            }
          : {
              border: "2px solid var(--line)",
              background: "var(--surface)",
              color: "var(--muted)",
            };

        return (
          <div key={i} style={{ display: "flex", gap: 16 }}>
            {/* Line + icon column */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  height: 32,
                  width: 32,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  ...circleStyle,
                }}
              >
                <span style={{ color }}>{icon}</span>
              </div>
              {i < stages.length - 1 && (
                <div
                  style={{
                    margin: "4px 0",
                    width: 2,
                    flex: 1,
                    minHeight: 24,
                    background:
                      stage.status === "completed"
                        ? "rgba(16,185,129,0.3)"
                        : "var(--line)",
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div
              style={{
                paddingBottom: i === stages.length - 1 ? 0 : 16,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    textTransform: "capitalize",
                    color: isActive ? "var(--strong)" : "var(--text)",
                  }}
                >
                  {stage.name.replace(/_/g, " ")}
                </span>
                {isActive && (
                  <span
                    style={{
                      borderRadius: 999,
                      background: "rgba(49,46,129,0.6)",
                      padding: "2px 8px",
                      fontSize: 12,
                      color: "var(--strong)",
                    }}
                  >
                    Active
                  </span>
                )}
              </div>
              {(stage.artifacts ?? []).length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginBottom: 4,
                  }}
                >
                  {(stage.artifacts ?? []).map((a, j) => (
                    <span
                      key={j}
                      style={{
                        borderRadius: 6,
                        background: "var(--line)",
                        padding: "2px 6px",
                        fontSize: 12,
                        color: "var(--text)",
                      }}
                    >
                      {a}
                    </span>
                  ))}
                </div>
              )}
              {(stage.auto_checks ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(stage.auto_checks ?? []).map((c, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: 12,
                        color: c.passed ? "var(--ok)" : "var(--danger)",
                      }}
                    >
                      {c.passed ? "✓" : "✗"} {c.check}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PipelineDetail({
  pipeline,
  onAdvanced,
}: {
  pipeline: ResearchPipeline;
  onAdvanced: (updated: ResearchPipeline) => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const updated = await advanceResearchPipeline(pipeline.pipeline_id);
      onAdvanced(updated);
    } catch (err: unknown) {
      setAdvanceError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAdvancing(false);
    }
  };

  const isComplete = pipeline.overall_completion_pct >= 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: 4,
          }}
        >
          {pipeline.title}
        </h2>
        <p style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
          {pipeline.hypothesis}
        </p>
      </div>

      {/* Progress bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 4,
          }}
        >
          <span>Overall Progress</span>
          <span>{pipeline.overall_completion_pct}%</span>
        </div>
        <div
          style={{ height: 8, borderRadius: 999, background: "var(--line)" }}
        >
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "var(--strong)",
              width: `${pipeline.overall_completion_pct}%`,
            }}
          />
        </div>
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
        <span
          style={{
            borderRadius: 999,
            border: "1px solid var(--strong)",
            background: "rgba(30,27,75,0.8)",
            padding: "4px 12px",
            color: "var(--strong)",
          }}
        >
          {pipeline.current_stage.replace(/_/g, " ")}
        </span>
        <span
          style={{
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            padding: "4px 12px",
            color: "var(--text)",
          }}
        >
          {pipeline.algorithm}
        </span>
        <span
          style={{
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            padding: "4px 12px",
            color: "var(--text)",
          }}
        >
          {pipeline.backend}
        </span>
      </div>

      {/* Stepper */}
      <StageStepper stages={pipeline.stages} currentStage={pipeline.current_stage} />

      {/* Advance button */}
      {!isComplete && (
        <div>
          {advanceError && (
            <div
              style={{
                marginBottom: 8,
                borderRadius: 8,
                border: "1px solid var(--danger)",
                background: "rgba(239,68,68,0.1)",
                padding: "12px 16px",
                fontSize: 13,
                color: "var(--danger)",
              }}
            >
              {advanceError}
            </div>
          )}
          <button
            onClick={handleAdvance}
            disabled={advancing}
            style={{
              width: "100%",
              borderRadius: 8,
              background: "var(--strong)",
              padding: "10px 0",
              fontWeight: 600,
              color: "var(--text)",
              border: "none",
              cursor: advancing ? "not-allowed" : "pointer",
              opacity: advancing ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            {advancing ? "Advancing..." : "Advance to Next Stage"}
          </button>
        </div>
      )}
      {isComplete && (
        <div
          style={{
            borderRadius: 8,
            border: "1px solid var(--ok)",
            background: "rgba(16,185,129,0.1)",
            padding: "12px 16px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--ok)",
            fontWeight: 600,
          }}
        >
          Pipeline Complete
        </div>
      )}
    </div>
  );
}

export default function ResearchPipelinePage() {
  const [pipelines, setPipelines] = useState<ResearchPipeline[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [algorithm, setAlgorithm] = useState("");
  const [backend, setBackend] = useState("ibm_brisbane");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadPipelines = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await listResearchPipelines();
      setPipelines(data.pipelines);
    } catch {
      // non-blocking
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  const selectedPipeline = pipelines.find((p) => p.pipeline_id === selectedId) ?? null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createResearchPipeline({
        title,
        hypothesis,
        algorithm,
        backend,
        success_criteria: successCriteria,
      });
      setPipelines((prev) => [created, ...prev]);
      setSelectedId(created.pipeline_id);
      setShowCreate(false);
      // reset
      setTitle("");
      setHypothesis("");
      setAlgorithm("");
      setBackend("ibm_brisbane");
      setSuccessCriteria("");
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  const handleAdvanced = (updated: ResearchPipeline) => {
    setPipelines((prev) =>
      prev.map((p) => (p.pipeline_id === updated.pipeline_id ? updated : p))
    );
  };

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--surface)",
        color: "var(--text)",
      }}
    >
      {/* Left sidebar: pipeline list */}
      <aside
        style={{
          width: 288,
          flexShrink: 0,
          overflowY: "auto",
          borderRight: "1px solid var(--line)",
          background: "var(--surface)",
          padding: 16,
        }}
      >
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              fontSize: 13,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--muted)",
            }}
          >
            Pipelines
          </h2>
          <button
            onClick={() => {
              setShowCreate(true);
              setSelectedId(null);
            }}
            style={{
              borderRadius: 8,
              background: "var(--strong)",
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text)",
              border: "none",
              cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>

        {listLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>
        ) : (pipelines ?? []).length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No pipelines yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(pipelines ?? []).map((p) => (
              <button
                key={p.pipeline_id}
                onClick={() => {
                  setSelectedId(p.pipeline_id);
                  setShowCreate(false);
                }}
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border:
                    selectedId === p.pipeline_id
                      ? "1px solid var(--strong)"
                      : "1px solid var(--line)",
                  background:
                    selectedId === p.pipeline_id
                      ? "rgba(49,46,129,0.4)"
                      : "var(--surface)",
                  padding: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.title}
                </p>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 4,
                    borderRadius: 999,
                    background: "var(--line)",
                    padding: "2px 8px",
                    fontSize: 12,
                    color: "var(--text)",
                    textTransform: "capitalize",
                  }}
                >
                  {p.current_stage.replace(/_/g, " ")}
                </span>
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    <span>Progress</span>
                    <span>{p.overall_completion_pct}%</span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 999,
                      background: "var(--line)",
                    }}
                  >
                    <div
                      style={{
                        height: 4,
                        borderRadius: 999,
                        background: "var(--strong)",
                        width: `${p.overall_completion_pct}%`,
                      }}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Right: detail or create form */}
      <main style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <h1
          style={{
            marginBottom: 4,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          Research Pipeline
        </h1>
        <p style={{ marginBottom: 32, color: "var(--muted)" }}>
          Full hypothesis-to-submission lifecycle tracker.
        </p>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              padding: 24,
              maxWidth: 672,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              Create New Pipeline
            </h2>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--muted)",
                }}
              >
                Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="VQE Hydrogen Molecule Study"
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--muted)",
                }}
              >
                Hypothesis *
              </label>
              <textarea
                required
                rows={3}
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="We hypothesize that error mitigation will improve fidelity by ≥15%..."
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "var(--muted)",
                  }}
                >
                  Algorithm *
                </label>
                <input
                  required
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="VQE"
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "var(--muted)",
                  }}
                >
                  Backend *
                </label>
                <input
                  required
                  value={backend}
                  onChange={(e) => setBackend(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="ibm_brisbane"
                />
              </div>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--muted)",
                }}
              >
                Success Criteria *
              </label>
              <textarea
                required
                rows={2}
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="Achieve fidelity ≥ 0.95 and publish results..."
              />
            </div>

            {createError && (
              <div
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--danger)",
                  background: "rgba(239,68,68,0.1)",
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "var(--danger)",
                }}
              >
                {createError}
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  flex: 1,
                  borderRadius: 8,
                  background: "var(--strong)",
                  padding: "10px 0",
                  fontWeight: 600,
                  color: "var(--text)",
                  border: "none",
                  cursor: creating ? "not-allowed" : "pointer",
                  opacity: creating ? 0.5 : 1,
                  fontSize: 14,
                }}
              >
                {creating ? "Creating..." : "Create Pipeline"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  padding: "10px 16px",
                  color: "var(--text)",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {!showCreate && selectedPipeline && (
          <PipelineDetail
            pipeline={selectedPipeline}
            onAdvanced={handleAdvanced}
          />
        )}

        {!showCreate && !selectedPipeline && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              border: "1px dashed var(--line)",
              padding: "80px 0",
              textAlign: "center",
            }}
          >
            <p style={{ color: "var(--muted)", marginBottom: 16 }}>
              Select a pipeline or create a new one.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                borderRadius: 8,
                background: "var(--strong)",
                padding: "10px 20px",
                fontWeight: 600,
                color: "var(--text)",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              + New Pipeline
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
