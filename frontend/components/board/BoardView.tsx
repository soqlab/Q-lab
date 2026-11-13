"use client";

import Link from "next/link";
import styles from "./board.module.css";
import { ago, due, fint, fpct, fus, fx, latestBy, summarize, useBoard, utc, type Metric } from "./data";
import { CIRCUIT_IDS, Head, Jobs, METRIC_IDS, Seg, SetCard, seriesByBackend, Unconfigured } from "./parts";
import TrendChart from "./TrendChart";
import { useQueryParam } from "./useQuery";

export default function BoardView() {
  const s = useBoard();
  const [circuit, setCircuit] = useQueryParam<string>("circuit", "bell", CIRCUIT_IDS);
  const [metric, setMetric] = useQueryParam<Metric["id"]>("metric", "hellinger", METRIC_IDS);

  if (s.state === "loading") {
    return (
      <main className={styles.page} aria-busy="true">
        <Head title="Quantum hardware" summary="Reading the board…" simulated={false} />
      </main>
    );
  }
  if (s.state === "error") {
    return (
      <main className={styles.page}>
        <Head title="Quantum hardware" summary="The board could not be loaded." simulated={false} />
        <div className="frame empty-state">{s.message} Q-Lab&apos;s backend may be starting up; reload in a moment.</div>
      </main>
    );
  }

  const b = s.data;
  const live = b.live.backends;
  const latest = latestBy(b.runs, b.benchmark.version);
  const online = live.filter((x) => x.operational);
  const shortest = online.filter((x) => x.pending_jobs != null).sort((a, c) => (a.pending_jobs ?? 0) - (c.pending_jobs ?? 0))[0];
  const lastRun = b.runs.length ? b.runs.reduce((a, c) => (a.created_at > c.created_at ? a : c)) : null;
  const circuitMeta = b.benchmark.circuits.find((c) => c.id === circuit);
  const metricMeta = b.benchmark.metrics.find((m) => m.id === metric);
  const series = seriesByBackend(b.runs, circuit, metric, s.arrived);
  // Machines with results but no live reading (no longer visible to the key) still get a row.
  const names = [...new Set([...live.map((x) => x.name), ...latest.keys()])].sort();

  return (
    <main className={styles.page}>
      <Head title="Quantum hardware" sub="IBM Quantum, read live by this server" summary={summarize(b)} simulated={b.simulated} />

      {!b.configured ? <Unconfigured /> : (
        <>
          <dl className="readouts">
            <div className="readout"><dt>Machines online</dt><dd>{live.length ? `${online.length} / ${live.length}` : "—"}<small>{b.live.fetched_at ? `read ${ago(b.live.fetched_at)}` : "no reading yet"}</small></dd></div>
            <div className="readout"><dt>Shortest queue</dt><dd>{shortest ? fint(shortest.pending_jobs) : "—"}<small>{shortest ? shortest.name : "—"}</small></dd></div>
            <div className="readout"><dt>Last benchmark</dt><dd>{lastRun ? ago(lastRun.created_at) : "—"}<small>{lastRun ? utc(lastRun.created_at) : "none finished yet"}</small></dd></div>
            <div className="readout"><dt>Next benchmark</dt><dd>{b.benchmark.enabled ? (b.benchmark.next_due ? due(b.benchmark.next_due) : "soon") : "off"}<small>{b.benchmark.enabled ? `every ${b.benchmark.every_days} days` : "live status only"}</small></dd></div>
            <div className="readout"><dt>Results kept</dt><dd>{fint(b.runs.length)}<small>Q-Lab runs, public</small></dd></div>
          </dl>

          {b.live.error && <div className="alert alert-warn" role="status">{b.live.error}</div>}

          <section className="frame">
            <div className="frame-head"><h2>Machines</h2><span className="inst-label">status · queue · calibration</span></div>
            {!names.length ? (
              <div className="empty-state">{b.live.error ? "No machine could be read." : "This server's IBM key cannot see any quantum computer right now."}</div>
            ) : (
              <div className="table-wrap">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Machine</th><th>State</th><th className="r">Queue</th><th className="r">Qubits</th>
                      <th className="r">T1 median</th><th className={`r ${styles.hideNarrow}`}>T2 median</th>
                      <th className="r">Readout error</th><th className={`r ${styles.hideNarrow}`}>2-qubit error</th>
                      <th className={styles.hideNarrow}>Calibrated</th><th className="r">{circuitMeta?.title ?? circuit} {metric === "hellinger" ? "fidelity" : "success"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {names.map((n) => {
                      const m = live.find((x) => x.name === n);
                      const last = latest.get(n)?.get(circuit);
                      const cal = m?.calibration;
                      return (
                        <tr key={n} className={last && s.arrived.has(last.run_id) ? "arrived" : undefined}>
                          <td><Link href={`/hardware/${encodeURIComponent(n)}`} className="mono">{n}</Link></td>
                          <td>{m ? <span className={styles.state}><span className={`dot ${m.operational ? "ok" : "bad"}`} />{m.status_msg || (m.operational ? "online" : "offline")}</span> : <span className={styles.muted}>not visible now</span>}</td>
                          <td className="r num">{fint(m?.pending_jobs)}</td>
                          <td className="r num">{fint(m?.num_qubits)}</td>
                          <td className="r num">{fus(cal?.t1_us_median)}</td>
                          <td className={`r num ${styles.hideNarrow}`}>{fus(cal?.t2_us_median)}</td>
                          <td className="r num">{fpct(cal?.readout_error_median)}</td>
                          <td className={`r num ${styles.hideNarrow}`}>{fpct(cal?.two_qubit_error_median)}</td>
                          <td className={`${styles.hideNarrow} num`}>{ago(cal?.last_update)}</td>
                          <td className="r num">{last ? <a href={`/share/${encodeURIComponent(last.share_token)}`}>{fx(metric === "hellinger" ? last.hellinger : last.success)}</a> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className={styles.grid2}>
            <section className="frame">
              <div className="frame-head" style={{ flexWrap: "wrap" }}>
                <h2>{circuitMeta?.title ?? circuit} over time</h2>
                <span className="inst-label">{metricMeta?.title ?? metric}</span>
              </div>
              <div className="frame-body" style={{ display: "grid", gap: 12 }}>
                <div className={styles.controls}>
                  <Seg label="Circuit" value={circuit} onChange={setCircuit}
                    options={b.benchmark.circuits.map((c) => ({ id: c.id, title: c.id }))} />
                  <Seg label="Measure" value={metric} onChange={setMetric}
                    options={[{ id: "hellinger", title: "fidelity" }, { id: "success", title: "success" }]} />
                </div>
                {series.length ? (
                  <TrendChart title={`${circuitMeta?.title ?? circuit}, ${metricMeta?.title ?? metric}, by machine`} series={series} simulated={b.simulated} />
                ) : (
                  <div className="empty-state" style={{ padding: "8px 0" }}>
                    No result for this circuit yet. {b.benchmark.pending.length
                      ? `${b.benchmark.pending.length} job${b.benchmark.pending.length === 1 ? " is" : "s are"} waiting in IBM's queue.`
                      : b.benchmark.enabled ? `The next benchmark is due ${due(b.benchmark.next_due)}.` : ""}
                  </div>
                )}
                {metricMeta && <p className={`${styles.small} ${styles.muted}`} style={{ margin: 0 }}>{metricMeta.description} Each point opens the run it came from.</p>}
              </div>
            </section>
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <Jobs b={b} />
              <SetCard b={b} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
