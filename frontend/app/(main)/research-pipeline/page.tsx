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
  if (status === "completed") return { icon: "✓", color: "text-emerald-400" };
  if (status === "active") return { icon: "▶", color: "text-indigo-400" };
  return { icon: "○", color: "text-slate-500" };
}

function StageStepper({
  stages,
  currentStage,
}: {
  stages: PipelineStage[];
  currentStage: string;
}) {
  return (
    <div className="space-y-0">
      {stages.map((stage, i) => {
        const { icon, color } = stageIcon(stage.status);
        const isActive = stage.name === currentStage;
        return (
          <div key={i} className="flex gap-4">
            {/* Line + icon column */}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  isActive
                    ? "border-indigo-500 bg-indigo-950 text-indigo-400"
                    : stage.status === "completed"
                    ? "border-emerald-600 bg-emerald-950/40 text-emerald-400"
                    : "border-slate-600 bg-slate-800 text-slate-500"
                }`}
              >
                <span className={color}>{icon}</span>
              </div>
              {i < stages.length - 1 && (
                <div
                  className={`my-1 w-0.5 flex-1 ${
                    stage.status === "completed" ? "bg-emerald-800" : "bg-slate-700"
                  }`}
                  style={{ minHeight: "24px" }}
                />
              )}
            </div>

            {/* Content */}
            <div className={`pb-4 flex-1 ${i === stages.length - 1 ? "pb-0" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-sm font-semibold capitalize ${
                    isActive ? "text-indigo-300" : "text-slate-300"
                  }`}
                >
                  {stage.name.replace(/_/g, " ")}
                </span>
                {isActive && (
                  <span className="rounded-full bg-indigo-900 px-2 py-0.5 text-xs text-indigo-300">
                    Active
                  </span>
                )}
              </div>
              {stage.artifacts.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {stage.artifacts.map((a, j) => (
                    <span
                      key={j}
                      className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              )}
              {stage.auto_checks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {stage.auto_checks.map((c, j) => (
                    <span
                      key={j}
                      className={`text-xs ${c.passed ? "text-emerald-400" : "text-red-400"}`}
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
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">{pipeline.title}</h2>
        <p className="text-sm text-slate-400 italic">{pipeline.hypothesis}</p>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>Overall Progress</span>
          <span>{pipeline.overall_completion_pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-700">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${pipeline.overall_completion_pct}%` }}
          />
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="rounded-full border border-indigo-700 bg-indigo-950 px-3 py-1 text-indigo-300">
          {pipeline.current_stage.replace(/_/g, " ")}
        </span>
        <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-slate-300">
          {pipeline.algorithm}
        </span>
        <span className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-slate-300">
          {pipeline.backend}
        </span>
      </div>

      {/* Stepper */}
      <StageStepper stages={pipeline.stages} currentStage={pipeline.current_stage} />

      {/* Advance button */}
      {!isComplete && (
        <div>
          {advanceError && (
            <div className="mb-2 rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {advanceError}
            </div>
          )}
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {advancing ? "Advancing..." : "Advance to Next Stage"}
          </button>
        </div>
      )}
      {isComplete && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-center text-sm text-emerald-300 font-semibold">
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
    <div className="flex min-h-screen bg-slate-950 text-white">
      {/* Left sidebar: pipeline list */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-700 bg-slate-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
            Pipelines
          </h2>
          <button
            onClick={() => {
              setShowCreate(true);
              setSelectedId(null);
            }}
            className="rounded-lg bg-indigo-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-600 transition-colors"
          >
            + New
          </button>
        </div>

        {listLoading ? (
          <p className="text-slate-500 text-sm">Loading...</p>
        ) : pipelines.length === 0 ? (
          <p className="text-slate-500 text-sm">No pipelines yet.</p>
        ) : (
          <div className="space-y-2">
            {pipelines.map((p) => (
              <button
                key={p.pipeline_id}
                onClick={() => {
                  setSelectedId(p.pipeline_id);
                  setShowCreate(false);
                }}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === p.pipeline_id
                    ? "border-indigo-600 bg-indigo-950/60"
                    : "border-slate-700 bg-slate-800 hover:border-slate-600"
                }`}
              >
                <p className="text-sm font-medium text-white line-clamp-1">{p.title}</p>
                <span className="inline-block mt-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300 capitalize">
                  {p.current_stage.replace(/_/g, " ")}
                </span>
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Progress</span>
                    <span>{p.overall_completion_pct}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-700">
                    <div
                      className="h-1 rounded-full bg-indigo-500"
                      style={{ width: `${p.overall_completion_pct}%` }}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Right: detail or create form */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <h1 className="mb-1 text-3xl font-black tracking-tight text-white">
          Research Pipeline
        </h1>
        <p className="mb-8 text-slate-400">
          Full hypothesis-to-submission lifecycle tracker.
        </p>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/60 p-6 max-w-2xl"
          >
            <h2 className="text-lg font-bold text-white">Create New Pipeline</h2>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="VQE Hydrogen Molecule Study"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Hypothesis *
              </label>
              <textarea
                required
                rows={3}
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="We hypothesize that error mitigation will improve fidelity by ≥15%..."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Algorithm *
                </label>
                <input
                  required
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  placeholder="VQE"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Backend *
                </label>
                <input
                  required
                  value={backend}
                  onChange={(e) => setBackend(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  placeholder="ibm_brisbane"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Success Criteria *
              </label>
              <textarea
                required
                rows={2}
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="Achieve fidelity ≥ 0.95 and publish results..."
              />
            </div>

            {createError && (
              <div className="rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {createError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {creating ? "Creating..." : "Create Pipeline"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-600 px-4 py-2.5 text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
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
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-20 text-center">
            <p className="text-slate-400 mb-4">Select a pipeline or create a new one.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              + New Pipeline
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
