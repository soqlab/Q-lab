"use client";

import { useState, useEffect } from "react";
import {
  createOfflineExport,
  getOfflineExportStatus,
  getExportRequirements,
  OfflineExport,
} from "../../../lib/api";

type ExportRequirements = {
  cpu_cores: number;
  ram_gb: number;
  disk_gb: number;
  os: string[];
  docker_version: string;
  notes: string[];
};

type ExportTab = "components" | "compose" | "readme";

const FORMAT_OPTIONS = [
  { value: "docker-compose", label: "Docker Compose" },
  { value: "ova", label: "OVA (VM Image)" },
  { value: "tar-gz", label: "TAR.GZ Archive" },
];

const CLASSIFICATION_OPTIONS = [
  { value: "unclassified", label: "Unclassified" },
  { value: "CUI", label: "CUI (Controlled Unclassified)" },
  { value: "SECRET", label: "SECRET" },
];

const CLASSIFICATION_COLORS: Record<string, string> = {
  unclassified: "var(--ok)",
  CUI: "var(--warn)",
  SECRET: "var(--danger)",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--muted)",
  building: "var(--info-text)",
  ready: "var(--ok)",
  failed: "var(--danger)",
};

// ── Toggle — defined at module scope so React sees a stable component type ──
function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", userSelect: "none" }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 40, height: 22, borderRadius: 999,
          background: value ? "var(--strong)" : "var(--line)",
          position: "relative", flexShrink: 0,
          transition: "background 0.15s",
        }}
      >
        <span style={{
          position: "absolute", top: 3, left: value ? 21 : 3,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s",
        }} />
      </div>
      <span style={{ fontSize: 14, color: "var(--text)" }}>{label}</span>
    </label>
  );
}

