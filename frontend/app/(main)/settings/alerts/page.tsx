"use client";

import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import {
  listAlertRules, createAlertRule, deleteAlertRule, toggleAlertRule, fetchAlertDigest,
  type AlertRule, type AlertRuleCreate, type AlertDigest,
} from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";

const METRICS = ["health_score", "success_probability", "depth", "size", "num_qubits", "non_clifford_ratio", "tvd"];
const OPERATORS = [
  { value: "lt", label: "< (less than)" },
  { value: "lte", label: "≤ (≤)" },
  { value: "gt", label: "> (greater than)" },
  { value: "gte", label: "≥ (≥)" },
  { value: "eq", label: "= (equals)" },
];

function OperatorBadge({ op }: { op: string }) {
  const labels: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=" };
  return <code style={{ fontSize: 12 }}>{labels[op] ?? op}</code>;
}

function RuleCard({ rule, onToggle, onDelete }: { rule: AlertRule; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className="panel" style={{ padding: "12px 16px", opacity: rule.active ? 1 : 0.55 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{rule.name}</div>
          <div style={{ fontSize: 13, color: "#4f6070" }}>
            <code style={{ background: "#f0f3f7", padding: "1px 6px", borderRadius: 3 }}>{rule.metric}</code>
            {" "}<OperatorBadge op={rule.operator} />{" "}
            <code style={{ background: "#f0f3f7", padding: "1px 6px", borderRadius: 3 }}>{rule.threshold}</code>
          </div>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 4, display: "flex", gap: 10 }}>
            {rule.project && <span>project: {rule.project}</span>}
            {rule.backend && <span>backend: {rule.backend}</span>}
            {rule.webhook_url && <span>{rule.is_slack ? "Slack" : "Webhook"} configured</span>}
            <span>fired: {rule.fired_count}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            title={rule.active ? "Disable rule" : "Enable rule"}
            onClick={onToggle}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: rule.active ? "#27ae60" : "#bbb" }}>
            {rule.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
          </button>
          <button
            title="Delete rule"
            onClick={onDelete}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#e74c3c" }}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DigestCard({ digest }: { digest: AlertDigest }) {
  const health = digest.avg_health;
  const healthColor = health !== null ? (health >= 70 ? "#27ae60" : health >= 40 ? "#e67e22" : "#e74c3c") : "#bbb";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
      <Kpi label="Total runs" value={digest.total_runs} />
      <Kpi label="Completed" value={digest.completed_runs} />
      <Kpi label="Failed" value={digest.failed_runs} />
      <Kpi label="Avg health" value={health !== null ? health.toFixed(1) : "—"} color={healthColor} />
    </div>
  );
}

function Kpi({ label, value, color = "#1d6f8f" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="panel" style={{ padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function AlertsPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [digest, setDigest] = useState<AlertDigest | null>(null);
  const [digestDays, setDigestDays] = useState(7);
  const [digestLoading, setDigestLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<AlertRuleCreate & { _threshold_raw: string }>({
    name: "",
    metric: "health_score",
    operator: "lt",
    threshold: 40,
    _threshold_raw: "40",
    project: "",
    backend: "",
    webhook_url: "",
    is_slack: false,
    active: true,
  });

  useEffect(() => { void loadRules(); }, []);
  useEffect(() => { void loadDigest(); }, [digestDays]);

  async function loadRules() {
    setLoading(true);
    try { setRules(await listAlertRules()); } catch { setError("Failed to load rules"); }
    finally { setLoading(false); }
  }

  async function loadDigest() {
    setDigestLoading(true);
    try { setDigest(await fetchAlertDigest(digestDays)); } catch { /* silent */ }
    finally { setDigestLoading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createAlertRule({
        name: form.name,
        metric: form.metric,
        operator: form.operator,
        threshold: Number(form._threshold_raw),
        project: form.project || undefined,
        backend: form.backend || undefined,
        webhook_url: form.webhook_url || undefined,
        is_slack: form.is_slack,
        active: form.active,
      });
      setShowCreate(false);
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rule");
    }
  }

  async function handleToggle(rule: AlertRule) {
    try {
      const updated = await toggleAlertRule(rule.id);
      setRules(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch { setError("Failed to toggle rule"); }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAlertRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch { setError("Failed to delete rule"); }
  }

  return (
    <main className="page">
      {/* Digest */}
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={16} /> Weekly Digest
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="input" value={digestDays} onChange={e => setDigestDays(Number(e.target.value))} style={{ height: 30, fontSize: 12, padding: "0 8px" }}>
              {[7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </div>
        </div>
        <div style={{ padding: "14px 18px" }}>
          {digestLoading ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading digest…</div>
          ) : digest ? (
            <>
              <DigestCard digest={digest} />
              {digest.best_run && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  Best: <strong>{digest.best_run.circuit_name || digest.best_run.run_id.slice(0, 8)}</strong> on {digest.best_run.backend} (health: {digest.best_run.health_score})
                </div>
              )}
              {digest.worst_run && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  Worst: <strong>{digest.worst_run.circuit_name || digest.worst_run.run_id.slice(0, 8)}</strong> on {digest.worst_run.backend} (health: {digest.worst_run.health_score})
                </div>
              )}
              {Object.keys(digest.by_backend).length > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Top backends: {Object.entries(digest.by_backend).slice(0, 4).map(([b, c]) => `${b} (${c})`).join(", ")}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No data yet.</div>
          )}
        </div>
      </section>

      {/* Alert Rules */}
      <section className="panel">
        <div className="panel-header">
          <h2>Alert Rules</h2>
          <button className="button" style={{ height: 30, fontSize: 12 }} onClick={() => setShowCreate(s => !s)}>
            <Plus size={14} /> New Rule
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--panel-2, #f7f8fa)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Rule name *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Health below 40" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Metric *</label>
                <select className="input" value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))} style={{ width: "100%" }}>
                  {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Operator *</label>
                  <select className="input" value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))} style={{ width: "100%" }}>
                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Threshold *</label>
                  <input className="input" type="number" step="any" value={form._threshold_raw}
                    onChange={e => setForm(f => ({ ...f, _threshold_raw: e.target.value, threshold: Number(e.target.value) }))}
                    style={{ width: "100%" }} />
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Filter: project</label>
                <input className="input" value={form.project ?? ""} onChange={e => setForm(f => ({ ...f, project: e.target.value }))} placeholder="(all)" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Filter: backend</label>
                <input className="input" value={form.backend ?? ""} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))} placeholder="(all)" style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Webhook URL</label>
                <input className="input" value={form.webhook_url ?? ""} onChange={e => setForm(f => ({ ...f, webhook_url: e.target.value }))} placeholder="https://hooks.slack.com/…" style={{ width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={form.is_slack} onChange={e => setForm(f => ({ ...f, is_slack: e.target.checked }))} />
                Send as Slack Block Kit
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                Active
              </label>
            </div>
            {error && <div className="auth-error" style={{ marginBottom: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button" type="submit">Create Rule</button>
              <button className="button secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div style={{ padding: "14px 18px" }}>
          {loading ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>
          ) : rules.length === 0 ? (
            <div className="empty">No alert rules yet. Create one to receive webhook notifications when runs cross a threshold.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rules.map(r => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  onToggle={() => handleToggle(r)}
                  onDelete={() => handleDelete(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
