"use client";

import { useEffect, useMemo, useState } from "react";
import { GitCompare, Search } from "lucide-react";
import { compareRuns, CompareResult, fetchRuns, fetchRunMetricsData, QLabRun, MetricPoint, RunMetricsResponse } from "../../../lib/api";

// ------------------------------------------------------------------
// Field diff table
// ------------------------------------------------------------------
function DiffTable({
  title,
  diff,
}: {
  title: string;
  diff: Record<string, { left: unknown; right: unknown }>;
}) {
  const entries = Object.entries(diff);
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      {!entries.length ? (
        <div className="empty">No differences.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Left</th>
                <th>Right</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([field, values]) => (
                <tr key={field}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{field}</td>
                  <td style={{ color: "var(--danger-text)", fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(values.left)}</td>
                  <td style={{ color: "var(--ok-text)", fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(values.right)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------
// Dual-series SVG line chart — overlay two metric series
// ------------------------------------------------------------------
function MetricsOverlayChart({
  leftPoints,
  rightPoints,
  leftLabel,
  rightLabel,
}: {
  leftPoints: MetricPoint[];
  rightPoints: MetricPoint[];
  leftLabel: string;
  rightLabel: string;
}) {
  const W = 560, H = 220;
  const PAD = { top: 16, right: 20, bottom: 40, left: 64 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const hasStepsL = leftPoints.some(p => p.step !== null && p.step !== undefined);
  const hasStepsR = rightPoints.some(p => p.step !== null && p.step !== undefined);

  const lPts = leftPoints.map((p, i) => ({ x: hasStepsL ? (p.step ?? i) : i, y: p.value }));
  const rPts = rightPoints.map((p, i) => ({ x: hasStepsR ? (p.step ?? i) : i, y: p.value }));

  const allX = [...lPts.map(p => p.x), ...rPts.map(p => p.x)];
  const allY = [...lPts.map(p => p.y), ...rPts.map(p => p.y)];
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);

  function sx(x: number) {
    if (maxX === minX) return PAD.left + plotW / 2;
    return PAD.left + ((x - minX) / (maxX - minX)) * plotW;
  }
  function sy(y: number) {
    if (maxY === minY) return PAD.top + plotH / 2;
    return PAD.top + ((maxY - y) / (maxY - minY)) * plotH;
  }

  function makePath(pts: { x: number; y: number }[]) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  }

  const LEFT_COLOR = "var(--strong)";
  const RIGHT_COLOR = "var(--warn)";

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PAD.top + t * plotH,
    label: (minY + (1 - t) * (maxY - minY)).toFixed(4),
  }));

  return (
    <div>
      <svg width={W} height={H} style={{ display: "block", maxWidth: "100%", overflowX: "auto" }}>
        {/* Grid */}
        {gridYs.map(g => (
          <g key={g.label}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={g.y} y2={g.y}
              stroke="var(--line)" strokeWidth={0.5} />
            <text x={PAD.left - 6} y={g.y + 4} textAnchor="end" fontSize={10} fill="var(--muted)" style={{ fontFamily: "monospace" }}>
              {g.label}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH}
          stroke="var(--line)" strokeWidth={1} />
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH}
          stroke="var(--line)" strokeWidth={1} />

        {/* Left series area + line */}
        {lPts.length > 0 && (
          <>
            <path
              d={`${makePath(lPts)} L ${sx(lPts[lPts.length - 1].x)} ${PAD.top + plotH} L ${sx(lPts[0].x)} ${PAD.top + plotH} Z`}
              fill={LEFT_COLOR} opacity={0.08}
            />
            {lPts.length > 1 && (
              <path d={makePath(lPts)} fill="none" stroke={LEFT_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            <circle cx={sx(lPts[lPts.length - 1].x)} cy={sy(lPts[lPts.length - 1].y)} r={4} fill={LEFT_COLOR} />
          </>
        )}

        {/* Right series area + line */}
        {rPts.length > 0 && (
          <>
            <path
              d={`${makePath(rPts)} L ${sx(rPts[rPts.length - 1].x)} ${PAD.top + plotH} L ${sx(rPts[0].x)} ${PAD.top + plotH} Z`}
              fill={RIGHT_COLOR} opacity={0.08}
            />
            {rPts.length > 1 && (
              <path d={makePath(rPts)} fill="none" stroke={RIGHT_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 2" />
            )}
            <circle cx={sx(rPts[rPts.length - 1].x)} cy={sy(rPts[rPts.length - 1].y)} r={4} fill={RIGHT_COLOR} />
          </>
        )}

        {/* Step axis label */}
        <text x={PAD.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">
          {(hasStepsL || hasStepsR) ? "step" : "point index"}
        </text>
      </svg>

      {/* Legend + summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {[
          { label: leftLabel, pts: leftPoints, color: LEFT_COLOR, dash: false },
          { label: rightLabel, pts: rightPoints, color: RIGHT_COLOR, dash: true },
        ].map(({ label, pts, color, dash }) => {
          if (!pts.length) return null;
          const first = pts[0].value, last = pts[pts.length - 1].value;
          const delta = last - first;
          return (
            <div key={label} style={{ background: "var(--panel-2)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <svg width={24} height={3}>
                  <line x1={0} y1={1.5} x2={24} y2={1.5} stroke={color} strokeWidth={2}
                    strokeDasharray={dash ? "4 2" : undefined} />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", fontFamily: "monospace" }}>{label}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                {last.toFixed(6).replace(/\.?0+$/, "")}
              </div>
              <div style={{ fontSize: 11, color: delta < 0 ? "var(--ok)" : "var(--danger)", fontWeight: 600, marginTop: 2 }}>
                {delta > 0 ? "+" : ""}{delta.toFixed(4)} over {pts.length} pts
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Metrics overlay panel
// ------------------------------------------------------------------
function MetricsComparePanel({
  leftRunId,
  rightRunId,
  leftLabel,
  rightLabel,
}: {
  leftRunId: string;
  rightRunId: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const [leftData, setLeftData] = useState<RunMetricsResponse | null>(null);
  const [rightData, setRightData] = useState<RunMetricsResponse | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRunMetricsData(leftRunId).catch(() => null),
      fetchRunMetricsData(rightRunId).catch(() => null),
    ]).then(([l, r]) => {
      setLeftData(l);
      setRightData(r);
      // Auto-select first common metric
      const lNames = l ? Object.keys(l.metrics) : [];
      const rNames = r ? Object.keys(r.metrics) : [];
      const common = lNames.filter(n => rNames.includes(n));
      const allNames = [...new Set([...lNames, ...rNames])].sort();
      setSelectedMetric(common[0] ?? allNames[0] ?? "");
      setLoading(false);
    });
  }, [leftRunId, rightRunId]);

  if (loading) return null;

  const lNames = leftData ? Object.keys(leftData.metrics) : [];
  const rNames = rightData ? Object.keys(rightData.metrics) : [];
  const allNames = [...new Set([...lNames, ...rNames])].sort();

  if (!allNames.length) return null;

  const leftPoints = selectedMetric && leftData?.metrics[selectedMetric] ? leftData.metrics[selectedMetric] : [];
  const rightPoints = selectedMetric && rightData?.metrics[selectedMetric] ? rightData.metrics[selectedMetric] : [];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Metrics Overlay</h2>
        <select
          className="input"
          value={selectedMetric}
          onChange={e => setSelectedMetric(e.target.value)}
          style={{ height: 30, fontSize: 12, padding: "0 8px", marginLeft: "auto", minWidth: 160 }}
          aria-label="Select metric"
        >
          {allNames.map(name => (
            <option key={name} value={name}>
              {name}
              {lNames.includes(name) && !rNames.includes(name) ? " (left only)" : ""}
              {rNames.includes(name) && !lNames.includes(name) ? " (right only)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div style={{ padding: "16px 18px" }}>
        {leftPoints.length + rightPoints.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Neither run has logged this metric.</div>
        ) : (
          <MetricsOverlayChart
            leftPoints={leftPoints}
            rightPoints={rightPoints}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
          />
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Main compare page
// ------------------------------------------------------------------
export default function ComparePage() {
  const [runs, setRuns] = useState<QLabRun[]>([]);
  const [leftRunId, setLeftRunId] = useState("");
  const [rightRunId, setRightRunId] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compared, setCompared] = useState<{ left: string; right: string } | null>(null);

  useEffect(() => {
    async function loadRuns() {
      const loaded = await fetchRuns();
      setRuns(loaded);
      setLeftRunId(loaded[0]?.run_id || "");
      setRightRunId(loaded[1]?.run_id || loaded[0]?.run_id || "");
    }
    void loadRuns();
  }, []);

  async function runCompare() {
    if (!leftRunId || !rightRunId) return;
    setError(null);
    try {
      setResult(await compareRuns(leftRunId, rightRunId));
      setCompared({ left: leftRunId, right: rightRunId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    }
  }

  const runOptions = useMemo(
    () =>
      runs.map((run) => ({
        value: run.run_id,
        label: `${run.circuit_name || run.run_id.slice(0, 8)} (${run.project || "no project"})`,
      })),
    [runs],
  );

  const leftLabel = useMemo(() => runOptions.find(r => r.value === leftRunId)?.label ?? leftRunId.slice(0, 10), [runOptions, leftRunId]);
  const rightLabel = useMemo(() => runOptions.find(r => r.value === rightRunId)?.label ?? rightRunId.slice(0, 10), [runOptions, rightRunId]);

  return (
    <main className="page">
      <div className="toolbar">
        <select
          className="input"
          value={leftRunId}
          onChange={(event) => setLeftRunId(event.target.value)}
          aria-label="Left run"
        >
          {runOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={rightRunId}
          onChange={(event) => setRightRunId(event.target.value)}
          aria-label="Right run"
        >
          {runOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="button" type="button" onClick={() => void runCompare()}>
          <GitCompare size={17} aria-hidden="true" />
          Compare
        </button>
      </div>

      {!runs.length ? (
        <section className="panel">
          <div className="empty">No runs available to compare.</div>
        </section>
      ) : null}

      {error ? <div className="empty" style={{ color: "var(--danger)" }}>{error}</div> : null}

      {result && compared ? (
        <>
          {/* Summary cards */}
          <section className="summary-grid">
            {Object.entries(result.summary).map(([field, same]) => (
              <div className="metric" key={field} style={{ borderColor: same ? "var(--ok)" : "var(--warn)" }}>
                <div className="metric-label">{field.replaceAll("_", " ")}</div>
                <div className="metric-value" style={{ color: same ? "var(--ok)" : "var(--warn)", fontSize: 14 }}>
                  {same ? "Same" : "Diff"}
                </div>
              </div>
            ))}
          </section>

          {/* Metrics overlay — most technically powerful section */}
          <MetricsComparePanel
            leftRunId={compared.left}
            rightRunId={compared.right}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
          />

          <DiffTable title="Fingerprint Diff" diff={result.fingerprint_diff} />
          <DiffTable title="Parameter Diff" diff={result.parameter_diff} />
          <DiffTable title="Context Diff" diff={result.context_diff} />
          <DiffTable title="Timing Diff" diff={result.timing_diff} />
          <DiffTable title="Calibration Diff" diff={result.calibration_diff} />
          <DiffTable title="Result Diff" diff={result.result_diff} />

          <section className="panel">
            <div className="panel-header">
              <h2>QASM Diff</h2>
              <Search size={18} color="var(--muted)" aria-hidden="true" />
            </div>
            <pre className="code">{result.qasm_diff || "No QASM differences."}</pre>
          </section>
        </>
      ) : null}
    </main>
  );
}
