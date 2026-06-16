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
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-white">Universal Quantum Transpiler</h1>
        <p className="text-gray-400 mt-1">
          Convert circuits between Qiskit, Cirq, PennyLane, Q#, tket, and Braket
        </p>
      </div>

      {/* Section 1: SDK Reference */}
      <section>
        <h2 className="text-xl font-semibold text-gray-200 mb-4">Supported SDKs</h2>
        {sdksLoading && (
          <p className="text-gray-400 animate-pulse">Loading SDKs...</p>
        )}
        {sdksError && (
          <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">
            {sdksError}
          </p>
        )}
        {!sdksLoading && !sdksError && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {sdks.map((sdk) => (
              <div
                key={sdk.name}
                className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-1"
              >
                <div className="font-semibold text-indigo-400 text-sm">{sdk.name}</div>
                <div className="text-xs text-gray-500">v{sdk.version}</div>
                <div className="text-xs text-gray-400 leading-snug">{sdk.description}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Translate */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
        <h2 className="text-xl font-semibold text-gray-200">Translate Circuit</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Source SDK</label>
            <select
              value={sourceSDK}
              onChange={(e) => setSourceSDK(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SDK_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Target SDK</label>
            <select
              value={targetSDK}
              onChange={(e) => setTargetSDK(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {SDK_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Circuit Code</label>
          <textarea
            value={circuit}
            onChange={(e) => setCircuit(e.target.value)}
            rows={8}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-green-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
        </div>

        <div className="flex flex-wrap gap-6 items-center">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setOptimize((v) => !v)}
              className={`w-10 h-5 rounded-full transition-colors ${optimize ? "bg-indigo-600" : "bg-gray-700"} relative`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${optimize ? "translate-x-5" : ""}`}
              />
            </div>
            <span className="text-sm text-gray-300">Optimize</span>
          </label>

          <div className="flex-1 min-w-48">
            <label className="block text-sm text-gray-400 mb-1">Backend (optional)</label>
            <input
              type="text"
              value={backend}
              onChange={(e) => setBackend(e.target.value)}
              placeholder="e.g. ibm_nairobi"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <button
          onClick={handleTranslate}
          disabled={translating}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {translating ? "Translating..." : "Translate"}
        </button>

        {translateError && (
          <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">
            {translateError}
          </p>
        )}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">
                  Original ({sourceSDK})
                </div>
                <pre className="bg-gray-950 border border-gray-700 rounded p-4 text-green-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                  {result.original_circuit}
                </pre>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1 uppercase tracking-wide">
                  Translated ({targetSDK})
                </div>
                <pre className="bg-gray-950 border border-gray-700 rounded p-4 text-cyan-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                  {result.translated_circuit}
                </pre>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-2xl font-bold text-indigo-400">
                  {(result.equivalence_score * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Equivalence Score</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-2xl font-bold text-gray-200">
                  {result.original_gate_count}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Original Gates</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-2xl font-bold text-gray-200">
                  {result.translated_gate_count}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Translated Gates</div>
              </div>
            </div>

            {result.warnings && result.warnings.length > 0 && (
              <div className="bg-yellow-950 border border-yellow-800 rounded p-3">
                <div className="text-xs font-semibold text-yellow-400 mb-1">Warnings</div>
                <ul className="space-y-1">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-yellow-300">• {w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.notes && result.notes.length > 0 && (
              <div className="bg-blue-950 border border-blue-800 rounded p-3">
                <div className="text-xs font-semibold text-blue-400 mb-1">Notes</div>
                <ul className="space-y-1">
                  {result.notes.map((n, i) => (
                    <li key={i} className="text-xs text-blue-300">• {n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 3: Auto-Detect */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-xl font-semibold text-gray-200">Auto-Detect SDK</h2>
        <p className="text-sm text-gray-400">
          Paste a circuit snippet and we will identify which SDK it belongs to.
        </p>

        <textarea
          value={detectCircuit}
          onChange={(e) => setDetectCircuit(e.target.value)}
          rows={5}
          placeholder="Paste circuit code here..."
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
        />

        <button
          onClick={handleDetect}
          disabled={detecting || !detectCircuit.trim()}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {detecting ? "Detecting..." : "Detect SDK"}
        </button>

        {detectError && (
          <p className="text-red-400 bg-red-950 border border-red-800 rounded px-4 py-2">
            {detectError}
          </p>
        )}

        {detection && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <span className="bg-indigo-700 text-white text-sm font-semibold px-4 py-1 rounded-full">
                {detection.detected_sdk}
              </span>
              <span className="text-gray-300 text-sm">
                Confidence:{" "}
                <span className="font-bold text-green-400">
                  {(detection.confidence * 100).toFixed(1)}%
                </span>
              </span>
            </div>
            {detection.indicators && detection.indicators.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Indicators</div>
                <div className="flex flex-wrap gap-2">
                  {detection.indicators.map((ind, i) => (
                    <span
                      key={i}
                      className="bg-gray-800 border border-gray-700 text-xs text-gray-300 px-2 py-0.5 rounded"
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
