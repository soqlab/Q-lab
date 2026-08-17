"use client";

import { useEffect, useState } from "react";
import {
  listCICDIntegrations, createCICDIntegration, listCICDChecks, runCICDManualCheck,
  CICDIntegration, CICDCheck, CICDIntegrationCreate,
  listRegressionGates, createRegressionGate, runRegressionCheck,
  RegressionGate, RegressionCheckResult,
} from "../../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  passed: "#10b981", failed: "#ef4444", warning: "#f59e0b", pending: "#3b82f6",
};

const SAMPLE_QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

export default function CICDPage() {
  const [integrations, setIntegrations] = useState<CICDIntegration[]>([]);
  const [checks, setChecks] = useState<CICDCheck[]>([]);
  const [selected, setSelected] = useState<CICDIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [newWebhookUrl, setNewWebhookUrl] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<CICDIntegrationCreate>({
    name: "", provider: "github", repo_url: "", auto_fail_threshold: 10,
  });

  const [manualQasm, setManualQasm] = useState(SAMPLE_QASM);
  const [running, setRunning] = useState(false);
  const [manualResult, setManualResult] = useState<{ status: string; checks: unknown[] } | null>(null);
  const [gates, setGates] = useState<RegressionGate[]>([]);
  const [gateForm, setGateForm] = useState({ name: "", project_slug: "", baseline_run_id: "", fidelity_drop_threshold_pct: 2 });
  const [checkForm, setCheckForm] = useState({ run_id: "", baseline_run_id: "", fidelity_drop_threshold_pct: 2 });
  const [regressionResult, setRegressionResult] = useState<RegressionCheckResult | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([listCICDIntegrations(), listCICDChecks({ limit: 50 }), listRegressionGates().catch(() => [])])
      .then(([i, c, g]) => { setIntegrations(i); setChecks(c); setGates(g); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createCICDIntegration(createForm) as CICDIntegration & { webhook_secret: string; webhook_url: string };
      setIntegrations(prev => [result, ...prev]);
      setNewSecret(result.webhook_secret);
      setNewWebhookUrl(result.webhook_url);
      setShowCreate(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleManualCheck = async () => {
    if (!selected) return;
    setRunning(true);
    setManualResult(null);
    try {
      const res = await runCICDManualCheck(selected.integration_id, { qasm: manualQasm, branch: "manual" });
      setManualResult(res);
      load(); // refresh checks
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleCreateGate = async () => {
    try {
      const gate = await createRegressionGate({
        name: gateForm.name,
        project_slug: gateForm.project_slug || undefined,
        baseline_run_id: gateForm.baseline_run_id,
        fidelity_drop_threshold_pct: gateForm.fidelity_drop_threshold_pct,
      });
      setGates(prev => [gate, ...prev]);
      setGateForm({ name: "", project_slug: "", baseline_run_id: "", fidelity_drop_threshold_pct: 2 });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRegressionCheck = async () => {
    setRegressionResult(null);
    try {
      const result = await runRegressionCheck({
        run_id: checkForm.run_id,
        baseline_run_id: checkForm.baseline_run_id || undefined,
        fidelity_drop_threshold_pct: checkForm.fidelity_drop_threshold_pct,
      });
      setRegressionResult(result);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const integrationChecks = selected ? checks.filter(c => c.integration_id === selected.integration_id) : [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
        <span>⚡</span>
        <span><strong style={{ color: "#10b981" }}>Real Execution</strong> — Circuit checks run your QASM through Qiskit AerSimulator and report actual measured fidelity against your threshold.</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>CI/CD Integration</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load}>Refresh</button>
          <button className="btn btn-primary" onClick={() => { setShowCreate(!showCreate); setNewSecret(null); }}>
            {showCreate ? "Cancel" : "+ New Integration"}
          </button>
        </div>
      </div>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Unitary Fidelity Regression Gates</h2></div>
        <div style={{ padding: 16, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Gate name</span>
              <input className="input" value={gateForm.name} onChange={e => setGateForm(f => ({ ...f, name: e.target.value }))} placeholder="Main ansatz regression" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Project</span>
              <input className="input" value={gateForm.project_slug} onChange={e => setGateForm(f => ({ ...f, project_slug: e.target.value }))} placeholder="project slug" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 210px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Baseline run ID</span>
              <input className="input" value={gateForm.baseline_run_id} onChange={e => setGateForm(f => ({ ...f, baseline_run_id: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Fail drop %</span>
              <input className="input" type="number" value={gateForm.fidelity_drop_threshold_pct} onChange={e => setGateForm(f => ({ ...f, fidelity_drop_threshold_pct: Number(e.target.value) }))} />
            </label>
            <button className="btn btn-primary" onClick={handleCreateGate} disabled={!gateForm.name || !gateForm.baseline_run_id}>Create Gate</button>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Candidate run ID</span>
              <input className="input" value={checkForm.run_id} onChange={e => setCheckForm(f => ({ ...f, run_id: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Baseline override</span>
              <input className="input" value={checkForm.baseline_run_id} onChange={e => setCheckForm(f => ({ ...f, baseline_run_id: e.target.value }))} placeholder="optional if project gate exists" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Fail drop %</span>
              <input className="input" type="number" value={checkForm.fidelity_drop_threshold_pct} onChange={e => setCheckForm(f => ({ ...f, fidelity_drop_threshold_pct: Number(e.target.value) }))} />
            </label>
            <button className="btn" onClick={handleRegressionCheck} disabled={!checkForm.run_id}>Run Regression</button>
          </div>

          {regressionResult && (
            <div style={{ padding: 10, borderRadius: 6, background: regressionResult.passed ? "#064e3b22" : "#7f1d1d22", color: regressionResult.passed ? "#10b981" : "#ef4444", fontSize: 13 }}>
              {regressionResult.status.toUpperCase()} · fidelity {(regressionResult.estimated_unitary_fidelity * 100).toFixed(2)}% · drop {regressionResult.fidelity_drop_pct.toFixed(2)}% / threshold {regressionResult.threshold_pct}%
            </div>
          )}

          {gates.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {gates.slice(0, 8).map(g => (
                <span key={g.integration_id} style={{ fontSize: 12, background: "#111827", border: "1px solid #1f2937", borderRadius: 999, padding: "4px 10px" }}>
                  {g.name} · baseline <code>{g.baseline_run_id.slice(0, 10)}</code> · {g.fidelity_drop_threshold_pct}%
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {newSecret && (
        <div className="panel" style={{ marginBottom: 16, padding: 16, borderLeft: "3px solid #10b981" }}>
          <div style={{ fontWeight: 600, color: "#10b981", marginBottom: 8 }}>Integration created! Save your webhook secret — it won&apos;t be shown again.</div>
          <div style={{ fontSize: 12, marginBottom: 4 }}><span style={{ color: "#9ca3af" }}>Webhook URL: </span><code>{newWebhookUrl}</code></div>
          <div style={{ fontSize: 12 }}><span style={{ color: "#9ca3af" }}>Secret: </span><code style={{ color: "#f59e0b" }}>{newSecret}</code></div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h2>New Integration</h2></div>
          <div style={{ padding: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Name</span>
              <input className="input" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="My Repo CI" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 120px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Provider</span>
              <select className="input" value={createForm.provider} onChange={e => setCreateForm(f => ({ ...f, provider: e.target.value }))}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="bitbucket">Bitbucket</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 2, minWidth: 240 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Repository URL</span>
              <input className="input" value={createForm.repo_url} onChange={e => setCreateForm(f => ({ ...f, repo_url: e.target.value }))} placeholder="https://github.com/org/repo" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 140px" }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Auto-fail Threshold (%)</span>
              <input className="input" type="number" value={createForm.auto_fail_threshold} onChange={e => setCreateForm(f => ({ ...f, auto_fail_threshold: Number(e.target.value) }))} />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !createForm.name || !createForm.repo_url}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* Integration list */}
        <div style={{ flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading...</div>
          ) : integrations.length === 0 ? (
            <div className="panel" style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
              No integrations yet.
            </div>
          ) : (
            integrations.map(ci => (
              <div
                key={ci.integration_id}
                className="panel"
                onClick={() => { setSelected(ci); setManualResult(null); }}
                style={{
                  padding: "10px 14px", cursor: "pointer",
                  borderLeft: selected?.integration_id === ci.integration_id ? "3px solid #3b82f6" : "3px solid transparent",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{ci.name}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{ci.provider} · threshold {ci.auto_fail_threshold}%</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ci.repo_url}</div>
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1 }}>
          {selected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Manual check */}
              <div className="panel">
                <div className="panel-header"><h2>Manual Check — {selected.name}</h2></div>
                <div style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Paste QASM to run against this integration&apos;s baseline:</div>
                  <textarea
                    className="input"
                    value={manualQasm}
                    onChange={e => setManualQasm(e.target.value)}
                    rows={8}
                    style={{ fontFamily: "monospace", fontSize: 12, width: "100%", marginBottom: 10 }}
                  />
                  <button className="btn btn-primary" onClick={handleManualCheck} disabled={running}>
                    {running ? "Running..." : "Run Check"}
                  </button>

                  {manualResult && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>Result:</span>
                        <span style={{
                          padding: "2px 10px", borderRadius: 4, fontSize: 13, fontWeight: 600,
                          background: `${STATUS_COLOR[manualResult.status] ?? "#6b7280"}22`,
                          color: STATUS_COLOR[manualResult.status] ?? "#6b7280",
                        }}>{manualResult.status.toUpperCase()}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(manualResult.checks as Array<{ name: string; status: string; message?: string }>).map((chk, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                            <span style={{ color: STATUS_COLOR[chk.status] ?? "#6b7280", fontWeight: 700, width: 16 }}>
                              {chk.status === "passed" ? "✓" : chk.status === "failed" ? "✗" : "~"}
                            </span>
                            <span style={{ fontWeight: 600, width: 180 }}>{chk.name}</span>
                            <span style={{ color: "#9ca3af" }}>{chk.message ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Check history */}
              <div className="panel">
                <div className="panel-header"><h2>Recent Webhook Checks</h2></div>
                <div style={{ padding: 12 }}>
                  {integrationChecks.length === 0 ? (
                    <div style={{ color: "#6b7280", fontSize: 13, padding: 8 }}>No checks yet. Push to your repo to trigger the first check.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {integrationChecks.slice(0, 20).map(chk => (
                        <div key={chk.check_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", borderBottom: "1px solid #111827", fontSize: 13 }}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                            background: `${STATUS_COLOR[chk.status] ?? "#6b7280"}22`,
                            color: STATUS_COLOR[chk.status] ?? "#6b7280",
                          }}>{chk.status}</span>
                          <span style={{ fontFamily: "monospace", color: "#9ca3af" }}>{chk.commit_sha.slice(0, 8)}</span>
                          <span style={{ color: "#6b7280" }}>{chk.branch ?? "—"}</span>
                          <span style={{ color: "#6b7280", marginLeft: "auto" }}>{new Date(chk.created_at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>
              Select an integration to see details and run checks.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
