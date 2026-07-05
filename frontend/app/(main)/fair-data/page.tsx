"use client";

import { useState, useEffect, useCallback } from "react";
import {
  generateFAIRRecord,
  listFAIRRecords,
  FAIRRecord,
  FAIRScore,
} from "@/lib/api";

const BACKENDS = ["ibm_brisbane", "ibm_sherbrooke", "ibm_kyoto", "simulator", "ionq_aria", "quantinuum_h1"];

const METADATA_TABS = [
  { key: "ro_crate", label: "RO-Crate JSON" },
  { key: "datacite", label: "DataCite XML" },
  { key: "zenodo", label: "Zenodo Metadata JSON" },
] as const;

type MetadataTab = typeof METADATA_TABS[number]["key"];

function ScoreBar({ label, value }: { label: string; value: number }) {
  const barColor =
    value >= 80 ? "var(--ok)" : value >= 50 ? "#f59e0b" : "var(--danger)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: "var(--text)" }}>{label}</span>
        <span style={{ fontFamily: "ui-monospace,monospace", color: "var(--text)" }}>{value}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--line)" }}>
        <div
          style={{ height: 8, borderRadius: 999, background: barColor, width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function CopyBadge({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        border: "1px solid var(--strong)",
        background: "var(--surface)",
        padding: "6px 16px",
        fontFamily: "ui-monospace,monospace",
        fontSize: 13,
        color: "var(--strong)",
        cursor: "pointer",
      }}
    >
      {text}
      <span style={{ fontSize: 12, color: "var(--strong)" }}>{copied ? "Copied!" : "Click to copy"}</span>
    </button>
  );
}

