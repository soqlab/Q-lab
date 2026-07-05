"use client";

import { useState, useEffect } from "react";
import {
  translateCircuit,
  detectCircuitSDK,
  listSupportedSDKs,
  TranslationResult,
} from "@/lib/api";

const SDK_OPTIONS = ["Qiskit", "Cirq", "PennyLane", "Q#", "tket", "Braket"];

const DEFAULT_CIRCUIT = `from qiskit import QuantumCircuit
qc = QuantumCircuit(3)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.measure_all()`;

type SDKInfo = {
  name: string;
  version: string;
  description: string;
};

export default function TranspilerHubPage() {
  const [sdks, setSdks] = useState<SDKInfo[]>([]);
  const [sdksLoading, setSdksLoading] = useState(true);
  const [sdksError, setSdksError] = useState<string | null>(null);

  // Translate form
  const [sourceSDK, setSourceSDK] = useState("Qiskit");
  const [targetSDK, setTargetSDK] = useState("Cirq");
  const [circuit, setCircuit] = useState(DEFAULT_CIRCUIT);
  const [optimize, setOptimize] = useState(false);
  const [backend, setBackend] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslationResult | null>(null);

  // Auto-detect
  const [detectCircuit, setDetectCircuit] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detection, setDetection] = useState<{
    detected_sdk: string;
    confidence: number;
    indicators: string[];
  } | null>(null);

  useEffect(() => {
    setSdksLoading(true);
    listSupportedSDKs()
      .then((data) => setSdks(data.sdks))
      .catch((e: unknown) =>
        setSdksError(e instanceof Error ? e.message : "Failed to load SDKs")
      )
      .finally(() => setSdksLoading(false));
  }, []);

  async function handleTranslate() {
    setTranslating(true);
    setTranslateError(null);
    setResult(null);
    try {
      const res = await translateCircuit({
        source_sdk: sourceSDK,
        target_sdk: targetSDK,
        circuit,
        optimize,
        backend: backend || undefined,
      });
      setResult(res);
    } catch (e: unknown) {
      setTranslateError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    setDetectError(null);
    setDetection(null);
    try {
      const res = await detectCircuitSDK({ circuit: detectCircuit });
      setDetection(res);
    } catch (e: unknown) {
      setDetectError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 24, display: "flex", flexDirection: "column", gap: 40 }}>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: "var(--text)", margin: 0 }}>Universal Quantum Transpiler</h1>
        <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 0 }}>
          Convert circuits between Qiskit, Cirq, PennyLane, Q#, tket, and Braket
        </p>
      </div>

      {/* Section 1: SDK Reference */}
      <section>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", marginBottom: 16, marginTop: 0 }}>Supported SDKs</h2>
        {sdksLoading && (
          <p style={{ color: "var(--muted)" }}>Loading SDKs...</p>
        )}
        {sdksError && (
          <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 16px" }}>
            {sdksError}
          </p>
        )}
        {!sdksLoading && !sdksError && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
            {(sdks ?? []).map((sdk) => (
              <div
                key={sdk.name}
                style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div style={{ fontWeight: 600, color: "var(--strong)", fontSize: 13 }}>{sdk.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>v{sdk.version}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.3 }}>{sdk.description}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Translate */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>Translate Circuit</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Source SDK</label>
            <select
              value={sourceSDK}
              onChange={(e) => setSourceSDK(e.target.value)}
              className="input"
              style={{ width: "100%" }}
            >
              {SDK_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Target SDK</label>
            <select
              value={targetSDK}
              onChange={(e) => setTargetSDK(e.target.value)}
              className="input"
              style={{ width: "100%" }}
            >
              {SDK_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Circuit Code</label>
          <textarea
            value={circuit}
            onChange={(e) => setCircuit(e.target.value)}
            rows={8}
            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", color: "var(--ok)", fontFamily: "ui-monospace,monospace", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
            <div
              onClick={() => setOptimize((v) => !v)}
              style={{ width: 40, height: 20, borderRadius: 999, background: optimize ? "var(--strong)" : "var(--line)", position: "relative", cursor: "pointer", flexShrink: 0 }}
            >
              <span
                style={{ position: "absolute", top: 2, left: optimize ? 22 : 2, width: 16, height: 16, background: "white", borderRadius: 999, transition: "left 0.15s" }}
              />
            </div>
            <span style={{ fontSize: 13, color: "var(--text)" }}>Optimize</span>
          </label>

          <div style={{ flex: 1, minWidth: 192 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Backend (optional)</label>
            <input
              type="text"
              value={backend}
              onChange={(e) => setBackend(e.target.value)}
              placeholder="e.g. ibm_nairobi"
              className="input"
              style={{ width: "100%", fontSize: 13, boxSizing: "border-box" }}
            />
          </div>
        </div>

        <button
          onClick={handleTranslate}
          disabled={translating}
          className="button"
          style={{ opacity: translating ? 0.5 : 1, alignSelf: "flex-start" }}
        >
          {translating ? "Translating..." : "Translate"}
        </button>

        {translateError && (
          <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 16px", margin: 0 }}>
            {translateError}
          </p>
        )}

        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Original ({sourceSDK})
                </div>
                <pre style={{ fontFamily: "ui-monospace,monospace", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", color: "var(--ok)", fontSize: 12, margin: 0 }}>
                  {result.original_circuit}
                </pre>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Translated ({targetSDK})
                </div>
                <pre style={{ fontFamily: "ui-monospace,monospace", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", color: "var(--info-text)", fontSize: 12, margin: 0 }}>
                  {result.translated_circuit}
                </pre>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, textAlign: "center" }}>
              <div style={{ background: "var(--line)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--strong)" }}>
                  {(result.equivalence_score * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Equivalence Score</div>
              </div>
              <div style={{ background: "var(--line)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                  {result.original_gate_count}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Original Gates</div>
              </div>
              <div style={{ background: "var(--line)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                  {result.translated_gate_count}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Translated Gates</div>
              </div>
            </div>

            {(result.warnings ?? []).length > 0 && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid #f59e0b", borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>Warnings</div>
                <ul style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
                  {(result.warnings ?? []).map((w, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#f59e0b" }}>• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {(result.notes ?? []).length > 0 && (
              <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid var(--info-text)", borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--info-text)", marginBottom: 4 }}>Notes</div>
                <ul style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
                  {(result.notes ?? []).map((n, i) => (
                    <li key={i} style={{ fontSize: 12, color: "var(--info-text)" }}>• {n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 3: Auto-Detect */}
      <section style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>Auto-Detect SDK</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          Paste a circuit snippet and we will identify which SDK it belongs to.
        </p>

        <textarea
          value={detectCircuit}
          onChange={(e) => setDetectCircuit(e.target.value)}
          rows={5}
          placeholder="Paste circuit code here..."
          style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontFamily: "ui-monospace,monospace", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
        />

        <button
          onClick={handleDetect}
          disabled={detecting || !detectCircuit.trim()}
          className="button"
          style={{ opacity: detecting || !detectCircuit.trim() ? 0.5 : 1, alignSelf: "flex-start", background: "#0d9488" }}
        >
          {detecting ? "Detecting..." : "Detect SDK"}
        </button>

        {detectError && (
          <p style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", borderRadius: 6, padding: "8px 16px", margin: 0 }}>
            {detectError}
          </p>
        )}

        {detection && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ background: "var(--strong)", color: "var(--text)", fontSize: 13, fontWeight: 600, padding: "4px 16px", borderRadius: 999 }}>
                {detection.detected_sdk}
              </span>
              <span style={{ color: "var(--text)", fontSize: 13 }}>
                Confidence:{" "}
                <span style={{ fontWeight: 700, color: "var(--ok)" }}>
                  {(detection.confidence * 100).toFixed(1)}%
                </span>
              </span>
            </div>
            {(detection.indicators ?? []).length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Indicators</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(detection.indicators ?? []).map((ind, i) => (
                    <span
                      key={i}
                      style={{ background: "var(--line)", border: "1px solid var(--line)", fontSize: 12, color: "var(--text)", padding: "2px 8px", borderRadius: 6 }}
                    >
                      {ind}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
