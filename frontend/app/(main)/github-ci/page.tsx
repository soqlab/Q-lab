"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createCIPipeline,
  listCIPipelines,
  triggerCIPipeline,
  getCIPipelineRuns,
  type CIPipeline,
  type CIPipelineRun,
} from "@/lib/api";

const TRIGGER_COLORS: Record<string, string> = {
  push: "bg-sky-900/60 text-sky-300",
  pr: "bg-purple-900/60 text-purple-300",
  schedule: "bg-amber-900/60 text-amber-300",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-900/60 text-emerald-300",
  inactive: "bg-gray-800 text-gray-500",
  passed: "bg-emerald-900/60 text-emerald-300",
  failed: "bg-red-900/60 text-red-300",
  running: "bg-sky-900/60 text-sky-300",
  pending: "bg-gray-800 text-gray-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[status] ?? "bg-gray-800 text-gray-400"}`}>
      {status}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${TRIGGER_COLORS[trigger] ?? "bg-gray-800 text-gray-400"}`}>
      {trigger}
    </span>
  );
}

function passRate(runs: CIPipelineRun[]): number {
  if (!runs.length) return 0;
  const passed = runs.filter((r) => r.status === "passed").length;
  return (passed / runs.length) * 100;
}

function PassRateBadge({ runs }: { runs: CIPipelineRun[] }) {
  const rate = passRate(runs);
  const color =
    rate >= 80 ? "bg-emerald-900/60 text-emerald-300" :
    rate >= 50 ? "bg-amber-900/60 text-amber-300" :
    "bg-red-900/60 text-red-300";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {rate.toFixed(0)}% pass
    </span>
  );
}

function RunsTable({ runs }: { runs: CIPipelineRun[] }) {
  if (runs.length === 0) {
    return <p className="text-gray-600 text-sm py-4 text-center">No runs yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-gray-300">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left pb-2 pr-3 font-medium">Commit</th>
            <th className="text-left pb-2 pr-3 font-medium">Branch</th>
            <th className="text-left pb-2 pr-3 font-medium">Triggered By</th>
            <th className="text-left pb-2 pr-3 font-medium">Status</th>
            <th className="text-right pb-2 pr-3 font-medium">Fidelity</th>
            <th className="text-right pb-2 pr-3 font-medium">Duration</th>
            <th className="text-left pb-2 font-medium">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
              <td className="py-2 pr-3">
                <a
                  href={run.log_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-indigo-400 hover:text-indigo-300 underline"
                >
                  {run.commit_sha.slice(0, 7)}
                </a>
              </td>
              <td className="py-2 pr-3 font-mono text-gray-400">{run.branch}</td>
              <td className="py-2 pr-3 text-gray-400">{run.triggered_by}</td>
              <td className="py-2 pr-3">
                <StatusBadge status={run.status} />
              </td>
              <td className="py-2 pr-3 text-right">
                {run.achieved_fidelity != null ? (
                  <span className={run.achieved_fidelity >= run.fidelity_threshold ? "text-emerald-400" : "text-red-400"}>
                    {run.achieved_fidelity.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
                <span className="text-gray-600"> / {run.fidelity_threshold}</span>
              </td>
              <td className="py-2 pr-3 text-right text-gray-400">
                {run.duration_sec != null ? `${run.duration_sec}s` : "—"}
              </td>
              <td className="py-2 text-gray-500">
                {new Date(run.started_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EXAMPLE_TEMPLATE = JSON.stringify(
  {
    circuit_name: "bell_state",
    n_qubits: 2,
    gates: [{ gate: "h", qubits: [0] }, { gate: "cx", qubits: [0, 1] }],
    measurements: [0, 1],
  },
  null,
  2
);

export default function GithubCIPage() {
  const [pipelines, setPipelines] = useState<CIPipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [pipelinesError, setPipelinesError] = useState<string | null>(null);

  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [runsMap, setRunsMap] = useState<Record<string, CIPipelineRun[]>>({});
  const [runsLoading, setRunsLoading] = useState<string | null>(null);

  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // Create form
  const [cfName, setCfName] = useState("");
  const [cfRepo, setCfRepo] = useState("");
  const [cfBranch, setCfBranch] = useState("main");
  const [cfTrigger, setCfTrigger] = useState("push");
  const [cfBackend, setCfBackend] = useState("ibmq_qasm_simulator");
  const [cfShots, setCfShots] = useState(1024);
  const [cfFidelityThreshold, setCfFidelityThreshold] = useState(0.95);
  const [cfTemplate, setCfTemplate] = useState(EXAMPLE_TEMPLATE);
  const [cfSubmitting, setCfSubmitting] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);
  const [cfSuccess, setCfSuccess] = useState(false);

  const loadPipelines = useCallback(async () => {
    setPipelinesLoading(true);
    setPipelinesError(null);
    try {
      const data = await listCIPipelines();
      setPipelines(data);
    } catch {
      setPipelinesError("Failed to load CI pipelines.");
    } finally {
      setPipelinesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  async function handleViewRuns(pipelineId: string) {
    if (selectedPipelineId === pipelineId) {
      setSelectedPipelineId(null);
      return;
    }
    setSelectedPipelineId(pipelineId);
    if (!runsMap[pipelineId]) {
      setRunsLoading(pipelineId);
      try {
        const runs = await getCIPipelineRuns(pipelineId);
        setRunsMap((prev) => ({ ...prev, [pipelineId]: runs }));
      } catch {
        setRunsMap((prev) => ({ ...prev, [pipelineId]: [] }));
      } finally {
        setRunsLoading(null);
      }
    }
  }

  async function handleTrigger(pipelineId: string) {
    setTriggeringId(pipelineId);
    setTriggerError(null);
    try {
      const run = await triggerCIPipeline({ pipeline_id: pipelineId, branch: "main", triggered_by: "manual" });
      setRunsMap((prev) => ({
        ...prev,
        [pipelineId]: [run, ...(prev[pipelineId] ?? [])],
      }));
      setSelectedPipelineId(pipelineId);
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "Trigger failed.");
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCfSubmitting(true);
    setCfError(null);
    setCfSuccess(false);
    let template: Record<string, unknown> = {};
    try {
      template = JSON.parse(cfTemplate) as Record<string, unknown>;
    } catch {
      setCfError("Invalid JSON in experiment template.");
      setCfSubmitting(false);
      return;
    }
    try {
      await createCIPipeline({
        name: cfName,
        repo: cfRepo,
        branch_pattern: cfBranch,
        trigger: cfTrigger,
        experiment_template: template,
        backend: cfBackend,
        shots: cfShots,
        fidelity_threshold: cfFidelityThreshold,
      });
      setCfSuccess(true);
      setCfName(""); setCfRepo(""); setCfBranch("main");
      void loadPipelines();
    } catch (err) {
      setCfError(err instanceof Error ? err.message : "Failed to create pipeline.");
    } finally {
      setCfSubmitting(false);
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500";

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">GitHub CI Bridge</h1>
        <p className="text-gray-500 text-sm mt-1">
          Run quantum experiments automatically in your CI/CD pipeline.
        </p>
      </div>

      {triggerError && (
        <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          {triggerError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Pipeline list */}
        <div className="xl:col-span-2">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Pipelines</h2>
          {pipelinesError && (
            <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
              {pipelinesError}
            </div>
          )}
          {pipelinesLoading ? (
            <div className="text-gray-500 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              Loading pipelines…
            </div>
          ) : pipelines.length === 0 ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              No pipelines yet. Create one using the form.
            </div>
          ) : (
            <div className="space-y-3">
              {pipelines.map((pipeline) => {
                const runs = runsMap[pipeline.pipeline_id];
                const isSelected = selectedPipelineId === pipeline.pipeline_id;

                return (
                  <div key={pipeline.pipeline_id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TriggerBadge trigger={pipeline.trigger} />
                          <StatusBadge status={pipeline.status} />
                          {runs && <PassRateBadge runs={runs} />}
                        </div>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {new Date(pipeline.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-gray-100 font-semibold text-sm mb-0.5">{pipeline.name}</h3>
                      <p className="text-gray-500 text-xs font-mono mb-0.5">
                        {pipeline.repo} @ {pipeline.branch_pattern}
                      </p>
                      <p className="text-gray-600 text-xs mb-3">
                        Backend: {pipeline.backend} &middot; {pipeline.shots} shots
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleTrigger(pipeline.pipeline_id)}
                          disabled={triggeringId === pipeline.pipeline_id}
                          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                        >
                          {triggeringId === pipeline.pipeline_id ? "Triggering…" : "Trigger"}
                        </button>
                        <button
                          onClick={() => handleViewRuns(pipeline.pipeline_id)}
                          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors font-medium"
                        >
                          {isSelected ? "Hide Runs" : "View Runs"}
                        </button>
                      </div>
                    </div>

                    {/* Runs panel */}
                    {isSelected && (
                      <div className="border-t border-gray-800 bg-gray-950 px-4 py-4">
                        <h4 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-3">Pipeline Runs</h4>
                        {runsLoading === pipeline.pipeline_id ? (
                          <p className="text-gray-500 text-xs py-2">Loading runs…</p>
                        ) : (
                          <RunsTable runs={runs ?? []} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create pipeline form */}
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Create Pipeline</h2>
          <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Pipeline Name</label>
              <input value={cfName} onChange={(e) => setCfName(e.target.value)} placeholder="Bell State CI" className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Repository</label>
              <input value={cfRepo} onChange={(e) => setCfRepo(e.target.value)} placeholder="org/repo" className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Branch Pattern</label>
              <input value={cfBranch} onChange={(e) => setCfBranch(e.target.value)} placeholder="main" className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Trigger</label>
              <select value={cfTrigger} onChange={(e) => setCfTrigger(e.target.value)} className={inputCls}>
                <option value="push">Push</option>
                <option value="pr">Pull Request</option>
                <option value="schedule">Schedule</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Backend</label>
              <select value={cfBackend} onChange={(e) => setCfBackend(e.target.value)} className={inputCls}>
                <option value="ibmq_qasm_simulator">ibmq_qasm_simulator</option>
                <option value="ibmq_manila">ibmq_manila</option>
                <option value="statevector_simulator">statevector_simulator</option>
                <option value="aer_simulator">aer_simulator</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Shots</label>
              <input type="number" min={1} max={100000} value={cfShots} onChange={(e) => setCfShots(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">
                Fidelity Threshold: <span className="text-indigo-400 font-semibold">{cfFidelityThreshold.toFixed(3)}</span>
              </label>
              <input
                type="range"
                min={0.9}
                max={0.999}
                step={0.001}
                value={cfFidelityThreshold}
                onChange={(e) => setCfFidelityThreshold(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>0.900</span><span>0.999</span></div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Experiment Template (JSON)</label>
              <textarea
                value={cfTemplate}
                onChange={(e) => setCfTemplate(e.target.value)}
                rows={8}
                className={`${inputCls} font-mono text-xs resize-y`}
              />
            </div>
            {cfError && <p className="text-red-400 text-sm">{cfError}</p>}
            {cfSuccess && <p className="text-emerald-400 text-sm">Pipeline created successfully!</p>}
            <button
              type="submit"
              disabled={cfSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {cfSubmitting ? "Creating…" : "Create Pipeline"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
