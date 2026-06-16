"use client";
import { useEffect, useState } from "react";
import {
  DecoherenceAlert,
  listDecoherenceAlerts, createDecoherenceAlert, deleteDecoherenceAlert, checkAllDecoherenceAlerts,
} from "../../../../lib/api";
import { AlertTriangle, Plus, Trash2, RefreshCw, Bell } from "lucide-react";

const METRICS = ["t1", "t2", "gate_error", "readout_error"];
const METRIC_INFO: Record<string, { label: string; unit: string; defaultThreshold: number; defaultCondition: "below" | "above" }> = {
  t1:           { label: "T1 Relaxation", unit: "µs",  defaultThreshold: 80,   defaultCondition: "below" },
  t2:           { label: "T2 Dephasing",  unit: "µs",  defaultThreshold: 60,   defaultCondition: "below" },
  gate_error:   { label: "Gate Error",    unit: "",    defaultThreshold: 0.01,  defaultCondition: "above" },
  readout_error:{ label: "Readout Error", unit: "",    defaultThreshold: 0.02,  defaultCondition: "above" },
};

const BACKENDS = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ibm_sherbrooke", "simulator_statevector", "custom"];

function AlertCard({ alert, onDelete }: { alert: DecoherenceAlert; onDelete: () => void }) {
  const info = METRIC_INFO[alert.metric] ?? { label: alert.metric, unit: "" };
  return (
    <div style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${alert.triggered ? "#ef4444" : "#334155"}`, padding: "1rem 1.25rem", position: "relative" }}>
      {alert.triggered && (
        <div style={{ position: "absolute", top: -1, left: 16, right: 16, height: 2, background: "linear-gradient(90deg, #ef4444, #f97316)", borderRadius: "0 0 2px 2px" }} />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: alert.triggered ? "#7f1d1d22" : "#1d4ed822", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AlertTriangle size={18} color={alert.triggered ? "#ef4444" : "#3b82f6"} />
          </div>
          <div>
            <div style={{ color: "#e2e8f0", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              {info.label}
              {alert.triggered && (
                <span style={{ fontSize: "0.7rem", color: "#ef4444", background: "#7f1d1d22", border: "1px solid #ef444440", borderRadius: 3, padding: "0 5px", fontWeight: 700 }}>TRIGGERED</span>
              )}
            </div>
            <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
              {alert.backend} {alert.qubit != null ? `· Q${alert.qubit}` : ""} ·&nbsp;
              <span style={{ color: "#94a3b8" }}>{alert.condition}</span>&nbsp;
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{alert.threshold}{info.unit}</span>
            </div>
          </div>
        </div>
        <button onClick={onDelete}
          style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#ef4444", borderRadius: 6, padding: "0.4rem 0.6rem", cursor: "pointer" }}>
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.75rem" }}>
        <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem" }}>
          <div style={{ color: "#475569", fontSize: "0.7rem" }}>Last Value</div>
          <div style={{ color: alert.last_value != null && ((alert.condition === "below" && alert.last_value < alert.threshold) || (alert.condition === "above" && alert.last_value > alert.threshold)) ? "#ef4444" : "#10b981", fontWeight: 600, fontSize: "0.85rem" }}>
            {alert.last_value != null ? `${alert.last_value.toFixed(4)}${info.unit}` : "No data"}
          </div>
        </div>
        <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem" }}>
          <div style={{ color: "#475569", fontSize: "0.7rem" }}>Triggered At</div>
          <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>
            {alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : "Never"}
          </div>
        </div>
        <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.4rem 0.6rem" }}>
          <div style={{ color: "#475569", fontSize: "0.7rem" }}>Last Check</div>
          <div style={{ color: "#94a3b8", fontSize: "0.78rem" }}>
            {alert.last_checked_at ? new Date(alert.last_checked_at).toLocaleString() : "Never"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DecoherenceAlertsPage() {
  const [alerts, setAlerts] = useState<DecoherenceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{ checked: number; newly_triggered: number } | null>(null);
  const [form, setForm] = useState({
    backend: "ibm_brisbane",
    metric: "t1",
    threshold: METRIC_INFO.t1.defaultThreshold,
    condition: "below" as "below" | "above",
    qubit: "",
  });

  const load = async () => {
    setLoading(true);
    try { setAlerts(await listDecoherenceAlerts()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleMetricChange = (metric: string) => {
    const info = METRIC_INFO[metric];
    setForm(f => ({ ...f, metric, threshold: info?.defaultThreshold ?? f.threshold, condition: info?.defaultCondition ?? f.condition }));
  };

  const handleCreate = async () => {
    setSaving(true); setError(null);
    try {
      await createDecoherenceAlert({ backend: form.backend, metric: form.metric, threshold: form.threshold, condition: form.condition, qubit: form.qubit ? parseInt(form.qubit) : undefined });
      setShowForm(false); await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const handleCheckAll = async () => {
    setChecking(true); setCheckResult(null); setError(null);
    try {
      const r = await checkAllDecoherenceAlerts();
      setCheckResult({ checked: r.checked, newly_triggered: r.newly_triggered });
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setChecking(false); }
  };

  const handleDelete = async (id: string) => {
    await deleteDecoherenceAlert(id);
    setAlerts(a => a.filter(x => x.alert_id !== id));
  };

  const triggered = alerts.filter(a => a.triggered);
  const normal = alerts.filter(a => !a.triggered);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={28} color="#3b82f6" /> Decoherence Alerts
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            Monitor T1, T2, gate error, and readout error thresholds. Fires when calibration data breaches limits.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCheckAll} disabled={checking}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 1.1rem", cursor: "pointer" }}>
            <RefreshCw size={15} className={checking ? "spin" : ""} /> {checking ? "Checking…" : "Check All"}
          </button>
          <button onClick={() => setShowForm(s => !s)}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 600 }}>
            <Plus size={16} /> Add Alert
          </button>
        </div>
      </div>

      {checkResult && (
        <div style={{ background: checkResult.newly_triggered > 0 ? "#7f1d1d22" : "#10b98122", border: `1px solid ${checkResult.newly_triggered > 0 ? "#ef4444" : "#10b981"}`, borderRadius: 8, padding: "0.75rem 1rem", color: checkResult.newly_triggered > 0 ? "#f87171" : "#34d399", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} />
          Checked {checkResult.checked} alert{checkResult.checked !== 1 ? "s" : ""}.
          {checkResult.newly_triggered > 0 ? ` ${checkResult.newly_triggered} newly triggered!` : " All thresholds nominal."}
        </div>
      )}

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      {showForm && (
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "1rem" }}>New Alert Rule</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Backend
              <select value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
                {BACKENDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Metric
              <select value={form.metric} onChange={e => handleMetricChange(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
                {METRICS.map(m => <option key={m} value={m}>{METRIC_INFO[m]?.label ?? m}</option>)}
              </select>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Qubit (optional)
              <input type="number" value={form.qubit} onChange={e => setForm(f => ({ ...f, qubit: e.target.value }))} placeholder="all qubits" min={0}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Threshold ({METRIC_INFO[form.metric]?.unit || ""}): <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{form.threshold}</span>
              <input type="number" step="any" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Condition (alert when metric is…)
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {(["below", "above"] as const).map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, condition: c }))}
                    style={{ flex: 1, padding: "0.5rem", borderRadius: 6, border: "1px solid", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem",
                      background: form.condition === c ? "#1d4ed8" : "#0f172a",
                      borderColor: form.condition === c ? "#3b82f6" : "#334155",
                      color: form.condition === c ? "#bfdbfe" : "#64748b" }}>
                    {c}
                  </button>
                ))}
              </div>
            </label>
          </div>
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "0.75rem 1rem", color: "#94a3b8", fontSize: "0.82rem", marginBottom: "1rem" }}>
            Alert when <strong style={{ color: "#e2e8f0" }}>{METRIC_INFO[form.metric]?.label ?? form.metric}</strong> on <strong style={{ color: "#e2e8f0" }}>{form.backend}</strong> is <strong style={{ color: form.condition === "below" ? "#f59e0b" : "#ef4444" }}>{form.condition}</strong> <strong style={{ color: "#e2e8f0" }}>{form.threshold}{METRIC_INFO[form.metric]?.unit ?? ""}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={saving}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer", fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creating…" : "Create Alert"}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: "4rem" }}>
          <AlertTriangle size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
          <p>No decoherence alerts configured.</p>
          <p style={{ fontSize: "0.85rem" }}>Add an alert to get notified when quantum hardware quality drops.</p>
        </div>
      ) : (
        <>
          {triggered.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ color: "#ef4444", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} /> Triggered ({triggered.length})
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {triggered.map(a => <AlertCard key={a.alert_id} alert={a} onDelete={() => handleDelete(a.alert_id)} />)}
              </div>
            </div>
          )}
          {normal.length > 0 && (
            <div>
              <h3 style={{ color: "#64748b", fontWeight: 600, marginBottom: "0.75rem" }}>Monitoring ({normal.length})</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {normal.map(a => <AlertCard key={a.alert_id} alert={a} onDelete={() => handleDelete(a.alert_id)} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
