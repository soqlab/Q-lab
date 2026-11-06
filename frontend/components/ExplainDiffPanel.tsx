import type { ReactNode } from "react";
import type { DiffVerdict, ExplainDiffResult, FidelityEstimate, ValueChange } from "../lib/api";

const VERDICT: Record<DiffVerdict, { label: string; chip: string }> = {
  explains: { label: "Explains it", chip: "chip chip-ok" },
  plausible: { label: "Plausible cause", chip: "chip chip-warn" },
  too_small: { label: "Too small to explain it", chip: "chip" },
  ruled_out: { label: "Ruled out", chip: "chip" },
  cant_tell: { label: "Can't tell", chip: "chip chip-danger" },
};

const FACTOR_NAME = { noise: "Statistical noise", compiler: "Compiler / transpilation", calibration: "Calibration drift" };

const mono = { fontFamily: "monospace", fontSize: 12 } as const;
const muted = { color: "var(--muted)", fontSize: 12 } as const;

function num(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return "not recorded";
  if (v !== 0 && Math.abs(v) < 10 ** -digits) return v.toExponential(2);
  return v.toFixed(digits).replace(/\.?0+$/, "") || "0";
}

function signed(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return "n/a";
  return `${v > 0 ? "+" : ""}${num(v, digits)}`;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "not recorded";
  if (typeof v === "string") return v.length > 24 && /^[0-9a-f]+$/.test(v) ? `${v.slice(0, 12)}…` : v;
  return JSON.stringify(v);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {note ? <div style={{ ...muted, marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}

function Panel({ title, verdict, children }: { title: string; verdict?: DiffVerdict; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {verdict ? <span className={VERDICT[verdict].chip} style={{ marginLeft: "auto" }}>{VERDICT[verdict].label}</span> : null}
      </div>
      <div style={{ padding: "14px 18px", display: "grid", gap: 12 }}>{children}</div>
    </section>
  );
}

function ChangeCells({ c, digits = 4 }: { c: ValueChange; digits?: number }) {
  const changed = c.a !== c.b;
  return (
    <td style={{ ...mono, color: changed ? "var(--warn)" : undefined }}>
      {num(c.a, digits)} → {num(c.b, digits)}
      {c.relative !== null && c.delta ? <span style={muted}> ({c.relative > 0 ? "+" : ""}{(c.relative * 100).toFixed(1)}%)</span> : null}
    </td>
  );
}

function Fidelity({ label, f }: { label: string; f: FidelityEstimate }) {
  const value = f.value !== null ? num(f.value) : f.upper_bound !== null ? `≤ ${num(f.upper_bound)}` : "can't tell";
  const note = f.value !== null
    ? `${f.covered_operations} operations, all with recorded errors`
    : `${f.covered_operations} of ${f.total_operations} operations have recorded errors; missing: ${f.missing.slice(0, 4).join(", ")}${f.missing_count > 4 ? "…" : ""}`;
  return <Stat label={label} value={value} note={note} />;
}

export default function ExplainDiffPanel({ result }: { result: ExplainDiffResult }) {
  const { noise, compiler, calibration, attribution } = result;
  const verdictOf = (factor: string) => attribution.factors.find((f) => f.factor === factor);
  const fid = calibration.fidelity;
  const gates = [...calibration.gates].sort((x, y) => y.qubits - x.qubits || x.gate.localeCompare(y.gate));

  return (
    <>
      <Panel title="Why do these runs differ?">
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{attribution.summary}</p>
        <div style={{ display: "grid", gap: 8 }}>
          {attribution.factors.map((f) => (
            <div key={f.factor} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 210px) 1fr", gap: 10, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <strong style={{ fontSize: 13 }}>{FACTOR_NAME[f.factor]}</strong>
                <span className={VERDICT[f.verdict].chip} style={{ justifySelf: "start" }}>{VERDICT[f.verdict].label}</span>
              </div>
              <div style={{ fontSize: 13 }}>{f.text}</div>
            </div>
          ))}
        </div>
        {attribution.other_differences.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--warn)" }}>
            {attribution.other_differences.map((d) => <li key={d}>{d}</li>)}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Observed difference and shot noise" verdict={verdictOf("noise")?.verdict}>
        {noise ? (
          <>
            <section className="summary-grid">
              <Stat label="Total variation distance" value={num(noise.observed_tvd)}
                note={`95% interval ${num(noise.observed_tvd_interval_95[0])} – ${num(noise.observed_tvd_interval_95[1])}`} />
              <Stat label="Hellinger distance" value={num(noise.observed_hellinger)} />
              <Stat label="Expected TVD from shot noise" value={num(noise.expected_tvd_from_shot_noise)}
                note={`95% of noise-only samples ≤ ${num(noise.shot_noise_tvd_95th_percentile)}`} />
              <Stat label="p-value (same distribution)" value={num(noise.p_value)}
                note={noise.significant ? `below ${noise.alpha}: more than shot noise` : `not below ${noise.alpha}: consistent with shot noise`} />
            </section>
            <div style={muted}>
              Shots: A {noise.shots.a}, B {noise.shots.b} (sum of counts; recorded {show(noise.recorded_shots.a)} / {show(noise.recorded_shots.b)}).{" "}
              {noise.outcomes} distinct outcomes. {String(noise.method.test)}, {String(noise.method.resamples)} resamples, seed {String(noise.method.seed)}.
            </div>
          </>
        ) : (
          <div className="empty">One or both runs have no measured counts, so the difference can&apos;t be measured.</div>
        )}
      </Panel>

      <Panel title="Compiler / transpilation" verdict={verdictOf("compiler")?.verdict}>
        <div style={{ fontSize: 13 }}>
          {compiler.circuit_changed === null
            ? "No hash of the executed circuit for both runs."
            : compiler.circuit_changed
              ? "The circuit that ran on the device changed."
              : "The same circuit ran on the device both times."}
          {compiler.same_logical_circuit === false ? " The circuits given to transpile() also differ." : null}
          <span style={muted}> Circuit read from: A {show(compiler.circuit_source.a)}, B {show(compiler.circuit_source.b)}.</span>
        </div>
        {compiler.changes.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>What changed</th><th>Run A</th><th>Run B</th><th>Source</th></tr></thead>
              <tbody>
                {compiler.changes.map((c) => (
                  <tr key={c.field}>
                    <td>{c.label}</td>
                    <td style={mono}>{show(c.a)}</td>
                    <td style={mono}>{show(c.b)}</td>
                    <td style={muted}>{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {compiler.not_recorded.length ? (
          <div style={muted}>Not recorded for either run: {compiler.not_recorded.join(", ")}.</div>
        ) : null}
      </Panel>

      <Panel title="Calibration drift" verdict={verdictOf("calibration")?.verdict}>
        <div style={muted}>
          Snapshots: A {show(calibration.snapshots.a.snapshot_time)} ({show(calibration.snapshots.a.source)}), B{" "}
          {show(calibration.snapshots.b.snapshot_time)} ({show(calibration.snapshots.b.source)}).
          {calibration.restricted_to_used ? " Only qubits and gates the circuits used are shown." : null}
        </div>
        {[...new Set([calibration.snapshots.a.note, calibration.snapshots.b.note].filter(Boolean))].map((n) => (
          <div key={n} style={{ ...muted, color: "var(--warn)" }}>{n}</div>
        ))}
        {fid ? (
          <section className="summary-grid">
            <Fidelity label="Estimated fidelity, run A" f={fid.a} />
            <Fidelity label="Estimated fidelity, run B" f={fid.b} />
            <Stat label="From calibration" value={signed(fid.calibration_effect)} note="run A's circuit, B's vs A's calibration" />
            <Stat label="From the compiler" value={signed(fid.compiler_effect)} note="B's calibration, B's vs A's circuit" />
          </section>
        ) : null}
        {calibration.qubits.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Qubit</th><th>Used by</th><th>T1 (µs)</th><th>T2 (µs)</th><th>Readout error</th></tr></thead>
              <tbody>
                {calibration.qubits.map((q) => (
                  <tr key={q.qubit}>
                    <td style={mono}>{q.qubit}</td>
                    <td style={muted}>{q.used_by.join(", ").toUpperCase()}</td>
                    <ChangeCells c={q.t1_us} digits={1} />
                    <ChangeCells c={q.t2_us} digits={1} />
                    <ChangeCells c={q.readout_errors} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {gates.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Gate</th><th>Used by</th><th>Error (A → B)</th></tr></thead>
              <tbody>
                {gates.map((g) => (
                  <tr key={g.gate}>
                    <td style={{ ...mono, fontWeight: g.qubits === 2 ? 700 : undefined }}>{g.gate}</td>
                    <td style={muted}>{g.used_by.join(", ").toUpperCase()}</td>
                    <ChangeCells c={g} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <div style={{ ...muted, padding: "0 4px" }}>
        Sources: every figure above comes from these fields of the two run records —{" "}
        {Object.entries(result.sources).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ")}.
      </div>
    </>
  );
}
