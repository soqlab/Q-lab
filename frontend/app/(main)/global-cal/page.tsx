"use client";

import { useState, useEffect } from "react";
import {
  contributeCalibration,
  getBackendCommunityCalibration,
  getCalLeaderboard,
  compareCalibration,
  GlobalCalRecord,
  BackendCommunityCalibration,
} from "@/lib/api";

type LeaderboardRow = {
  rank: number;
  backend: string;
  median_t2_us: number;
  n_contributors: number;
};

type ContributeForm = {
  backend: string;
  qubit: number;
  t1_us: number;
  t2_us: number;
  gate_error: number;
  readout_error: number;
  institution: string;
};

type CompareForm = {
  backend: string;
  your_t1: number;
  your_t2: number;
};

type CompareResult = {
  your_percentile_t1: number;
  your_percentile_t2: number;
  community_average: Record<string, number>;
  assessment: string;
};

function PercentileGauge({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value);
  const barColor =
    pct >= 75 ? "var(--ok)" : pct >= 40 ? "#f59e0b" : "var(--danger)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: "var(--text)" }}>
        {pct}
        <span style={{ fontSize: 18, color: "var(--muted)" }}>th</span>
      </div>
      <div
        style={{
          width: 128,
          height: 8,
          background: "var(--line)",
          borderRadius: 999,
          overflow: "hidden",
          marginTop: 4,
        }}
      >
        <div
          style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: barColor }}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function GlobalCalPage() {
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [lbLoading, setLbLoading] = useState(true);
  const [lbError, setLbError] = useState<string | null>(null);

  // Backend detail
  const [selectedBackend, setSelectedBackend] = useState<string | null>(null);
  const [backendCal, setBackendCal] = useState<BackendCommunityCalibration | null>(null);
  const [calLoading, setCalLoading] = useState(false);

  // Contribute form
  const [contribForm, setContribForm] = useState<ContributeForm>({
    backend: "",
    qubit: 0,
    t1_us: 0,
    t2_us: 0,
    gate_error: 0,
    readout_error: 0,
    institution: "",
  });
  const [contributing, setContributing] = useState(false);
  const [contribToast, setContribToast] = useState<GlobalCalRecord | null>(null);
  const [contribError, setContribError] = useState<string | null>(null);

  // Compare form
  const [compareForm, setCompareForm] = useState<CompareForm>({
    backend: "ibm_brisbane",
    your_t1: 0,
    your_t2: 0,
  });
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Load leaderboard on mount
  useEffect(() => {
    async function load() {
      setLbLoading(true);
      setLbError(null);
      try {
        const data = await getCalLeaderboard();
        setLeaderboard(data.leaderboard ?? []);
      } catch (e) {
        setLbError(e instanceof Error ? e.message : "Failed to load leaderboard");
      } finally {
        setLbLoading(false);
      }
    }
    load();
  }, []);

  async function handleRowClick(backend: string) {
    setSelectedBackend(backend);
    setCalLoading(true);
    setBackendCal(null);
    try {
      const data = await getBackendCommunityCalibration(backend);
      setBackendCal(data);
    } catch {
      // silently fail — user can see the backend name still
    } finally {
      setCalLoading(false);
    }
  }

  async function handleContribute() {
    setContribError(null);
    setContributing(true);
    setContribToast(null);
    try {
      const res = await contributeCalibration({
        backend: contribForm.backend,
        qubit: contribForm.qubit,
        t1_us: contribForm.t1_us,
        t2_us: contribForm.t2_us,
        gate_error: contribForm.gate_error,
        readout_error: contribForm.readout_error,
        institution: contribForm.institution || undefined,
      });
      setContribToast(res);
      setTimeout(() => setContribToast(null), 4000);
    } catch (e) {
      setContribError(e instanceof Error ? e.message : "Contribution failed");
    } finally {
      setContributing(false);
    }
  }

  async function handleCompare() {
    setCompareError(null);
    setComparing(true);
    setCompareResult(null);
    try {
      const res = await compareCalibration(compareForm);
      setCompareResult(res);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setComparing(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Global Calibration DB</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        Crowdsourced T1/T2 calibration data contributed by the quantum
        community worldwide.
      </p>

      {/* Toast */}
      {contribToast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 50,
            background: "rgba(16,185,129,0.1)",
            border: "1px solid var(--ok)",
            color: "var(--ok)",
            fontSize: 13,
            padding: "12px 16px",
            borderRadius: 12,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          Calibration contributed! Record ID: {contribToast.record_id}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* ── Section 1: Leaderboard ── */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--line)" }}>
          <h2 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            Backend Leaderboard
          </h2>

          {lbLoading && (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0", textAlign: "center" }}>
              Loading…
            </div>
          )}
          {lbError && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>{lbError}</p>
          )}
          {!lbLoading && leaderboard.length === 0 && !lbError && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>No data available.</p>
          )}

          {leaderboard.length > 0 && (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", paddingBottom: 8 }}>#</th>
                  <th style={{ textAlign: "left", paddingBottom: 8 }}>Backend</th>
                  <th style={{ textAlign: "right", paddingBottom: 8 }}>Median T2 (µs)</th>
                  <th style={{ textAlign: "right", paddingBottom: 8 }}>Contributors</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboard ?? []).map((row) => (
                  <tr
                    key={row.backend}
                    onClick={() => handleRowClick(row.backend)}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      cursor: "pointer",
                      background: selectedBackend === row.backend ? "var(--line)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px 0", color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>
                      {row.rank}
                    </td>
                    <td style={{ padding: "8px 0", color: "var(--strong)", fontWeight: 500 }}>
                      {row.backend}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right", color: "var(--text)" }}>
                      {row.median_t2_us.toFixed(1)}
                    </td>
                    <td style={{ padding: "8px 0", textAlign: "right", color: "var(--muted)" }}>
                      {row.n_contributors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Section 2: Backend Detail ── */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--line)" }}>
          <h2 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            {selectedBackend
              ? `Backend Detail — ${selectedBackend}`
              : "Backend Detail"}
          </h2>

          {!selectedBackend && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              Click a row in the leaderboard to load backend details.
            </p>
          )}

          {calLoading && (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 0", textAlign: "center" }}>
              Loading…
            </div>
          )}

          {backendCal && !calLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Community medians */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                    {backendCal.community_t1_median.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Median T1 (µs)</div>
                </div>
                <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                    {backendCal.community_t2_median.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Median T2 (µs)</div>
                </div>
                <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
                    {(backendCal.community_gate_error_median * 1000).toFixed(2)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Gate Err (m)</div>
                </div>
              </div>

              {/* Trend + forecast */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 12,
                    padding: "4px 12px",
                    borderRadius: 999,
                    fontWeight: 600,
                    background:
                      backendCal.trend === "improving"
                        ? "rgba(16,185,129,0.1)"
                        : backendCal.trend === "degrading"
                        ? "rgba(239,68,68,0.1)"
                        : "var(--line)",
                    color:
                      backendCal.trend === "improving"
                        ? "var(--ok)"
                        : backendCal.trend === "degrading"
                        ? "var(--danger)"
                        : "var(--text)",
                  }}
                >
                  {backendCal.trend}
                </span>
                <span style={{ fontSize: 12, background: "var(--line)", color: "var(--text)", padding: "4px 12px", borderRadius: 999 }}>
                  Forecast 24h — T1:{" "}
                  {backendCal.forecast_next_24h.t1.toFixed(1)} µs, T2:{" "}
                  {backendCal.forecast_next_24h.t2.toFixed(1)} µs
                </span>
              </div>

              {/* Recent records */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                      <th style={{ textAlign: "left", paddingBottom: 4 }}>Qubit</th>
                      <th style={{ textAlign: "right", paddingBottom: 4 }}>T1</th>
                      <th style={{ textAlign: "right", paddingBottom: 4 }}>T2</th>
                      <th style={{ textAlign: "right", paddingBottom: 4 }}>Gate err</th>
                      <th style={{ textAlign: "right", paddingBottom: 4 }}>Read err</th>
                      <th style={{ textAlign: "left", paddingBottom: 4, paddingLeft: 8 }}>Institution</th>
                      <th style={{ textAlign: "right", paddingBottom: 4 }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(backendCal.records ?? []).slice(0, 10).map((r: GlobalCalRecord) => (
                      <tr
                        key={r.record_id}
                        style={{ borderBottom: "1px solid var(--line)" }}
                      >
                        <td style={{ padding: "4px 0", color: "var(--text)" }}>{r.qubit}</td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: "var(--text)" }}>
                          {r.t1_us.toFixed(1)}
                        </td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: "var(--text)" }}>
                          {r.t2_us.toFixed(1)}
                        </td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: "#f59e0b" }}>
                          {(r.gate_error * 1000).toFixed(2)}m
                        </td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: "var(--muted)" }}>
                          {(r.readout_error * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: "4px 0 4px 8px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
                          {r.institution ?? "—"}
                        </td>
                        <td style={{ padding: "4px 0", textAlign: "right", color: "var(--muted)" }}>
                          {new Date(r.timestamp).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Contribute ── */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--line)" }}>
          <h2 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            Contribute Calibration
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <input
                type="text"
                className="input"
                style={{ width: "100%" }}
                placeholder="e.g. ibm_brisbane"
                value={contribForm.backend}
                onChange={(e) =>
                  setContribForm((f) => ({ ...f, backend: e.target.value }))
                }
              />
            </div>

            {(
              [
                ["Qubit", "qubit", "number"],
                ["T1 (µs)", "t1_us", "number"],
                ["T2 (µs)", "t2_us", "number"],
                ["Gate Error", "gate_error", "number"],
                ["Readout Error", "readout_error", "number"],
              ] as [string, keyof ContributeForm, string][]
            ).map(([label, key, type]) => (
              <div key={key}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  {label}
                </label>
                <input
                  type={type}
                  step="any"
                  className="input"
                  style={{ width: "100%" }}
                  value={contribForm[key]}
                  onChange={(e) =>
                    setContribForm((f) => ({
                      ...f,
                      [key]:
                        type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                />
              </div>
            ))}

            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                Institution (optional)
              </label>
              <input
                type="text"
                className="input"
                style={{ width: "100%" }}
                placeholder="MIT, Oxford…"
                value={contribForm.institution}
                onChange={(e) =>
                  setContribForm((f) => ({
                    ...f,
                    institution: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <button
            onClick={handleContribute}
            disabled={contributing || !contribForm.backend}
            style={{
              marginTop: 16,
              width: "100%",
              background: "var(--strong)",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 500,
              padding: "8px 0",
              borderRadius: 8,
              border: "none",
              cursor: contributing || !contribForm.backend ? "not-allowed" : "pointer",
              opacity: contributing || !contribForm.backend ? 0.5 : 1,
            }}
          >
            {contributing ? "Submitting…" : "Submit Calibration"}
          </button>
          {contribError && (
            <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{contribError}</p>
          )}
        </div>

        {/* ── Section 4: Compare ── */}
        <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--line)" }}>
          <h2 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            Compare My Calibration
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
              <select
                className="input"
                style={{ width: "100%" }}
                value={compareForm.backend}
                onChange={(e) =>
                  setCompareForm((f) => ({ ...f, backend: e.target.value }))
                }
              >
                <option value="ibm_brisbane">ibm_brisbane</option>
                <option value="ibm_kyoto">ibm_kyoto</option>
                <option value="ionq_aria_1">ionq_aria_1</option>
                <option value="quantinuum_h2">quantinuum_h2</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Your T1 (µs)
                </label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  style={{ width: "100%" }}
                  value={compareForm.your_t1}
                  onChange={(e) =>
                    setCompareForm((f) => ({
                      ...f,
                      your_t1: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Your T2 (µs)
                </label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  style={{ width: "100%" }}
                  value={compareForm.your_t2}
                  onChange={(e) =>
                    setCompareForm((f) => ({
                      ...f,
                      your_t2: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <button
              onClick={handleCompare}
              disabled={comparing}
              style={{
                width: "100%",
                background: "#0d9488",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 0",
                borderRadius: 8,
                border: "none",
                cursor: comparing ? "not-allowed" : "pointer",
                opacity: comparing ? 0.5 : 1,
              }}
            >
              {comparing ? "Comparing…" : "Compare"}
            </button>
            {compareError && (
              <p style={{ color: "var(--danger)", fontSize: 12 }}>{compareError}</p>
            )}

            {compareResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                {/* Percentile gauges */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-around",
                    background: "var(--surface)",
                    borderRadius: 12,
                    padding: 16,
                    border: "1px solid var(--line)",
                  }}
                >
                  <PercentileGauge
                    value={compareResult.your_percentile_t1}
                    label="T1 Percentile"
                  />
                  <div style={{ width: 1, background: "var(--line)" }} />
                  <PercentileGauge
                    value={compareResult.your_percentile_t2}
                    label="T2 Percentile"
                  />
                </div>

                {/* Assessment */}
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    background: "var(--surface)",
                    borderRadius: 8,
                    padding: 12,
                    border: "1px solid var(--line)",
                    margin: 0,
                  }}
                >
                  {compareResult.assessment}
                </p>

                {/* Community averages */}
                {Object.keys(compareResult.community_average).length > 0 && (
                  <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, border: "1px solid var(--line)" }}>
                    <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, margin: "0 0 8px 0" }}>
                      Community Averages
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {Object.entries(compareResult.community_average).map(
                        ([k, v]) => (
                          <span
                            key={k}
                            style={{
                              fontSize: 12,
                              background: "var(--line)",
                              color: "var(--text)",
                              padding: "4px 8px",
                              borderRadius: 6,
                            }}
                          >
                            {k}: {typeof v === "number" ? v.toFixed(2) : v}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