export default function OfflineExportPage() {
  const [requirements, setRequirements] = useState<ExportRequirements | null>(null);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqError, setReqError] = useState<string | null>(null);

  const [includeData, setIncludeData] = useState(true);
  const [includeModels, setIncludeModels] = useState(false);
  const [format, setFormat] = useState("docker-compose");
  const [classificationLevel, setClassificationLevel] = useState("unclassified");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [exportBundle, setExportBundle] = useState<OfflineExport | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [activeTab, setActiveTab] = useState<ExportTab>("components");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setReqLoading(true);
    getExportRequirements()
      .then((data) => setRequirements(data))
      .catch((e: unknown) =>
        setReqError(e instanceof Error ? e.message : "Failed to load requirements")
      )
      .finally(() => setReqLoading(false));
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const bundle = await createOfflineExport({
        include_data: includeData,
        include_models: includeModels,
        format,
        classification_level: classificationLevel,
      });
      setExportBundle(bundle);
      setActiveTab("components");
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : "Failed to generate bundle");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCheckStatus() {
    if (!exportBundle) return;
    setCheckingStatus(true);
    try {
      const updated = await getOfflineExportStatus(exportBundle.export_id);
      setExportBundle(updated);
    } catch {
      // silently ignore refresh errors
    } finally {
      setCheckingStatus(false);
    }
  }

  function copyChecksum() {
    if (!exportBundle?.checksum) return;
    navigator.clipboard.writeText(exportBundle.checksum).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Offline / Air-Gap Export
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>
          Bundle Q-Lab for classified or disconnected networks
        </p>
      </div>

      {/* System Requirements */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>System Requirements</h2>
        </div>
        <div style={{ padding: "16px 20px" }}>
          {reqLoading && <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading requirements…</p>}
          {reqError && (
            <p style={{ color: "var(--danger)", background: "var(--danger-bg, rgba(239,68,68,0.08))", border: "1px solid var(--danger)", borderRadius: 8, padding: "10px 14px", fontSize: 14 }}>
              {reqError}
            </p>
          )}
          {requirements && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16 }}>
                {[
                  ["CPU Cores", requirements.cpu_cores],
                  ["RAM", `${requirements.ram_gb} GB`],
                  ["Disk", `${requirements.disk_gb} GB`],
                  ["Docker", requirements.docker_version],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{value}</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Supported OS</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(requirements.os ?? []).map((os) => (
                    <span key={os} style={{ background: "var(--info-bg)", color: "var(--info-text)", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 500 }}>{os}</span>
                  ))}
                </div>
              </div>
              {(requirements.notes ?? []).length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  {requirements.notes.map((note, i) => (
                    <li key={i} style={{ fontSize: 12, color: "var(--muted)" }}>• {note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
        {/* Export Config Form */}
        <section className="panel">
          <div className="panel-header"><h2>Export Configuration</h2></div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
            <Toggle value={includeData} onChange={setIncludeData} label="Include all experiment data" />
            <Toggle value={includeModels} onChange={setIncludeModels} label="Include ML models" />

            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Bundle Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Classification Level</label>
              <select
                value={classificationLevel}
                onChange={(e) => setClassificationLevel(e.target.value)}
                className="input"
                style={{ width: "100%" }}
              >
                {CLASSIFICATION_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {generateError && (
              <p style={{ color: "var(--danger)", fontSize: 13, background: "rgba(239,68,68,0.08)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 12px" }}>
                {generateError}
              </p>
            )}

            <button
              className="button"
              onClick={() => void handleGenerate()}
              disabled={generating}
              style={{ width: "100%" }}
            >
              {generating ? "Generating bundle…" : "Generate Bundle"}
            </button>
          </div>
        </section>

        {/* Export Card */}
        {exportBundle && (
          <section className="panel">
            <div className="panel-header">
              <h2>Export Bundle</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{
                  fontSize: 12, padding: "2px 10px", borderRadius: 999, fontWeight: 600,
                  background: "var(--info-bg)", color: STATUS_COLORS[exportBundle.status] ?? "var(--muted)",
                }}>
                  {exportBundle.status}{exportBundle.status === "building" ? "…" : ""}
                </span>
                {exportBundle.classification_level && (
                  <span style={{
                    fontSize: 12, padding: "2px 10px", borderRadius: 999, fontWeight: 600,
                    background: "var(--info-bg)", color: CLASSIFICATION_COLORS[exportBundle.classification_level] ?? "var(--muted)",
                  }}>
                    {exportBundle.classification_level}
                  </span>
                )}
              </div>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                Estimated size: <strong style={{ color: "var(--text)" }}>{exportBundle.estimated_size_mb} MB</strong>
              </p>

              {exportBundle.checksum && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{ flex: 1, background: "var(--surface)", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 11, padding: "6px 10px", borderRadius: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {exportBundle.checksum}
                  </code>
                  <button className="button secondary" style={{ height: 30, fontSize: 12, flexShrink: 0 }} onClick={copyChecksum}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)" }}>
                {(["components", "compose", "readme"] as ExportTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      background: "none", border: "none", cursor: "pointer", padding: "6px 12px", fontSize: 12, fontWeight: 500,
                      color: activeTab === tab ? "var(--strong)" : "var(--muted)",
                      borderBottom: activeTab === tab ? "2px solid var(--strong)" : "2px solid transparent",
                      marginBottom: -1,
                    }}
                  >
                    {tab === "components" ? "Components" : tab === "compose" ? "Docker Compose" : "README"}
                  </button>
                ))}
              </div>

              {activeTab === "components" && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Component</th>
                        <th style={{ textAlign: "right" }}>Size (MB)</th>
                        <th style={{ textAlign: "right" }}>Included</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(exportBundle.components ?? []).map((c) => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.size_mb}</td>
                          <td style={{ textAlign: "right" }}>
                            {c.included
                              ? <span style={{ color: "var(--ok)" }}>✓</span>
                              : <span style={{ color: "var(--muted)" }}>✗</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === "compose" && (
                <pre style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--ok)", overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 280, margin: 0 }}>
                  {exportBundle.docker_compose_yaml ?? "Not available yet"}
                </pre>
              )}

              {activeTab === "readme" && (
                <pre style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--text)", overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: 280, margin: 0 }}>
                  {exportBundle.readme ?? "Not available yet"}
                </pre>
              )}

              <button
                className="button secondary"
                onClick={() => void handleCheckStatus()}
                disabled={checkingStatus}
                style={{ width: "100%" }}
              >
                {checkingStatus ? "Checking…" : "Check Status"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
