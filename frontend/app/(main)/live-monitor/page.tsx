"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getLiveStatus,
  getQueueSnapshot,
  getBackendDriftHistory,
  watchBackend,
  LiveBackendStatus,
  BackendQueueSnapshot,
  CalibrationDriftEvent,
  MonitorAlertSubscription,
} from "@/lib/api";

const ALERT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  ok: { bg: "#dcfce7", color: "#15803d", label: "OK" },
  warning: { bg: "#fef3c7", color: "#92400e", label: "Warning" },
  critical: { bg: "#fee2e2", color: "#b91c1c", label: "Critical" },
};

function MetricCell({ label, value, unit = "" }: { label: string; value: string | number; unit?: string }) {
  return (
    <div style={{ minWidth: 80 }}>
      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}<span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>{unit}</span></div>
    </div>
  );
}

function OperationalDot({ operational }: { operational: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10, borderRadius: "50%",
      background: operational ? "#10b981" : "#ef4444",
      boxShadow: operational ? "0 0 6px #10b98188" : "0 0 6px #ef444488",
      flexShrink: 0,
    }} />
  );
}

export default function LiveMonitorPage() {
  const [backends, setBackends] = useState<LiveBackendStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [queuePanel, setQueuePanel] = useState<{ backend: string; data: BackendQueueSnapshot | null; loading: boolean; error: string } | null>(null);
  const [driftPanel, setDriftPanel] = useState<{ backend: string; data: CalibrationDriftEvent[]; loading: boolean; error: string } | null>(null);

  const [subForm, setSubForm] = useState({ backend: "", threshold_t1_us: "", threshold_cx_error: "", email: "" });
  const [subscribing, setSubscribing] = useState(false);
  const [subResult, setSubResult] = useState<MonitorAlertSubscription | null>(null);
  const [subError, setSubError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await getLiveStatus();
      setBackends(status);
      setLastUpdated(new Date());
      setError("");
      if (status.length > 0 && !subForm.backend) {
        setSubForm(f => ({ ...f, backend: f.backend || status[0].backend }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, [subForm.backend]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(id);
  }, []);

  const handleViewQueue = async (backend: string) => {
    setQueuePanel({ backend, data: null, loading: true, error: "" });
    setDriftPanel(null);
    try {
      const snap = await getQueueSnapshot(backend);
      setQueuePanel({ backend, data: snap, loading: false, error: "" });
    } catch (e) {
      setQueuePanel({ backend, data: null, loading: false, error: e instanceof Error ? e.message : "Failed" });
    }
  };

  const handleViewDrift = async (backend: string) => {
    setDriftPanel({ backend, data: [], loading: true, error: "" });
    setQueuePanel(null);
    try {
      const events = await getBackendDriftHistory(backend);
      setDriftPanel({ backend, data: events, loading: false, error: "" });
    } catch (e) {
      setDriftPanel({ backend, data: [], loading: false, error: e instanceof Error ? e.message : "Failed" });
    }
  };

  const handleSubscribe = async () => {
    if (!subForm.backend) { setSubError("Select a backend"); return; }
    setSubscribing(true);
    setSubError("");
    setSubResult(null);
    try {
      const res = await watchBackend({
        backend: subForm.backend,
        threshold_t1_us: subForm.threshold_t1_us ? Number(subForm.threshold_t1_us) : undefined,
        threshold_cx_error: subForm.threshold_cx_error ? Number(subForm.threshold_cx_error) : undefined,
        email: subForm.email || undefined,
      });
      setSubResult(res);
    } catch (e) {
      setSubError(e instanceof Error ? e.message : "Subscription failed");
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Live Backend Monitor</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Real-time hardware status, queue depths, and calibration drift alerts.
            {lastUpdated && <> Last updated: <strong>{lastUpdated.toLocaleTimeString()}</strong></>}
          </p>
        </div>
        <button className="button secondary" onClick={() => void refresh()} disabled={loading} style={{ height: 34 }}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Status grid */}
      {loading && backends.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>Loading backend status…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
          {backends.map(b => {
            const alert = ALERT_STYLE[b.alert_level] ?? ALERT_STYLE.ok;
            return (
              <div key={b.backend} className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <OperationalDot operational={b.operational} />
                  <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{b.backend}</span>
                  <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                    background: alert.bg, color: alert.color,
                  }}>{alert.label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
                  <MetricCell label="Queue Depth" value={b.queue_depth} />
                  <MetricCell label="Avg Wait" value={b.avg_wait_min.toFixed(1)} unit=" min" />
                  <MetricCell label="T1" value={b.t1_us.toFixed(1)} unit=" µs" />
                  <MetricCell label="T2" value={b.t2_us.toFixed(1)} unit=" µs" />
                  <MetricCell label="Readout Err" value={(b.readout_error * 100).toFixed(3)} unit="%" />
                  <MetricCell label="CX Error" value={(b.cx_error * 100).toFixed(3)} unit="%" />
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Last calibrated: {new Date(b.last_calibrated).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="button secondary"
                    style={{ height: 28, fontSize: 11, padding: "0 10px" }}
                    onClick={() => void handleViewQueue(b.backend)}
                  >
                    View Queue
                  </button>
                  <button
                    className="button secondary"
                    style={{ height: 28, fontSize: 11, padding: "0 10px" }}
                    onClick={() => void handleViewDrift(b.backend)}
                  >
                    View Drift
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Queue panel */}
      {queuePanel && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>Queue Snapshot — {queuePanel.backend}</h2>
            <button className="button secondary" style={{ height: 26, fontSize: 11 }} onClick={() => setQueuePanel(null)}>Close</button>
          </div>
          <div style={{ padding: 16 }}>
            {queuePanel.loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
            {queuePanel.error && <div style={{ color: "#b91c1c", fontSize: 13 }}>{queuePanel.error}</div>}
            {queuePanel.data && (
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                {[
                  { label: "Jobs Running", value: queuePanel.data.jobs_running },
                  { label: "Jobs Pending", value: queuePanel.data.jobs_pending },
                  { label: "Queue Depth", value: queuePanel.data.queue_depth },
                  { label: "Est. Wait", value: `${queuePanel.data.estimated_wait_min.toFixed(1)} min` },
                  { label: "Peak Today", value: queuePanel.data.peak_today },
                  { label: "Snapshot At", value: new Date(queuePanel.data.taken_at).toLocaleTimeString() },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drift panel */}
      {driftPanel && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>Calibration Drift — {driftPanel.backend}</h2>
            <button className="button secondary" style={{ height: 26, fontSize: 11 }} onClick={() => setDriftPanel(null)}>Close</button>
          </div>
          {driftPanel.loading && <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
          {driftPanel.error && <div style={{ padding: 16, color: "#b91c1c", fontSize: 13 }}>{driftPanel.error}</div>}
          {!driftPanel.loading && !driftPanel.error && (
            driftPanel.data.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No drift events recorded.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)" }}>
                      {["Qubit", "Metric", "Value", "Baseline", "Drift %", "Alert", "Timestamp"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {driftPanel.data.map((ev, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: "1px solid var(--line)",
                          background: ev.alert ? "#fee2e211" : "transparent",
                        }}
                      >
                        <td style={{ padding: "7px 12px", fontWeight: 600 }}>Q{ev.qubit}</td>
                        <td style={{ padding: "7px 12px", fontFamily: "monospace", fontSize: 12 }}>{ev.metric}</td>
                        <td style={{ padding: "7px 12px" }}>{ev.value.toFixed(4)}</td>
                        <td style={{ padding: "7px 12px", color: "var(--muted)" }}>{ev.baseline.toFixed(4)}</td>
                        <td style={{ padding: "7px 12px", color: Math.abs(ev.drift_pct) > 10 ? "#ef4444" : "inherit", fontWeight: 600 }}>
                          {ev.drift_pct > 0 ? "+" : ""}{ev.drift_pct.toFixed(1)}%
                        </td>
                        <td style={{ padding: "7px 12px" }}>
                          {ev.alert ? (
                            <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: "#fee2e2", color: "#b91c1c", fontWeight: 600 }}>Alert</span>
                          ) : (
                            <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: "#dcfce7", color: "#15803d", fontWeight: 600 }}>OK</span>
                          )}
                        </td>
                        <td style={{ padding: "7px 12px", fontSize: 12, color: "var(--muted)" }}>{new Date(ev.timestamp).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* Alert subscription form */}
      <div className="panel">
        <div className="panel-header"><h2>Alert Subscription</h2></div>
        <div style={{ padding: 16 }}>
          {subError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>
              {subError}
            </div>
          )}
          {subResult && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: "#dcfce7", borderRadius: 6, color: "#15803d", fontSize: 13 }}>
              Subscribed! ID: <code style={{ fontSize: 11 }}>{subResult.sub_id}</code>
              — monitoring <strong>{subResult.backend}</strong>
              <button style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", color: "#15803d", fontSize: 12, textDecoration: "underline" }}
                onClick={() => setSubResult(null)}>Dismiss</button>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Backend</span>
              <select className="input" value={subForm.backend} onChange={e => setSubForm(f => ({ ...f, backend: e.target.value }))} style={{ height: 34 }}>
                <option value="">Select backend…</option>
                {backends.map(b => <option key={b.backend} value={b.backend}>{b.backend}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Min T1 Threshold (µs)</span>
              <input className="input" type="number" step="any" placeholder="e.g. 50" value={subForm.threshold_t1_us}
                onChange={e => setSubForm(f => ({ ...f, threshold_t1_us: e.target.value }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Max CX Error</span>
              <input className="input" type="number" step="any" placeholder="e.g. 0.01" value={subForm.threshold_cx_error}
                onChange={e => setSubForm(f => ({ ...f, threshold_cx_error: e.target.value }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Email (optional)</span>
              <input className="input" type="email" placeholder="you@example.com" value={subForm.email}
                onChange={e => setSubForm(f => ({ ...f, email: e.target.value }))} style={{ height: 34 }} />
            </label>
          </div>
          <button className="button" onClick={() => void handleSubscribe()} disabled={subscribing} style={{ height: 36, marginTop: 16 }}>
            {subscribing ? "Subscribing…" : "Subscribe"}
          </button>
        </div>
      </div>
    </div>
  );
}
