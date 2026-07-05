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

const TRIGGER_STYLES: Record<string, { background: string; color: string }> = {
  push:     { background: "rgba(7,89,133,0.6)",   color: "#7dd3fc" },
  pr:       { background: "rgba(88,28,135,0.6)",   color: "#d8b4fe" },
  schedule: { background: "rgba(120,53,15,0.6)",   color: "#fcd34d" },
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  active:   { background: "rgba(6,78,59,0.6)",    color: "#6ee7b7" },
  inactive: { background: "var(--line)",           color: "var(--muted)" },
  passed:   { background: "rgba(6,78,59,0.6)",    color: "#6ee7b7" },
  failed:   { background: "rgba(127,29,29,0.6)",  color: "#fca5a5" },
  running:  { background: "rgba(7,89,133,0.6)",   color: "#7dd3fc" },
  pending:  { background: "var(--line)",           color: "var(--muted)" },
};

const badgeBase = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  textTransform: "capitalize" as const,
};

function StatusBadge({ status }: { status: string }) {
  const colorStyle = STATUS_STYLES[status] ?? { background: "var(--line)", color: "var(--muted)" };
  return (
    <span style={{ ...badgeBase, fontWeight: 600, ...colorStyle }}>
      {status}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const colorStyle = TRIGGER_STYLES[trigger] ?? { background: "var(--line)", color: "var(--muted)" };
  return (
    <span style={{ ...badgeBase, fontWeight: 600, ...colorStyle }}>
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
  const colorStyle =
    rate >= 80 ? { background: "rgba(6,78,59,0.6)",   color: "#6ee7b7" } :
    rate >= 50 ? { background: "rgba(120,53,15,0.6)",  color: "#fcd34d" } :
                 { background: "rgba(127,29,29,0.6)",  color: "#fca5a5" };
  return (
    <span style={{ ...badgeBase, fontWeight: 700, ...colorStyle }}>
      {rate.toFixed(0)}% pass
    </span>
  );
}

function RunsTable({ runs }: { runs: CIPipelineRun[] }) {
  if (runs.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0", textAlign: "center" }}>
        No runs yet.
      </p>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12, color: "var(--text)", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
            <th style={{ textAlign: "left", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Commit</th>
            <th style={{ textAlign: "left", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Branch</th>
            <th style={{ textAlign: "left", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Triggered By</th>
            <th style={{ textAlign: "left", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Status</th>
            <th style={{ textAlign: "right", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Fidelity</th>
            <th style={{ textAlign: "right", paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>Duration</th>
            <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 500 }}>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_id} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "8px 12px 8px 0" }}>
                <a
                  href={run.log_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: "ui-monospace,monospace", color: "var(--strong)", textDecoration: "underline" }}
                >
                  {run.commit_sha.slice(0, 7)}
                </a>
              </td>
              <td style={{ padding: "8px 12px 8px 0", fontFamily: "ui-monospace,monospace", color: "var(--muted)" }}>
                {run.branch}
              </td>
              <td style={{ padding: "8px 12px 8px 0", color: "var(--muted)" }}>{run.triggered_by}</td>
              <td style={{ padding: "8px 12px 8px 0" }}>
                <StatusBadge status={run.status} />
              </td>
              <td style={{ padding: "8px 12px 8px 0", textAlign: "right" }}>
                {run.achieved_fidelity != null ? (
                  <span style={{ color: run.achieved_fidelity >= run.fidelity_threshold ? "var(--ok)" : "var(--danger)" }}>
                    {run.achieved_fidelity.toFixed(4)}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
                <span style={{ color: "var(--muted)" }}> / {run.fidelity_threshold}</span>
              </td>
              <td style={{ padding: "8px 12px 8px 0", textAlign: "right", color: "var(--muted)" }}>
                {run.duration_sec != null ? `${run.duration_sec}s` : "—"}
              </td>
              <td style={{ padding: "8px 0", color: "var(--muted)" }}>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--text)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const errorBannerStyle: React.CSSProperties = {
  background: "rgba(239,68,68,0.1)",
  border: "1px solid var(--danger)",
  color: "var(--danger)",
  borderRadius: 8,
  padding: "12px 16px",
  fontSize: 13,
};

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

  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>GitHub CI Bridge</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Run quantum experiments automatically in your CI/CD pipeline.
        </p>
      </div>

      {triggerError && (
        <div style={{ ...errorBannerStyle, marginBottom: 16 }}>
          {triggerError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 32 }}>
        {/* Pipeline list */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Pipelines</h2>
          {pipelinesError && (
            <div style={{ ...errorBannerStyle, marginBottom: 16 }}>
              {pipelinesError}
            </div>
          )}
          {pipelinesLoading ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
              Loading pipelines…
            </div>
          ) : pipelines.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
              No pipelines yet. Create one using the form.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pipelines.map((pipeline) => {
                const runs = runsMap[pipeline.pipeline_id];
                const isSelected = selectedPipelineId === pipeline.pipeline_id;

                return (
                  <div key={pipeline.pipeline_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <TriggerBadge trigger={pipeline.trigger} />
                          <StatusBadge status={pipeline.status} />
                          {runs && <PassRateBadge runs={runs} />}
                        </div>
                        <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
                          {new Date(pipeline.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 style={{ color: "var(--text)", fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{pipeline.name}</h3>
                      <p style={{ color: "var(--muted)", fontSize: 12, fontFamily: "ui-monospace,monospace", marginBottom: 2 }}>
                        {pipeline.repo} @ {pipeline.branch_pattern}
                      </p>
                      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
                        Backend: {pipeline.backend} &middot; {pipeline.shots} shots
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleTrigger(pipeline.pipeline_id)}
                          disabled={triggeringId === pipeline.pipeline_id}
                          style={{
                            fontSize: 12,
                            background: "var(--strong)",
                            color: "#fff",
                            padding: "6px 12px",
                            borderRadius: 8,
                            fontWeight: 500,
                            border: "none",
                            cursor: triggeringId === pipeline.pipeline_id ? "not-allowed" : "pointer",
                            opacity: triggeringId === pipeline.pipeline_id ? 0.5 : 1,
                          }}
                        >
                          {triggeringId === pipeline.pipeline_id ? "Triggering…" : "Trigger"}
                        </button>
                        <button
                          onClick={() => handleViewRuns(pipeline.pipeline_id)}
                          style={{
                            fontSize: 12,
                            background: "var(--line)",
                            color: "var(--text)",
                            padding: "6px 12px",
                            borderRadius: 8,
                            fontWeight: 500,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {isSelected ? "Hide Runs" : "View Runs"}
                        </button>
                      </div>
                    </div>

                    {/* Runs panel */}
                    {isSelected && (
                      <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", padding: 16 }}>
                        <h4 style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                          Pipeline Runs
                        </h4>
                        {runsLoading === pipeline.pipeline_id ? (
                          <p style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>Loading runs…</p>
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
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Create Pipeline</h2>
          <form
            onSubmit={handleCreate}
            style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div>
              <label style={labelStyle}>Pipeline Name</label>
              <input value={cfName} onChange={(e) => setCfName(e.target.value)} placeholder="Bell State CI" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Repository</label>
              <input value={cfRepo} onChange={(e) => setCfRepo(e.target.value)} placeholder="org/repo" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Branch Pattern</label>
              <input value={cfBranch} onChange={(e) => setCfBranch(e.target.value)} placeholder="main" style={inputStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Trigger</label>
              <select value={cfTrigger} onChange={(e) => setCfTrigger(e.target.value)} style={inputStyle}>
                <option value="push">Push</option>
                <option value="pr">Pull Request</option>
                <option value="schedule">Schedule</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Backend</label>
              <select value={cfBackend} onChange={(e) => setCfBackend(e.target.value)} style={inputStyle}>
                <option value="ibmq_qasm_simulator">ibmq_qasm_simulator</option>
                <option value="ibmq_manila">ibmq_manila</option>
                <option value="statevector_simulator">statevector_simulator</option>
                <option value="aer_simulator">aer_simulator</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Shots</label>
              <input type="number" min={1} max={100000} value={cfShots} onChange={(e) => setCfShots(Number(e.target.value))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>
                Fidelity Threshold:{" "}
                <span style={{ color: "var(--strong)", fontWeight: 600 }}>{cfFidelityThreshold.toFixed(3)}</span>
              </label>
              <input
                type="range"
                min={0.9}
                max={0.999}
                step={0.001}
                value={cfFidelityThreshold}
                onChange={(e) => setCfFidelityThreshold(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--strong)" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                <span>0.900</span><span>0.999</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Experiment Template (JSON)</label>
              <textarea
                value={cfTemplate}
                onChange={(e) => setCfTemplate(e.target.value)}
                rows={8}
                style={{ ...inputStyle, fontFamily: "ui-monospace,monospace", fontSize: 12, resize: "vertical" }}
              />
            </div>
            {cfError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{cfError}</p>}
            {cfSuccess && <p style={{ color: "var(--ok)", fontSize: 13 }}>Pipeline created successfully!</p>}
            <button
              type="submit"
              disabled={cfSubmitting}
              style={{
                width: "100%",
                background: "var(--strong)",
                color: "#fff",
                fontWeight: 500,
                padding: "10px 0",
                borderRadius: 8,
                border: "none",
                cursor: cfSubmitting ? "not-allowed" : "pointer",
                opacity: cfSubmitting ? 0.5 : 1,
                fontSize: 13,
              }}
            >
              {cfSubmitting ? "Creating…" : "Create Pipeline"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
