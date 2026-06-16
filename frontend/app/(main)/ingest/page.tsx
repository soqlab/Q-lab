"use client";

import { useState } from "react";
import { ingestAuto, ingestCirq, ingestIonQ, ingestBraket, ingestOpenQASM3, IngestResult } from "../../../lib/api";

type Format = "auto" | "cirq" | "ionq" | "braket" | "openqasm3";

const FORMAT_DESCRIPTIONS: Record<Format, string> = {
  auto: "Auto-detect format from payload structure",
  cirq: "Google Cirq measurement result dict",
  ionq: "IonQ histogram probability format",
  braket: "AWS Braket measurementProbabilities format",
  openqasm3: "OpenQASM 3.0 with optional counts",
};

const FORMAT_EXAMPLES: Record<Format, string> = {
  auto: `{"measurements": {"0": 523, "1": 501}}`,
  cirq: `{"measurements": {"q(0)": [0, 1, 0], "q(1)": [1, 0, 1]}}`,
  ionq: `{"histogram": {"0": 0.51, "3": 0.49}}`,
  braket: `{"measurementProbabilities": {"00": 0.512, "11": 0.488}}`,
  openqasm3: `{"qasm": "OPENQASM 3; qubit[2] q; bit[2] c; h q[0]; cnot q[0], q[1]; c = measure q;"}`,
};

export default function IngestPage() {
  const [format, setFormat] = useState<Format>("auto");
  const [payloadText, setPayloadText] = useState(FORMAT_EXAMPLES.auto);
  const [backend, setBackend] = useState("ibm_brisbane");
  const [shots, setShots] = useState(1024);
  const [projectSlug, setProjectSlug] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFormatChange = (f: Format) => {
    setFormat(f);
    setPayloadText(FORMAT_EXAMPLES[f]);
  };

  const handleIngest = async () => {
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(payloadText) as Record<string, unknown>;
      } catch {
        throw new Error("Payload is not valid JSON");
      }
      const tags = tagsText ? tagsText.split(",").map(t => t.trim()).filter(Boolean) : [];
      const req = { payload, backend, shots, project_slug: projectSlug || undefined, tags };
      let res: IngestResult;
      if (format === "auto") res = await ingestAuto(req);
      else if (format === "cirq") res = await ingestCirq(req);
      else if (format === "ionq") res = await ingestIonQ(req);
      else if (format === "braket") res = await ingestBraket(req);
      else res = await ingestOpenQASM3(req);
      setResult(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const topCounts = result
    ? Object.entries(result.counts).sort((a, b) => b[1] - a[1]).slice(0, 16)
    : [];
  const maxCount = topCounts[0]?.[1] ?? 1;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Multi-Provider Ingest</h1>
      <p style={{ color: "#9ca3af", marginBottom: 20, marginTop: 0 }}>
        Import quantum results from Cirq, IonQ, Braket, or OpenQASM 3 into Q-Lab.
      </p>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Form */}
        <div className="panel" style={{ flex: 1, minWidth: 340 }}>
          <div className="panel-header"><h2>Import Settings</h2></div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Format tabs */}
            <div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Source Format</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["auto", "cirq", "ionq", "braket", "openqasm3"] as Format[]).map(f => (
                  <button
                    key={f}
                    onClick={() => handleFormatChange(f)}
                    style={{
                      padding: "4px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
                      borderColor: format === f ? "#3b82f6" : "#374151",
                      background: format === f ? "#1d4ed822" : "transparent",
                      color: format === f ? "#3b82f6" : "#9ca3af",
                    }}
                  >{f}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>{FORMAT_DESCRIPTIONS[format]}</div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>JSON Payload</span>
              <textarea
                className="input"
                value={payloadText}
                onChange={e => setPayloadText(e.target.value)}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Backend</span>
                <input className="input" value={backend} onChange={e => setBackend(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 90px" }}>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>Shots</span>
                <input className="input" type="number" value={shots} onChange={e => setShots(Number(e.target.value))} />
              </label>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Project Slug (optional)</span>
              <input className="input" value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="my-project" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>Tags (comma-separated)</span>
              <input className="input" value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="imported, cirq" />
            </label>

            <button className="btn btn-primary" onClick={handleIngest} disabled={loading}>
              {loading ? "Importing..." : "Import Result"}
            </button>
          </div>
        </div>

        {/* Result */}
        <div style={{ flex: 1, minWidth: 280 }}>
          {result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600, marginBottom: 8 }}>Import Successful</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <div><span style={{ color: "#9ca3af" }}>Run ID: </span><span style={{ fontFamily: "monospace" }}>{result.run_id}</span></div>
                  <div><span style={{ color: "#9ca3af" }}>Format: </span>{result.source_format}</div>
                  <div><span style={{ color: "#9ca3af" }}>Backend: </span>{result.backend}</div>
                  <div><span style={{ color: "#9ca3af" }}>Qubits: </span>{result.n_qubits}</div>
                  <div><span style={{ color: "#9ca3af" }}>Shots: </span>{result.shots.toLocaleString()}</div>
                  <div><span style={{ color: "#9ca3af" }}>Success Prob: </span>{(result.success_probability * 100).toFixed(1)}%</div>
                </div>
                <a href={`/runs/${result.run_id}`} className="btn btn-primary" style={{ marginTop: 12, display: "inline-block" }}>
                  View Run
                </a>
              </div>

              <div className="panel">
                <div className="panel-header"><h2>Measurement Distribution</h2></div>
                <div style={{ padding: 16 }}>
                  {topCounts.map(([bs, count]) => (
                    <div key={bs} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                        <span style={{ fontFamily: "monospace" }}>{bs}</span>
                        <span style={{ color: "#9ca3af" }}>{count}</span>
                      </div>
                      <div style={{ height: 8, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(count / maxCount) * 100}%`, background: "#3b82f6", borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
              Import a result to see the distribution here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
