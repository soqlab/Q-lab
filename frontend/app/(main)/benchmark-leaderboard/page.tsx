"use client";

import { useEffect, useState } from "react";
import {
  getBenchmarkLeaderboard,
  submitBenchmark,
  getBenchmarkRecords,
  type LeaderboardEntry,
} from "@/lib/api";

type Record_ = { benchmark: string; backend: string; value: number; date: string };

function scoreColor(v: number): string {
  if (v >= 0.97) return "#4ade80";
  if (v >= 0.9) return "#facc15";
  return "#f87171";
}

function TrendBadge({ trend }: { trend: string }) {
  if (trend === "up")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold bg-green-900/50 text-green-400">
        ↑
      </span>
    );
  if (trend === "down")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold bg-red-900/50 text-red-400">
        ↓
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold bg-zinc-700 text-zinc-400">
      —
    </span>
  );
}

function ScoreCell({ value }: { value: number }) {
  return (
    <span style={{ color: scoreColor(value), fontWeight: 600 }}>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

export default function BenchmarkLeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [lastRun, setLastRun] = useState<string>("");
  const [totalBackends, setTotalBackends] = useState<number>(0);
  const [records, setRecords] = useState<Record_[]>([]);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Submit form state
  const [subBackend, setSubBackend] = useState("");
  const [subType, setSubType] = useState("qaoa");
  const [subValue, setSubValue] = useState<number>(0.95);
  const [subQubits, setSubQubits] = useState<number>(4);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ rank: number; message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getBenchmarkLeaderboard(), getBenchmarkRecords()])
      .then(([lb, rec]) => {
        setEntries(lb.benchmarks);
        setLastRun(lb.last_run);
        setTotalBackends(lb.total_backends);
        setRecords(rec.records);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const result = await submitBenchmark({
        backend: subBackend,
        benchmark_type: subType,
        value: subValue,
        n_qubits: subQubits,
      });
      setSubmitResult(result);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedEntry = entries.find((e) => e.backend === selectedRow) ?? null;

  return (
    <main className="page">
      {/* Header */}
      <section className="panel" style={{ marginBottom: 0 }}>
        <div className="panel-header">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
              Live Benchmark Leaderboard
            </h2>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              Continuous QPU benchmarking across all registered backends
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
            <div>Backends tracked: <strong style={{ color: "var(--strong)" }}>{totalBackends}</strong></div>
            {lastRun && <div>Last run: {new Date(lastRun).toLocaleString()}</div>}
          </div>
        </div>
      </section>

      {/* Leaderboard Table */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Rankings</h3>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--muted)", alignItems: "center" }}>
            <span style={{ color: "#4ade80" }}>● ≥97%</span>
            <span style={{ color: "#facc15" }}>● ≥90%</span>
            <span style={{ color: "#f87171" }}>● &lt;90%</span>
          </div>
        </div>

        {loading && (
          <div className="empty">Loading leaderboard…</div>
        )}
        {error && (
          <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="empty">No benchmark data available yet.</div>
        )}
        {!loading && !error && entries.length > 0 && (
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Backend</th>
                  <th>QAOA</th>
                  <th>VQE</th>
                  <th>QFT</th>
                  <th>GHZ</th>
                  <th>Mirror</th>
                  <th>Overall Score</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.backend}
                    onClick={() =>
                      setSelectedRow(selectedRow === entry.backend ? null : entry.backend)
                    }
                    style={{
                      cursor: "pointer",
                      background:
                        selectedRow === entry.backend
                          ? "rgba(99,102,241,0.12)"
                          : undefined,
                      outline:
                        selectedRow === entry.backend
                          ? "1px solid rgba(99,102,241,0.4)"
                          : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 700, color: entry.rank <= 3 ? "#facc15" : "var(--strong)" }}>
                      #{entry.rank}
                    </td>
                    <td style={{ fontWeight: 600 }}>{entry.backend}</td>
                    <td><ScoreCell value={entry.qaoa_ratio} /></td>
                    <td><ScoreCell value={entry.vqe_fidelity} /></td>
                    <td><ScoreCell value={entry.qft_fidelity} /></td>
                    <td><ScoreCell value={entry.ghz_fidelity} /></td>
                    <td><ScoreCell value={entry.mirror_fidelity} /></td>
                    <td>
                      <span
                        style={{
                          color: scoreColor(entry.overall_score),
                          fontWeight: 700,
                          fontSize: 14,
                        }}
                      >
                        {(entry.overall_score * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td><TrendBadge trend={entry.trend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail panel for selected row */}
        {selectedEntry && (
          <div
            style={{
              margin: "12px 16px",
              padding: "16px",
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 8,
            }}
          >
            <h4 style={{ fontWeight: 700, marginBottom: 10, color: "var(--strong)" }}>
              {selectedEntry.backend} — Detail
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 12,
              }}
            >
              {(
                [
                  ["QAOA Ratio", selectedEntry.qaoa_ratio],
                  ["VQE Fidelity", selectedEntry.vqe_fidelity],
                  ["QFT Fidelity", selectedEntry.qft_fidelity],
                  ["GHZ Fidelity", selectedEntry.ghz_fidelity],
                  ["Mirror Fidelity", selectedEntry.mirror_fidelity],
                  ["Overall Score", selectedEntry.overall_score],
                ] as [string, number][]
              ).map(([label, val]) => (
                <div
                  key={label}
                  style={{
                    background: "var(--surface)",
                    borderRadius: 6,
                    padding: "10px 14px",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(val) }}>
                    {(val * 100).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
              Last updated: {new Date(selectedEntry.last_updated).toLocaleString()}
            </div>
          </div>
        )}
      </section>

      {/* All-time Records */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>All-Time Records</h3>
        </div>
        {records.length === 0 && !loading && (
          <div className="empty">No records found.</div>
        )}
        {records.length > 0 && (
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Benchmark</th>
                  <th>Backend</th>
                  <th>Value</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>{r.benchmark}</td>
                    <td>{r.backend}</td>
                    <td style={{ color: scoreColor(r.value), fontWeight: 700 }}>
                      {(r.value * 100).toFixed(3)}%
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {new Date(r.date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Submit Benchmark */}
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <h3 style={{ fontWeight: 600 }}>Submit New Benchmark</h3>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} style={{ padding: "16px 18px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 14,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                Backend
              </label>
              <input
                className="input"
                value={subBackend}
                onChange={(e) => setSubBackend(e.target.value)}
                placeholder="e.g. ibm_sherbrooke"
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                Benchmark Type
              </label>
              <select
                className="input"
                value={subType}
                onChange={(e) => setSubType(e.target.value)}
              >
                <option value="qaoa">QAOA</option>
                <option value="vqe">VQE</option>
                <option value="qft">QFT</option>
                <option value="ghz">GHZ</option>
                <option value="mirror">Mirror</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                Value (0–1)
              </label>
              <input
                className="input"
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={subValue}
                onChange={(e) => setSubValue(parseFloat(e.target.value))}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                N Qubits
              </label>
              <input
                className="input"
                type="number"
                min="1"
                value={subQubits}
                onChange={(e) => setSubQubits(parseInt(e.target.value, 10))}
                required
              />
            </div>
          </div>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit Benchmark"}
          </button>
        </form>

        {submitResult && (
          <div
            style={{
              margin: "0 18px 16px",
              padding: "14px 16px",
              background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 700, color: "#4ade80", fontSize: 16 }}>
              Rank #{submitResult.rank}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              {submitResult.message}
            </div>
          </div>
        )}
        {submitError && (
          <div
            style={{
              margin: "0 18px 16px",
              padding: "12px 16px",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 8,
              color: "#f87171",
              fontSize: 13,
            }}
          >
            {submitError}
          </div>
        )}
      </section>
    </main>
  );
}