function RecordResult({ record }: { record: FAIRRecord }) {
  const [activeTab, setActiveTab] = useState<MetadataTab>("ro_crate");
  const [copiedTab, setCopiedTab] = useState(false);

  const tabContent: Record<MetadataTab, string> = {
    ro_crate: JSON.stringify(record.ro_crate_json, null, 2),
    datacite: record.datacite_xml,
    zenodo: JSON.stringify(record.zenodo_metadata, null, 2),
  };

  const handleCopyTab = () => {
    navigator.clipboard.writeText(tabContent[activeTab]).then(() => {
      setCopiedTab(true);
      setTimeout(() => setCopiedTab(false), 2000);
    });
  };

  const score: FAIRScore = record.fair_score;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 24,
      borderRadius: 12,
      border: "1px solid var(--line)",
      background: "var(--surface)",
      padding: 24,
    }}>
      {/* DOI */}
      <div>
        <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>DOI</p>
        <CopyBadge text={record.doi} />
      </div>

      {/* Total score */}
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 60, fontWeight: 900, color: "var(--text)" }}>{score.total}</p>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>FAIR Total Score / 100</p>
      </div>

      {/* Score bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ScoreBar label="Findable" value={score.findable} />
        <ScoreBar label="Accessible" value={score.accessible} />
        <ScoreBar label="Interoperable" value={score.interoperable} />
        <ScoreBar label="Reusable" value={score.reusable} />
      </div>

      {/* Checklist */}
      <div>
        <p style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>Checklist</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
          {(record.checklist ?? []).map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 8, background: "var(--line)", padding: "8px 12px" }}>
              <span style={{ color: item.done ? "var(--ok)" : "var(--muted)", marginTop: 2 }}>
                {item.done ? "✓" : "○"}
              </span>
              <span style={{ fontSize: 13, color: item.done ? "var(--text)" : "var(--muted)" }}>{item.item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Landing page */}
      <div>
        <p style={{ marginBottom: 4, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>Landing Page</p>
        <a
          href={record.landing_page_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--strong)", textDecoration: "underline", fontSize: 13, wordBreak: "break-all" }}
        >
          {record.landing_page_url}
        </a>
      </div>

      {/* Metadata tabs */}
      <div>
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
          {METADATA_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                background: "none",
                border: "none",
                borderBottom: activeTab === t.key ? "2px solid var(--strong)" : "2px solid transparent",
                color: activeTab === t.key ? "var(--strong)" : "var(--muted)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            onClick={handleCopyTab}
            style={{
              position: "absolute",
              right: 8,
              top: 8,
              borderRadius: 6,
              background: "var(--line)",
              padding: "4px 8px",
              fontSize: 12,
              color: "var(--text)",
              cursor: "pointer",
              border: "none",
            }}
          >
            {copiedTab ? "Copied!" : "Copy"}
          </button>
          <pre style={{
            maxHeight: 288,
            overflowY: "auto",
            borderRadius: 8,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            padding: 16,
            fontSize: 12,
            color: "var(--text)",
            fontFamily: "ui-monospace,monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {tabContent[activeTab]}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function FAIRDataPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [algorithm, setAlgorithm] = useState("");
  const [backend, setBackend] = useState(BACKENDS[0]);
  const [nQubits, setNQubits] = useState(5);
  const [nShots, setNShots] = useState(1024);
  const [fidelity, setFidelity] = useState("");
  const [runIds, setRunIds] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FAIRRecord | null>(null);

  const [pastRecords, setPastRecords] = useState<FAIRRecord[]>([]);
  const [pastLoading, setPastLoading] = useState(true);

  const loadPast = useCallback(async () => {
    setPastLoading(true);
    try {
      const data = await listFAIRRecords();
      setPastRecords(data.records);
    } catch {
      // non-blocking
    } finally {
      setPastLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPast();
  }, [loadPast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const req = {
        title,
        description,
        algorithm,
        backend,
        n_qubits: nQubits,
        n_shots: nShots,
        ...(fidelity !== "" ? { fidelity: parseFloat(fidelity) } : {}),
        ...(runIds.trim() !== ""
          ? { run_ids: runIds.split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
      };
      const rec = await generateFAIRRecord(req);
      setResult(rec);
      loadPast();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 4,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--muted)",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", color: "var(--text)" }}>
      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <h1 style={{ marginBottom: 4, fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text)" }}>FAIR Data Compliance Engine</h1>
        <p style={{ marginBottom: 32, color: "var(--muted)" }}>
          Make your experiments Findable, Accessible, Interoperable, Reusable.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          padding: 24,
          marginBottom: 32,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="Experiment title"
              />
            </div>
            <div>
              <label style={labelStyle}>
                Algorithm *
              </label>
              <input
                required
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="input"
                placeholder="e.g. VQE, QAOA"
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Description *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
              placeholder="Describe the experiment..."
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Backend *
              </label>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="input"
              >
                {BACKENDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>
                Qubits *
              </label>
              <input
                type="number"
                min={1}
                max={127}
                required
                value={nQubits}
                onChange={(e) => setNQubits(parseInt(e.target.value) || 1)}
                className="input"
              />
            </div>
            <div>
              <label style={labelStyle}>
                Shots *
              </label>
              <input
                type="number"
                min={1}
                required
                value={nShots}
                onChange={(e) => setNShots(parseInt(e.target.value) || 1024)}
                className="input"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            <div>
              <label style={labelStyle}>
                Fidelity (optional)
              </label>
              <input
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={fidelity}
                onChange={(e) => setFidelity(e.target.value)}
                className="input"
                placeholder="0.0 – 1.0"
              />
            </div>
            <div>
              <label style={labelStyle}>
                Run IDs (comma-separated, optional)
              </label>
              <input
                value={runIds}
                onChange={(e) => setRunIds(e.target.value)}
                className="input"
                placeholder="run-abc, run-def"
              />
            </div>
          </div>

          {error && (
            <div style={{
              borderRadius: 8,
              border: "1px solid var(--danger)",
              background: "rgba(239,68,68,0.1)",
              padding: "12px 16px",
              fontSize: 13,
              color: "var(--danger)",
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="button"
            style={{ width: "100%", opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? "Generating FAIR Record..." : "Generate FAIR Record"}
          </button>
        </form>

        {result && <RecordResult record={result} />}
      </div>

      {/* Sidebar */}
      <aside style={{
        width: 288,
        flexShrink: 0,
        overflowY: "auto",
        borderLeft: "1px solid var(--line)",
        background: "var(--surface)",
        padding: 20,
      }}>
        <h2 style={{ marginBottom: 16, fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>Past Records</h2>
        {pastLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>
        ) : (pastRecords ?? []).length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No records yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(pastRecords ?? []).map((r) => (
              <div
                key={r.record_id}
                style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 12 }}
              >
                <p style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: "var(--strong)", wordBreak: "break-all", marginBottom: 4 }}>{r.doi}</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>FAIR Score</span>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: r.fair_score.total >= 80
                      ? "var(--ok)"
                      : r.fair_score.total >= 50
                      ? "#f59e0b"
                      : "var(--danger)",
                  }}>
                    {r.fair_score.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
