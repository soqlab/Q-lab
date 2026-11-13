"use client";

import Link from "next/link";
import styles from "./board.module.css";
import { ago, type Board, type BoardRun, type Circuit, due, type Metric, metricOf, utc } from "./data";
import type { Point, Series } from "./TrendChart";

export const COLORS = ["#5bc0de", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#94a3b8", "#fb7185", "#facc15"];

export const CIRCUIT_IDS = ["bell", "ghz3", "ghz5", "mirror3"] as const;
export const METRIC_IDS = ["hellinger", "success"] as const;

export const shareHref = (r: BoardRun) => `/share/${encodeURIComponent(r.share_token)}`;

/** Points for one line, split wherever the benchmark set version changes. */
export function segments(runs: BoardRun[], metric: Metric["id"], arrived: Set<string>, label: (r: BoardRun) => string): Point[][] {
  const sorted = [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: Point[][] = [];
  let ver: string | null = null;
  for (const r of sorted) {
    if (r.set_version !== ver) { out.push([]); ver = r.set_version; }
    out[out.length - 1].push({
      t: Date.parse(r.created_at), v: metricOf(r, metric), href: shareHref(r), fresh: arrived.has(r.run_id),
      label: label(r),
      detail: `set ${r.set_version} · ${r.shots} shots${r.two_qubit_gates != null ? ` · ${r.two_qubit_gates} two-qubit gates` : ""}${r.simulated ? " · SIMULATED" : ""}`,
    });
  }
  return out;
}

export function seriesByBackend(runs: BoardRun[], circuit: string, metric: Metric["id"], arrived: Set<string>): Series[] {
  const names = [...new Set(runs.map((r) => r.backend))].sort();
  return names.map((name, k) => ({
    key: name, name, color: COLORS[k % COLORS.length],
    segments: segments(runs.filter((r) => r.backend === name && r.circuit === circuit), metric, arrived, (r) => r.created_at.slice(0, 10)),
  })).filter((s) => s.segments.some((g) => g.length));
}

export function seriesByCircuit(runs: BoardRun[], circuits: Circuit[], metric: Metric["id"], arrived: Set<string>): Series[] {
  return circuits.map((c, k) => ({
    key: c.id, name: c.title, color: COLORS[k % COLORS.length],
    segments: segments(runs.filter((r) => r.circuit === c.id), metric, arrived, (r) => r.created_at.slice(0, 10)),
  })).filter((s) => s.segments.some((g) => g.length));
}

export function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; title: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="inst-label">{label}</span>
      <div className={styles.seg}>
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.title}</button>
        ))}
      </div>
    </div>
  );
}

export function Unconfigured() {
  return (
    <section className="frame">
      <div className="frame-head"><h2>No IBM Quantum key on this server</h2><span className="inst-label">Not connected</span></div>
      <div className="empty-state">
        <p style={{ margin: "0 0 10px" }}>
          The hardware board reads real IBM quantum computers with the server&apos;s own IBM Quantum key, and this server
          has none yet. Until it does, the board shows nothing: no sample numbers, no placeholders.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Server operator:</strong> create a free API key at quantum.cloud.ibm.com (the open plan is enough) and set it as
          <code className="mono"> QISKIT_IBM_TOKEN</code> in the backend&apos;s environment. Status, queues and calibration appear on the
          next page load; the first benchmark is submitted within ten minutes.
        </p>
      </div>
    </section>
  );
}

export function Jobs({ b }: { b: Board }) {
  const { pending, ended, last_message } = b.benchmark;
  return (
    <section className="frame">
      <div className="frame-head"><h2>Benchmark jobs</h2><span className="inst-label">{pending.length} waiting</span></div>
      {!pending.length && !ended.length && (
        <div className="empty-state">
          {b.benchmark.enabled
            ? <>No job is waiting. The next benchmark is due <strong>{due(b.benchmark.next_due)}</strong>{b.benchmark.next_due ? ` (${utc(b.benchmark.next_due)})` : ""}.</>
            : "The benchmark is switched off on this server (QLAB_HARDWARE_BOARD_EVERY_DAYS=0)."}
        </div>
      )}
      <ul className={styles.list}>
        {pending.map((p) => (
          <li key={p.job_id}>
            <span><span className="dot warn" /> <Link href={`/hardware/${encodeURIComponent(p.backend)}`} className="mono">{p.backend}</Link></span>
            <span className="mono small">{p.status.toLowerCase()} · sent {ago(p.submitted)}</span>
            <span className={`mono ${styles.muted} small`} style={{ flexBasis: "100%" }}>job {p.job_id}</span>
          </li>
        ))}
        {ended.slice().reverse().map((p) => (
          <li key={p.job_id}>
            <span><span className="dot bad" /> <span className="mono">{p.backend}</span></span>
            <span className="mono small">{p.status} · sent {ago(p.submitted)}</span>
            {p.error && <span className={styles.err} style={{ flexBasis: "100%" }}>{p.error}</span>}
          </li>
        ))}
      </ul>
      {last_message && <p className={`${styles.small} ${styles.muted}`} style={{ margin: 0, padding: "8px 14px", borderTop: "1px solid var(--line)" }}>Last submission: {last_message}</p>}
    </section>
  );
}

export function SetCard({ b }: { b: Board }) {
  const { circuits, version, shots, every_days, metrics } = b.benchmark;
  return (
    <section className="frame">
      <div className="frame-head"><h2>The benchmark set</h2><span className="inst-label">set {version}</span></div>
      <div className={styles.circuits}>
        <p style={{ margin: 0 }} className={styles.muted}>
          The same four small circuits on every machine{every_days > 0 ? `, every ${every_days} day${every_days === 1 ? "" : "s"}` : ""}, {shots.toLocaleString("en-US")} shots each,
          transpiled at optimization level 1 with a fixed seed. Every result is kept as a Q-Lab run you can open.
        </p>
        {circuits.map((c) => (
          <div key={c.id}>
            <span><b>{c.title}</b> <code>{c.id}</code></span>
            <span className={styles.muted}>{c.description}</span>
          </div>
        ))}
        {metrics.map((m) => (
          <div key={m.id}><span><b>{m.title}</b></span><span className={styles.muted}>{m.description}</span></div>
        ))}
      </div>
    </section>
  );
}

export function Head({ title, sub, summary, simulated }: { title: string; sub?: React.ReactNode; summary: string; simulated: boolean }) {
  return (
    <header className={styles.head}>
      <span className={`inst-label ${styles.channel}`}><i aria-hidden />Hardware board</span>
      <h1 className={styles.title}>{title}{sub && <small>{sub}</small>}</h1>
      <p className="summary-line">{summary}</p>
      {simulated && (
        <div className={styles.simBanner} role="note">
          SIMULATED PREVIEW: these readings and results come from IBM&apos;s fake backends on a local simulator
          (QLAB_HARDWARE_BOARD_SIMULATE=1). They are not measurements of real hardware.
        </div>
      )}
    </header>
  );
}
