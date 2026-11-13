"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download, Trash2, Shield, AlertTriangle, FileText, CheckCircle,
  Clock, Database, Lock, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "../../../lib/auth";

const API_PREFIX = "/qlab-api";
function apiUrl(path: string) { return `${API_PREFIX}${path}`; }

function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

interface Run {
  run_id: string;
  circuit_name?: string;
  backend?: string;
  created_at?: string;
  tags?: string[];
}

interface RetentionPolicy {
  policy_id: string;
  name: string;
  retain_runs_days: number;
  anonymize_after_days: number;
  applies_to_projects: string[];
  enabled: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel">
      <div
        className="panel-header"
        onClick={() => setOpen(!open)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <h2 style={{ margin: 0 }}>{title}</h2>
        </div>
        {open ? <ChevronUp size={16} style={{ color: "var(--muted)" }} /> : <ChevronDown size={16} style={{ color: "var(--muted)" }} />}
      </div>
      {open && children}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    completed: { bg: "#22c55e22", color: "#22c55e" },
    pending_confirmation: { bg: "#f59e0b22", color: "#f59e0b" },
    pending: { bg: "#f59e0b22", color: "#f59e0b" },
    processing: { bg: "#38bdf822", color: "#38bdf8" },
    failed: { bg: "#ef444422", color: "#ef4444" },
  };
  const s = map[status] ?? { bg: "#33415522", color: "#94a3b8" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
      {status.replace("_", " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GDPRPage() {
  const { token, user } = useAuth();
  const router = useRouter();

  const [runs, setRuns] = useState<Run[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  // Section states
  const [exportLoading, setExportLoading] = useState(false);
  const [exportResult, setExportResult] = useState<{ request_id: string; record_count: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ request_id: string; message: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [anonRunId, setAnonRunId] = useState<string | null>(null);
  const [anonLoading, setAnonLoading] = useState(false);
  const [anonResults, setAnonResults] = useState<Record<string, string>>({});

  const [newPolicy, setNewPolicy] = useState({ name: "", retain_runs_days: 0, anonymize_after_days: 0 });
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [dryRunResults, setDryRunResults] = useState<Record<string, { runs_affected: number; dry_run: boolean } | null>>({});

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    void loadAll();
  }, [token, router]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    try {
      const [runsRes, policiesRes] = await Promise.all([
        fetch(apiUrl("/api/v1/runs"), { cache: "no-store", headers: authHeaders(token) }),
        fetch(apiUrl("/api/v1/gdpr/retention-policies"), { cache: "no-store", headers: authHeaders(token) }),
      ]);
      if (runsRes.ok) {
        const data = await runsRes.json() as Run[];
        setRuns(Array.isArray(data) ? data : []);
      }
      if (policiesRes.ok) {
        const data = await policiesRes.json() as { policies: RetentionPolicy[] };
        setPolicies(data.policies ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestExport() {
    setExportLoading(true);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await fetch(apiUrl("/api/v1/gdpr/export/request"), {
        method: "POST",
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Export request failed");
      const data = await res.json() as { request_id: string; record_count: number };
      setExportResult(data);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "Failed");
    } finally {
      setExportLoading(false);
    }
  }

  // The export needs the session token, which a plain link can't send.
  async function downloadExport(requestId: string) {
    setExportError(null);
    try {
      const res = await fetch(apiUrl(`/api/v1/gdpr/export/${requestId}`), { cache: "no-store", headers: authHeaders(token) });
      if (!res.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `qlab_export_${requestId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function requestDeletion() {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/gdpr/delete/request"), {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, reason: deleteReason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail === "passkey_session_required"
          ? "Sign in again with your passkey, then delete the account from Settings."
          : "Deletion request failed");
      }
      const data = await res.json() as { request_id: string; message: string };
      setDeleteResult(data);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function anonymizeRun(runId: string) {
    setAnonRunId(runId);
    setAnonLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/v1/gdpr/anonymize/${runId}`), {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) throw new Error("Anonymization failed");
      setAnonResults((prev) => ({ ...prev, [runId]: "anonymized" }));
      // Refresh runs
      const runsRes = await fetch(apiUrl("/api/v1/runs"), { cache: "no-store", headers: authHeaders(token) });
      if (runsRes.ok) setRuns(await runsRes.json() as Run[]);
    } catch {
      setAnonResults((prev) => ({ ...prev, [runId]: "error" }));
    } finally {
      setAnonLoading(false);
      setAnonRunId(null);
    }
  }

  async function createPolicy() {
    if (!newPolicy.name.trim()) return;
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/gdpr/retention-policy"), {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ ...newPolicy, applies_to_projects: [], enabled: true }),
      });
      if (!res.ok) throw new Error("Policy creation failed");
      await loadAll();
      setNewPolicy({ name: "", retain_runs_days: 0, anonymize_after_days: 0 });
    } catch (e: unknown) {
      setPolicyError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPolicyLoading(false);
    }
  }

  async function runPolicyDryRun(policyId: string, apply = false) {
    const res = await fetch(apiUrl(`/api/v1/gdpr/retention-policy/${policyId}/apply?dry_run=${!apply}`), {
      method: "POST",
      headers: authHeaders(token),
    });
    if (!res.ok) return;
    const data = await res.json() as { runs_affected: number; dry_run: boolean };
    setDryRunResults((prev) => ({ ...prev, [policyId]: data }));
    if (apply) await loadAll();
  }

  if (loading) return <main className="page"><div className="empty">Loading data privacy tools…</div></main>;

  const isAdmin = user?.role === "admin" || user?.role === "owner";

  return (
    <main className="page">
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Shield size={20} style={{ color: "#38bdf8" }} />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Data Privacy &amp; GDPR</h2>
        </div>
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
          Download everything Q-Lab holds about you, or delete your account. What is kept and why is in the{" "}
          <a href="/privacy" style={{ color: "#38bdf8" }}>privacy notice</a>.
        </p>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {/* ---- 1. Your Data / Export ---- */}
        <SectionCard title="Your Data Export" icon={<Download size={16} style={{ color: "#38bdf8" }} />}>
          <div style={{ padding: "16px 18px" }}>
            <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              A JSON file with everything Q-Lab holds about your account: your profile, runs (circuits, results,
              calibration, environment), share links, projects, notes, API keys, passkeys and recovery codes (names
              and dates only, never the keys or their hashes), saved provider keys, webhooks, notification channels
              and integrations (without their secrets), and the security log entries about you.
            </p>

            {exportResult ? (
              <div style={{ background: "#22c55e22", border: "1px solid #22c55e55", borderRadius: 8, padding: "14px 18px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <CheckCircle size={16} style={{ color: "#22c55e" }} />
                  <strong style={{ color: "#22c55e" }}>Export Ready</strong>
                </div>
                <div style={{ fontSize: 13, color: "#86efac", marginBottom: 10 }}>
                  {exportResult.record_count} run{exportResult.record_count !== 1 ? "s" : ""} included
                </div>
                <button
                  type="button"
                  onClick={() => void downloadExport(exportResult.request_id)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#22c55e",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: 8,
                    padding: "8px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <Download size={14} /> Download JSON Export
                </button>
              </div>
            ) : exportError ? (
              <div style={{ background: "#ef444422", border: "1px solid #ef444455", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 14 }}>
                {exportError}
              </div>
            ) : null}

            <button
              onClick={() => void requestExport()}
              disabled={exportLoading}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: exportLoading ? "#334155" : "#1d6f8f",
                color: "#fff", border: "none", borderRadius: 8,
                padding: "10px 24px", fontSize: 14, fontWeight: 700,
                cursor: exportLoading ? "not-allowed" : "pointer",
              }}
            >
              <Download size={15} />
              {exportLoading ? "Generating export…" : "Export all my data"}
            </button>
          </div>
        </SectionCard>

        {/* ---- 2. Data Deletion ---- */}
        <SectionCard title="Right to Erasure" icon={<Trash2 size={16} style={{ color: "#ef4444" }} />} defaultOpen={false}>
          <div style={{ padding: "16px 18px" }}>
            {deleteResult ? (
              <div style={{ background: "#f59e0b22", border: "1px solid #f59e0b55", borderRadius: 8, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Clock size={16} style={{ color: "#f59e0b" }} />
                  <strong style={{ color: "#f59e0b" }}>Account deletion scheduled</strong>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fcd34d", lineHeight: 1.6 }}>
                  {deleteResult.message}
                </p>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Request ID: <code style={{ color: "#f59e0b" }}>{deleteResult.request_id}</code>
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: "#ef444411", border: "1px solid #ef444433", borderRadius: 8, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10 }}>
                  <AlertTriangle size={16} style={{ color: "#ef4444", flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.6 }}>
                    Your account is locked straight away and <strong>erased 7 days later</strong>: your runs, projects
                    nobody else uses, API keys, passkeys, recovery codes, saved provider keys, webhooks, notification
                    channels, integrations and profile. Public share links stop at once. Sign in with your passkey
                    within the 7 days to cancel. The security log keeps its entries about the account, with the
                    account replaced by a code and without browser details.
                  </div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                      Reason (optional)
                    </label>
                    <textarea
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      rows={2}
                      placeholder="Why do you want to delete your account?"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--input-bg, #0d1b2a)", border: "1px solid var(--line)",
                        borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 13, resize: "vertical",
                      }}
                    />
                  </div>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                      I understand my account is locked now and erased with all its data in 7 days, unless I
                      sign in before then.
                    </span>
                  </label>

                  {deleteError && (
                    <div style={{ color: "#fca5a5", fontSize: 13 }}>{deleteError}</div>
                  )}

                  <div>
                    <button
                      onClick={() => void requestDeletion()}
                      disabled={!deleteConfirm || deleteLoading}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: deleteConfirm && !deleteLoading ? "#ef4444" : "#334155",
                        color: "#fff", border: "none", borderRadius: 8,
                        padding: "10px 24px", fontSize: 14, fontWeight: 700,
                        cursor: deleteConfirm && !deleteLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      <Trash2 size={15} />
                      {deleteLoading ? "Deleting…" : "Delete my account"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </SectionCard>

        {/* ---- 3. Anonymize Runs ---- */}
        <SectionCard title="Anonymize Runs" icon={<Lock size={16} style={{ color: "#94a3b8" }} />} defaultOpen={false}>
          <div style={{ padding: "0 18px 16px" }}>
            <p style={{ marginBottom: 12, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              Anonymize individual runs — circuit names and personal identifiers are replaced with hashes.
              Scientific data (QASM, results, calibration) is preserved.
            </p>
            {runs.length === 0 ? (
              <div className="empty" style={{ padding: "20px 0" }}>No runs found.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["Circuit", "Backend", "Date", "Tags", ""].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--line)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.slice(0, 20).map((r) => {
                      const isAnon = (r.tags ?? []).includes("anonymized") || anonResults[r.run_id] === "anonymized";
                      return (
                        <tr key={r.run_id} style={{ borderBottom: "1px solid var(--line)", opacity: isAnon ? 0.6 : 1 }}>
                          <td style={{ padding: "9px 10px", color: "var(--strong)", fontWeight: 500 }}>
                            {r.circuit_name ?? <span style={{ color: "var(--muted)" }}>{r.run_id.slice(0, 10)}</span>}
                          </td>
                          <td style={{ padding: "9px 10px", color: "var(--muted)" }}>{r.backend ?? "—"}</td>
                          <td style={{ padding: "9px 10px", color: "var(--muted)", fontSize: 12 }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            {(r.tags ?? []).slice(0, 2).map((t) => (
                              <span key={t} style={{ fontSize: 10, background: "var(--line)", borderRadius: 4, padding: "1px 6px", marginRight: 4 }}>{t}</span>
                            ))}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            {isAnon ? (
                              <span style={{ fontSize: 11, color: "#64748b" }}>Anonymized</span>
                            ) : (
                              <button
                                onClick={() => void anonymizeRun(r.run_id)}
                                disabled={anonLoading && anonRunId === r.run_id}
                                style={{
                                  background: "#1e293b",
                                  border: "1px solid var(--line)",
                                  color: "var(--muted)",
                                  borderRadius: 6,
                                  padding: "4px 10px",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                {anonLoading && anonRunId === r.run_id ? "…" : "Anonymize"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {runs.length > 20 && (
                  <div style={{ padding: "10px", color: "var(--muted)", fontSize: 12 }}>
                    Showing 20 of {runs.length} runs.
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ---- 4. Retention Policies (admin) ---- */}
        {isAdmin && (
          <SectionCard title="Retention Policies" icon={<Database size={16} style={{ color: "#f59e0b" }} />} defaultOpen={false}>
            <div style={{ padding: "16px 18px" }}>
              <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                Configure automatic data lifecycle rules. Policies can delete old runs or anonymize them after a set number of days.
                A value of 0 means &quot;keep forever&quot;.
              </p>

              {/* Policy list */}
              {policies.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  {policies.map((p) => (
                    <div
                      key={p.policy_id}
                      style={{
                        background: "var(--input-bg, #0d1b2a)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "14px 16px",
                        marginBottom: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                            Delete after {p.retain_runs_days || "∞"} days ·{" "}
                            Anonymize after {p.anonymize_after_days || "never"}
                          </div>
                        </div>
                        <span style={{
                          background: p.enabled ? "#22c55e22" : "#33415522",
                          color: p.enabled ? "#22c55e" : "#64748b",
                          borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700,
                        }}>
                          {p.enabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => void runPolicyDryRun(p.policy_id, false)}
                          style={{
                            background: "#1e293b", border: "1px solid var(--line)",
                            color: "var(--muted)", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
                          }}
                        >
                          Dry Run
                        </button>
                        <button
                          onClick={() => void runPolicyDryRun(p.policy_id, true)}
                          style={{
                            background: "#ef444422", border: "1px solid #ef444455",
                            color: "#fca5a5", borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
                          }}
                        >
                          Apply Now
                        </button>
                      </div>
                      {dryRunResults[p.policy_id] && (
                        <div style={{ fontSize: 12, color: "#94a3b8", background: "#0d1b2a", borderRadius: 6, padding: "8px 10px" }}>
                          {dryRunResults[p.policy_id]?.dry_run ? "Dry run: " : "Applied: "}
                          <strong style={{ color: "var(--strong)" }}>
                            {dryRunResults[p.policy_id]?.runs_affected ?? 0}
                          </strong>{" "}
                          runs affected
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Create new policy */}
              <div style={{ background: "var(--input-bg, #0d1b2a)", border: "1px solid var(--line)", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Create New Policy</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Policy Name</label>
                    <input
                      value={newPolicy.name}
                      onChange={(e) => setNewPolicy((n) => ({ ...n, name: e.target.value }))}
                      placeholder="e.g. 2-year run retention"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "transparent", border: "1px solid var(--line)",
                        borderRadius: 6, padding: "7px 10px", color: "var(--text)", fontSize: 13,
                      }}
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                        Delete after (days) · 0 = keep forever
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={newPolicy.retain_runs_days}
                        onChange={(e) => setNewPolicy((n) => ({ ...n, retain_runs_days: Number(e.target.value) }))}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "transparent", border: "1px solid var(--line)",
                          borderRadius: 6, padding: "7px 10px", color: "var(--text)", fontSize: 13,
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                        Anonymize after (days) · 0 = never
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={newPolicy.anonymize_after_days}
                        onChange={(e) => setNewPolicy((n) => ({ ...n, anonymize_after_days: Number(e.target.value) }))}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "transparent", border: "1px solid var(--line)",
                          borderRadius: 6, padding: "7px 10px", color: "var(--text)", fontSize: 13,
                        }}
                      />
                    </div>
                  </div>
                  {policyError && <div style={{ fontSize: 12, color: "#fca5a5" }}>{policyError}</div>}
                  <button
                    onClick={() => void createPolicy()}
                    disabled={policyLoading || !newPolicy.name.trim()}
                    style={{
                      background: policyLoading || !newPolicy.name.trim() ? "#334155" : "#1d6f8f",
                      color: "#fff", border: "none", borderRadius: 8,
                      padding: "9px 20px", fontSize: 13, fontWeight: 700,
                      cursor: policyLoading || !newPolicy.name.trim() ? "not-allowed" : "pointer",
                      alignSelf: "flex-start",
                    }}
                  >
                    {policyLoading ? "Creating…" : "Create Policy"}
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        <section className="panel">
          <div style={{ padding: "14px 18px", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            <FileText size={16} style={{ color: "#38bdf8", flexShrink: 0, marginTop: 2 }} />
            <div>
              What Q-Lab collects, who else receives it, how long it is kept and your rights are set out in the{" "}
              <a href="/privacy" style={{ color: "#38bdf8" }}>privacy notice</a>. For anything else, email{" "}
              <a href="mailto:contact@soqlab.com" style={{ color: "#38bdf8" }}>contact@soqlab.com</a>.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
