"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchNetworkConfig,
  patchNetworkConfig,
  listNetworkPeers,
  addNetworkPeer,
  removeNetworkPeer,
  probeNetworkPeers,
  fetchNetworkBackends,
  fetchAggregateCalibration,
  NetworkConfig,
  NetworkPeer,
  PeerProbeResult,
  AggregateResult,
  MetricStat,
} from "../../../lib/api";

// ─────────────────────────────────────────────────────────────────────
// Metric labels
// ─────────────────────────────────────────────────────────────────────
const METRIC_META: Record<string, { label: string; unit: string; higherIsBetter: boolean }> = {
  avg_t1_us:           { label: "T₁",           unit: "µs",    higherIsBetter: true  },
  avg_t2_us:           { label: "T₂",           unit: "µs",    higherIsBetter: true  },
  avg_gate_error:      { label: "Gate Error",   unit: "",      higherIsBetter: false },
  avg_gate_error_2q:   { label: "2Q Error",     unit: "",      higherIsBetter: false },
  avg_readout_error:   { label: "Readout Error",unit: "",      higherIsBetter: false },
};

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  if (unit === "") return v.toExponential(2);
  return `${v.toFixed(1)} ${unit}`;
}

// ─────────────────────────────────────────────────────────────────────
// Stat card for a single metric
// ─────────────────────────────────────────────────────────────────────
function MetricCard({ name, stat }: { name: string; stat: MetricStat }) {
  const meta = METRIC_META[name] ?? { label: name, unit: "", higherIsBetter: true };
  const good = meta.higherIsBetter
    ? (stat.mean ?? 0) > 0
    : stat.mean != null && stat.mean < 0.05;
  const color = stat.n === 0 ? "#9ca3af" : good ? "#22c55e" : "#f59e0b";

  return (
    <div className="metric-card">
      <div className="metric-label">{meta.label}</div>
      <div className="metric-val" style={{ color }}>
        {fmt(stat.mean, meta.unit)}
      </div>
      {stat.n > 0 && (
        <div className="metric-sub">
          ±{fmt(stat.std, meta.unit)} · n={stat.n}
        </div>
      )}
      {stat.n > 0 && (
        <div className="metric-range">
          [{fmt(stat.min, meta.unit)} – {fmt(stat.max, meta.unit)}]
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-source breakdown row
// ─────────────────────────────────────────────────────────────────────
function SourceRow({
  source,
  reachable,
  label,
  nSnaps,
  metrics,
}: {
  source: string;
  reachable: boolean;
  label: string;
  nSnaps: number;
  metrics?: Record<string, MetricStat>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="source-row">
      <button className="source-hdr" onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${reachable ? "dot-green" : "dot-red"}`} />
        <span className="source-label">{label}</span>
        <span className="source-tag">{source}</span>
        <span className="source-snaps">{nSnaps} snapshots</span>
        <span className="chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && metrics && (
        <div className="source-metrics">
          {Object.entries(METRIC_META).map(([k]) => {
            const st = metrics[k];
            if (!st || st.n === 0) return null;
            return <MetricCard key={k} name={k} stat={st} />;
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
export default function NetworkPage() {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [peers, setPeers] = useState<NetworkPeer[]>([]);
  const [probeResults, setProbeResults] = useState<PeerProbeResult[] | null>(null);
  const [backends, setBackends] = useState<string[]>([]);
  const [selectedBackend, setSelectedBackend] = useState("");
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);

  const [nodeLabel, setNodeLabel] = useState("");
  const [peerUrl, setPeerUrl] = useState("");
  const [peerLabel, setPeerLabel] = useState("");

  const [loadingCfg, setLoadingCfg] = useState(true);
  const [loadingAgg, setLoadingAgg] = useState(false);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingPeer, setAddingPeer] = useState(false);
  const [error, setError] = useState("");
  const [peerError, setPeerError] = useState("");

  const load = useCallback(async () => {
    setLoadingCfg(true);
    setError("");
    try {
      const [cfg, pl, bl] = await Promise.all([
        fetchNetworkConfig(),
        listNetworkPeers(),
        fetchNetworkBackends(),
      ]);
      setConfig(cfg);
      setNodeLabel(cfg.node_label || "");
      setPeers(pl.peers);
      setBackends(bl.backends);
      if (!selectedBackend && bl.backends.length > 0) {
        setSelectedBackend(bl.backends[0]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingCfg(false);
    }
  }, [selectedBackend]);

  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await patchNetworkConfig({ node_label: nodeLabel });
      setConfig(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleOptIn = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await patchNetworkConfig({ opt_in: !config.opt_in });
      setConfig(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    setPeerError("");
    setAddingPeer(true);
    try {
      const result = await addNetworkPeer(peerUrl.trim(), peerLabel.trim() || undefined);
      setPeers((prev) => [...prev, result.peer]);
      setPeerUrl("");
      setPeerLabel("");
      // Refresh backends after adding peer
      const bl = await fetchNetworkBackends();
      setBackends(bl.backends);
    } catch (e) {
      setPeerError(String(e));
    } finally {
      setAddingPeer(false);
    }
  };

  const handleRemovePeer = async (id: string) => {
    try {
      await removeNetworkPeer(id);
      setPeers((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(String(e));
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const result = await probeNetworkPeers();
      setProbeResults(result.peers);
    } catch (e) {
      setError(String(e));
    } finally {
      setProbing(false);
    }
  };

  const handleAggregate = async () => {
    if (!selectedBackend) return;
    setLoadingAgg(true);
    setAggregate(null);
    try {
      const result = await fetchAggregateCalibration(selectedBackend);
      setAggregate(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingAgg(false);
    }
  };

  return (
    <>
      <style>{`
        .net-page { padding: 24px 32px; max-width: 1100px; }
        h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
        .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
        .section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .section-title { font-size: 15px; font-weight: 600; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
        .section-title .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
        .on-badge { background: #dcfce7; color: #16a34a; }
        .off-badge { background: #fee2e2; color: #dc2626; }
        .row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .field-label { font-size: 13px; color: #374151; font-weight: 500; min-width: 120px; }
        .mono { font-family: monospace; font-size: 12px; background: #f3f4f6; padding: 3px 8px; border-radius: 4px; }
        input[type=text], input[type=url] { border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 10px; font-size: 14px; width: 280px; }
        input[type=text]:focus, input[type=url]:focus { outline: 2px solid #6366f1; }
        .btn { padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; transition: opacity 0.15s; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: #6366f1; color: #fff; }
        .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
        .btn-danger { background: #fee2e2; color: #dc2626; }
        .btn-green { background: #dcfce7; color: #16a34a; }
        .toggle { position: relative; display: inline-block; width: 44px; height: 24px; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #d1d5db; border-radius: 24px; transition: .3s; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: .3s; }
        input:checked + .slider { background: #6366f1; }
        input:checked + .slider:before { transform: translateX(20px); }
        .peer-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .peer-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; }
        .peer-item .peer-label { font-weight: 500; flex: 1; }
        .peer-item .peer-url { color: #6b7280; font-family: monospace; font-size: 11px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dot-green { background: #22c55e; }
        .dot-red { background: #ef4444; }
        .dot-gray { background: #9ca3af; }
        .error-box { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
        .peer-error { color: #dc2626; font-size: 12px; margin-top: 6px; }
        .backend-select { border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 10px; font-size: 14px; min-width: 220px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-top: 16px; }
        .metric-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
        .metric-label { font-size: 11px; color: #6b7280; font-weight: 500; text-transform: uppercase; margin-bottom: 4px; }
        .metric-val { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
        .metric-sub { font-size: 11px; color: #6b7280; }
        .metric-range { font-size: 10px; color: #9ca3af; margin-top: 2px; }
        .summary-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 14px; font-size: 13px; color: #1d4ed8; margin-bottom: 12px; }
        .source-row { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; overflow: hidden; }
        .source-hdr { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f9fafb; border: none; cursor: pointer; font-size: 13px; text-align: left; }
        .source-hdr:hover { background: #f3f4f6; }
        .source-label { font-weight: 600; flex: 1; }
        .source-tag { font-size: 11px; padding: 2px 7px; border-radius: 10px; background: #e5e7eb; color: #374151; }
        .source-snaps { font-size: 11px; color: #6b7280; }
        .chevron { font-size: 11px; color: #9ca3af; }
        .source-metrics { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; background: #fff; }
        .no-backends { color: #6b7280; font-size: 13px; font-style: italic; padding: 8px 0; }
        .instance-id-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .info-row { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
      `}</style>

      <div className="net-page">
        <h1>Calibration Intelligence Network</h1>
        <p className="subtitle">
          P2P mesh for sharing anonymised calibration statistics across Q-Lab instances.
          No central server required — each node shares only aggregated mean/std/min/max values.
        </p>

        {error && <div className="error-box">{error}</div>}

        {loadingCfg ? (
          <p style={{ color: "#6b7280" }}>Loading…</p>
        ) : (
          <>
            {/* ── Node Config ───────────────────────────────────────── */}
            <div className="section">
              <div className="section-title">
                This Node
                <span className={`badge ${config?.opt_in ? "on-badge" : "off-badge"}`}>
                  {config?.opt_in ? "Sharing ON" : "Sharing OFF"}
                </span>
              </div>

              <div className="instance-id-row">
                <span className="field-label">Instance ID</span>
                <span className="mono">{config?.instance_id}</span>
              </div>

              {config?.joined_at && (
                <div className="info-row">
                  Joined network: {new Date(config.joined_at).toLocaleString()}
                </div>
              )}

              <div className="row">
                <span className="field-label">Sharing</span>
                <label className="toggle">
                  <input type="checkbox" checked={!!config?.opt_in} onChange={toggleOptIn} disabled={saving} />
                  <span className="slider" />
                </label>
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  {config?.opt_in
                    ? "Your anonymised calibration stats are visible to peers."
                    : "Enable to share calibration statistics with peers."}
                </span>
              </div>

              <div className="row">
                <span className="field-label">Node label</span>
                <input
                  type="text"
                  value={nodeLabel}
                  onChange={(e) => setNodeLabel(e.target.value)}
                  placeholder="e.g. MIT Quantum Lab"
                  maxLength={80}
                />
                <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {/* ── Peers ─────────────────────────────────────────────── */}
            <div className="section">
              <div className="section-title">
                Peer Nodes
                <span className="badge" style={{ background: "#f3f4f6", color: "#374151" }}>
                  {peers.length} configured
                </span>
              </div>

              <form onSubmit={handleAddPeer}>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <input
                    type="url"
                    value={peerUrl}
                    onChange={(e) => setPeerUrl(e.target.value)}
                    placeholder="https://peer-qlab.example.com"
                    required
                    style={{ width: 320 }}
                  />
                  <input
                    type="text"
                    value={peerLabel}
                    onChange={(e) => setPeerLabel(e.target.value)}
                    placeholder="Label (optional)"
                    style={{ width: 180 }}
                  />
                  <button className="btn btn-primary" type="submit" disabled={addingPeer || !peerUrl.trim()}>
                    {addingPeer ? "Adding…" : "Add Peer"}
                  </button>
                  {peers.length > 0 && (
                    <button className="btn btn-secondary" type="button" onClick={handleProbe} disabled={probing}>
                      {probing ? "Probing…" : "Probe All"}
                    </button>
                  )}
                </div>
                {peerError && <div className="peer-error">{peerError}</div>}
              </form>

              {peers.length === 0 ? (
                <p className="no-backends">No peers configured. Add a peer Q-Lab instance URL above.</p>
              ) : (
                <div className="peer-list">
                  {peers.map((peer) => {
                    const probe = probeResults?.find((r) => r.id === peer.id);
                    const dotClass = probe == null ? "dot-gray" : probe.reachable ? "dot-green" : "dot-red";
                    return (
                      <div className="peer-item" key={peer.id}>
                        <span className={`dot ${dotClass}`} />
                        <span className="peer-label">{peer.label}</span>
                        <span className="peer-url">{peer.url}</span>
                        {probe && (
                          <span style={{ fontSize: 11, color: probe.reachable ? "#16a34a" : "#dc2626" }}>
                            {probe.reachable
                              ? `${probe.status?.backends?.length ?? 0} backend(s)`
                              : "unreachable"}
                          </span>
                        )}
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => handleRemovePeer(peer.id)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Aggregate View ────────────────────────────────────── */}
            <div className="section">
              <div className="section-title">Network-Aggregated Calibration</div>

              {backends.length === 0 ? (
                <p className="no-backends">
                  No calibration data available yet. Submit runs with calibration fields or add peers that share data.
                </p>
              ) : (
                <>
                  <div className="row">
                    <select
                      className="backend-select"
                      value={selectedBackend}
                      onChange={(e) => setSelectedBackend(e.target.value)}
                    >
                      {backends.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      onClick={handleAggregate}
                      disabled={loadingAgg || !selectedBackend}
                    >
                      {loadingAgg ? "Aggregating…" : "Aggregate"}
                    </button>
                  </div>

                  {aggregate && (
                    <>
                      <div className="summary-box">
                        {aggregate.network_summary} — {aggregate.sources} source(s), {aggregate.total_snapshots} total snapshots.
                      </div>

                      <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>
                        Global Metrics
                      </div>
                      <div className="metrics-grid">
                        {Object.entries(aggregate.global_metrics).map(([k, stat]) =>
                          stat.n > 0 ? <MetricCard key={k} name={k} stat={stat} /> : null
                        )}
                      </div>

                      {aggregate.per_source.length > 0 && (
                        <>
                          <div className="section-title" style={{ fontSize: 13, marginTop: 20, marginBottom: 8 }}>
                            Per-Source Breakdown
                          </div>
                          {aggregate.source_status.map((s) => {
                            const snap = aggregate.per_source.find(
                              (p) => p.instance_id === s.instance_id
                            );
                            return (
                              <SourceRow
                                key={s.instance_id}
                                source={s.source}
                                reachable={s.reachable}
                                label={s.label || s.instance_id}
                                nSnaps={s.n_snapshots ?? 0}
                                metrics={snap?.metrics}
                              />
                            );
                          })}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
