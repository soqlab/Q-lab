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
  const color =
    pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex flex-col items-center">
      <div className="text-3xl font-bold text-white">
        {pct}
        <span className="text-lg text-gray-400">th</span>
      </div>
      <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden mt-1">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
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
        setLeaderboard(data.leaderboard);
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
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Global Calibration DB</h1>
      <p className="text-gray-400 text-sm mb-6">
        Crowdsourced T1/T2 calibration data contributed by the quantum
        community worldwide.
      </p>

      {/* Toast */}
      {contribToast && (
        <div className="fixed top-4 right-4 z-50 bg-green-800 border border-green-500 text-green-100 text-sm px-4 py-3 rounded-xl shadow-lg">
          Calibration contributed! Record ID: {contribToast.record_id}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* ── Section 1: Leaderboard ── */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-200 mb-3">
            Backend Leaderboard
          </h2>

          {lbLoading && (
            <div className="text-gray-500 text-sm py-4 text-center">
              Loading…
            </div>
          )}
          {lbError && (
            <p className="text-red-400 text-sm">{lbError}</p>
          )}
          {!lbLoading && leaderboard.length === 0 && !lbError && (
            <p className="text-gray-500 text-sm">No data available.</p>
          )}

          {leaderboard.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-700">
                  <th className="text-left pb-2">#</th>
                  <th className="text-left pb-2">Backend</th>
                  <th className="text-right pb-2">Median T2 (µs)</th>
                  <th className="text-right pb-2">Contributors</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr
                    key={row.backend}
                    onClick={() => handleRowClick(row.backend)}
                    className={`border-b border-gray-700 last:border-0 cursor-pointer hover:bg-gray-700 transition-colors ${
                      selectedBackend === row.backend ? "bg-gray-700" : ""
                    }`}
                  >
                    <td className="py-2 text-gray-400 font-mono">
                      {row.rank}
                    </td>
                    <td className="py-2 text-indigo-300 font-medium">
                      {row.backend}
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.median_t2_us.toFixed(1)}
                    </td>
                    <td className="py-2 text-right text-gray-400">
                      {row.n_contributors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Section 2: Backend Detail ── */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-200 mb-3">
            {selectedBackend
              ? `Backend Detail — ${selectedBackend}`
              : "Backend Detail"}
          </h2>

          {!selectedBackend && (
            <p className="text-gray-500 text-sm">
              Click a row in the leaderboard to load backend details.
            </p>
          )}

          {calLoading && (
            <div className="text-gray-500 text-sm py-4 text-center">
              Loading…
            </div>
          )}

          {backendCal && !calLoading && (
            <div className="space-y-4">
              {/* Community medians */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-white">
                    {backendCal.community_t1_median.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-400">Median T1 (µs)</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-white">
                    {backendCal.community_t2_median.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-400">Median T2 (µs)</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-white">
                    {(backendCal.community_gate_error_median * 1000).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">Gate Err (m)</div>
                </div>
              </div>

              {/* Trend + forecast */}
              <div className="flex gap-3 flex-wrap">
                <span
                  className={`text-xs px-3 py-1 rounded-full font-semibold ${
                    backendCal.trend === "improving"
                      ? "bg-green-800 text-green-200"
                      : backendCal.trend === "degrading"
                      ? "bg-red-800 text-red-200"
                      : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {backendCal.trend}
                </span>
                <span className="text-xs bg-gray-700 text-gray-300 px-3 py-1 rounded-full">
                  Forecast 24h — T1:{" "}
                  {backendCal.forecast_next_24h.t1.toFixed(1)} µs, T2:{" "}
                  {backendCal.forecast_next_24h.t2.toFixed(1)} µs
                </span>
              </div>

              {/* Recent records */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left pb-1">Qubit</th>
                      <th className="text-right pb-1">T1</th>
                      <th className="text-right pb-1">T2</th>
                      <th className="text-right pb-1">Gate err</th>
                      <th className="text-right pb-1">Read err</th>
                      <th className="text-left pb-1 pl-2">Institution</th>
                      <th className="text-right pb-1">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backendCal.records.slice(0, 10).map((r: GlobalCalRecord) => (
                      <tr
                        key={r.record_id}
                        className="border-b border-gray-700 last:border-0"
                      >
                        <td className="py-1 text-gray-300">{r.qubit}</td>
                        <td className="py-1 text-right text-white">
                          {r.t1_us.toFixed(1)}
                        </td>
                        <td className="py-1 text-right text-white">
                          {r.t2_us.toFixed(1)}
                        </td>
                        <td className="py-1 text-right text-yellow-300">
                          {(r.gate_error * 1000).toFixed(2)}m
                        </td>
                        <td className="py-1 text-right text-gray-400">
                          {(r.readout_error * 100).toFixed(1)}%
                        </td>
                        <td className="py-1 pl-2 text-gray-400 truncate max-w-[80px]">
                          {r.institution ?? "—"}
                        </td>
                        <td className="py-1 text-right text-gray-500">
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
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-200 mb-3">
            Contribute Calibration
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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
                <label className="block text-xs text-gray-400 mb-1">
                  {label}
                </label>
                <input
                  type={type}
                  step="any"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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

            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">
                Institution (optional)
              </label>
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            {contributing ? "Submitting…" : "Submit Calibration"}
          </button>
          {contribError && (
            <p className="text-red-400 text-xs mt-2">{contribError}</p>
          )}
        </div>

        {/* ── Section 4: Compare ── */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="font-semibold text-gray-200 mb-3">
            Compare My Calibration
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Backend</label>
              <select
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">
                  Your T1 (µs)
                </label>
                <input
                  type="number"
                  step="any"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={compareForm.your_t1}
                  onChange={(e) =>
                    setCompareForm((f) => ({
                      ...f,
                      your_t1: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">
                  Your T2 (µs)
                </label>
                <input
                  type="number"
                  step="any"
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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
              className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {comparing ? "Comparing…" : "Compare"}
            </button>
            {compareError && (
              <p className="text-red-400 text-xs">{compareError}</p>
            )}

            {compareResult && (
              <div className="space-y-3 mt-2">
                {/* Percentile gauges */}
                <div className="flex justify-around bg-gray-900 rounded-xl p-4">
                  <PercentileGauge
                    value={compareResult.your_percentile_t1}
                    label="T1 Percentile"
                  />
                  <div className="w-px bg-gray-700" />
                  <PercentileGauge
                    value={compareResult.your_percentile_t2}
                    label="T2 Percentile"
                  />
                </div>

                {/* Assessment */}
                <p className="text-sm text-gray-300 bg-gray-900 rounded-lg p-3">
                  {compareResult.assessment}
                </p>

                {/* Community averages */}
                {Object.keys(compareResult.community_average).length > 0 && (
                  <div className="bg-gray-900 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-2">
                      Community Averages
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(compareResult.community_average).map(
                        ([k, v]) => (
                          <span
                            key={k}
                            className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded"
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
