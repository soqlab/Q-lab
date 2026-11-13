"use client";

import Link from "next/link";
import styles from "./board.module.css";
import { ago, fint, fpct, fus, fx, summarize, useBoard, utc, type Metric, type QubitCal } from "./data";
import { Head, Jobs, METRIC_IDS, Seg, seriesByCircuit, shareHref, Unconfigured } from "./parts";
import TrendChart from "./TrendChart";
import { useQueryParam } from "./useQuery";

function QubitStrip({ qubits, field, label, unit, bad }: {
  qubits: QubitCal[]; field: "t1_us" | "readout_error"; label: string; unit: (v: number) => string; bad: (v: number) => boolean;
}) {
  const vals = qubits.map((q) => q[field]).filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  const max = Math.max(...vals);
  const W = Math.max(qubits.length * 6, 300), H = 84;
  const w = W / qubits.length;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="inst-label" style={{ marginBottom: 4 }}>{label}, per qubit (taller = {field === "t1_us" ? "better" : "worse"})</figcaption>
      <svg className={styles.qstrip} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${label} for ${qubits.length} qubits, highest ${unit(max)}`}>
        {qubits.map((q, k) => {
          const v = q[field];
          if (typeof v !== "number") return null;
          const h = (v / max) * (H - 2);
          return (
            <rect key={q.qubit} x={k * w + 0.5} y={H - h} width={Math.max(w - 1, 0.5)} height={h} className={bad(v) ? styles.qbarBad : styles.qbar}>
              <title>{`qubit ${q.qubit}: ${unit(v)}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

export default function BackendView({ name }: { name: string }) {
  const s = useBoard(name);
  const [metric, setMetric] = useQueryParam<Metric["id"]>("metric", "hellinger", METRIC_IDS);

  if (s.state !== "ok") {
    return (
      <main className={styles.page} aria-busy={s.state === "loading"}>
        <Head title={name} summary={s.state === "loading" ? "Reading this machine…" : s.message} simulated={false} />
        <Link href="/hardware" className="mono small">← all machines</Link>
      </main>
    );
  }
  const b = s.data;
  const m = b.live.backends[0];
  const detail = b.live.detail;
  const cal = m?.calibration;
  const runs = [...b.runs].sort((a, c) => c.created_at.localeCompare(a.created_at));
  const series = seriesByCircuit(b.runs, b.benchmark.circuits, metric, s.arrived);
  const t1med = cal?.t1_us_median ?? null;
  const roMed = cal?.readout_error_median ?? null;

  return (
    <main className={styles.page}>
      <Head title={name} sub={m ? `${m.num_qubits} qubits` : undefined} summary={summarize(b, name)} simulated={b.simulated} />
      <Link href="/hardware" className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>← all machines</Link>

      {!b.configured ? <Unconfigured /> : (
        <>
          <dl className="readouts">
            <div className="readout"><dt>State</dt><dd>{m ? (m.operational ? "online" : "offline") : "—"}<small>{m?.status_msg ?? (detail?.error || "no live reading")}</small></dd></div>
            <div className="readout"><dt>Queue</dt><dd>{fint(m?.pending_jobs)}<small>jobs waiting</small></dd></div>
            <div className="readout"><dt>T1 / T2 median</dt><dd>{fus(cal?.t1_us_median)}<small>T2 {fus(cal?.t2_us_median)}</small></dd></div>
            <div className="readout"><dt>Readout error</dt><dd>{fpct(cal?.readout_error_median)}<small>median over qubits</small></dd></div>
            <div className="readout"><dt>2-qubit error</dt><dd>{fpct(cal?.two_qubit_error_median)}<small>median over couplers</small></dd></div>
            <div className="readout"><dt>Calibrated</dt><dd>{ago(cal?.last_update)}<small>{utc(cal?.last_update)}</small></dd></div>
          </dl>

          {detail?.qubits && detail.qubits.length > 0 && (
            <section className="frame">
              <div className="frame-head"><h2>Qubits right now</h2><span className="inst-label">read {ago(b.live.fetched_at)}</span></div>
              <div className="frame-body" style={{ display: "grid", gap: 14 }}>
                <QubitStrip qubits={detail.qubits} field="t1_us" label="T1" unit={(v) => `${v.toFixed(0)} µs`} bad={(v) => t1med != null && v < t1med / 3} />
                <QubitStrip qubits={detail.qubits} field="readout_error" label="Readout error" unit={(v) => `${(v * 100).toFixed(2)}%`} bad={(v) => roMed != null && v > roMed * 3} />
                <p className={`${styles.small} ${styles.muted}`} style={{ margin: 0 }}>Red bars are qubits far from this machine&apos;s median (T1 under a third of it, or readout error over three times it). Hover a bar for its value.</p>
              </div>
            </section>
          )}

          <section className="frame">
            <div className="frame-head" style={{ flexWrap: "wrap" }}><h2>Benchmark results on {name}</h2>
              <Seg label="Measure" value={metric} onChange={setMetric} options={[{ id: "hellinger", title: "fidelity" }, { id: "success", title: "success" }]} />
            </div>
            <div className="frame-body">
              {series.length
                ? <TrendChart title={`Benchmark results on ${name}`} series={series} simulated={b.simulated} />
                : <div className="empty-state" style={{ padding: 0 }}>No benchmark has finished on {name} yet.</div>}
            </div>
            {runs.length > 0 && (
              <div className="table-wrap">
                <table className={styles.table}>
                  <thead>
                    <tr><th>When</th><th>Circuit</th><th className="r">Fidelity</th><th className="r">Success</th>
                      <th className={styles.hideNarrow}>Physical qubits</th><th className={`r ${styles.hideNarrow}`}>2-qubit gates</th>
                      <th className={`r ${styles.hideNarrow}`}>2-qubit error then</th><th>Run</th></tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.run_id} className={s.arrived.has(r.run_id) ? "arrived" : undefined}>
                        <td className="num">{utc(r.created_at)}</td>
                        <td className="mono">{r.circuit}{r.simulated ? " (sim)" : ""}</td>
                        <td className="r num">{fx(r.hellinger)}</td>
                        <td className="r num">{fx(r.success)}</td>
                        <td className={`${styles.hideNarrow} num`}>{r.qubits_used?.join(" ") ?? "—"}</td>
                        <td className={`r num ${styles.hideNarrow}`}>{fint(r.two_qubit_gates)}</td>
                        <td className={`r num ${styles.hideNarrow}`}>{fpct(r.calibration.two_qubit_error_median)}</td>
                        <td><a href={shareHref(r)} className="mono">open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Jobs b={b} />
        </>
      )}
    </main>
  );
}
