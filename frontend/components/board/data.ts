"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The hardware board's data, from the backend's public API (backend/app/hardware_board.py).
// Everything shown on the board comes from here: no value is ever filled in by the page.

export type Calibration = {
  last_update: string | null;
  t1_us_median: number | null;
  t2_us_median: number | null;
  readout_error_median: number | null;
  two_qubit_error_median: number | null;
};

export type LiveBackend = {
  name: string;
  num_qubits: number;
  operational: boolean;
  status_msg: string | null;
  pending_jobs: number | null;
  calibration: Calibration | null;
};

export type QubitCal = { qubit: number; t1_us: number | null; t2_us: number | null; readout_error: number | null };

export type Circuit = { id: string; title: string; qubits: number; description: string; ideal: Record<string, number> };
export type Metric = { id: "hellinger" | "success"; title: string; description: string };

export type BoardRun = {
  run_id: string;
  share_token: string;
  backend: string;
  circuit: string;
  set_version: string;
  created_at: string;
  completed_at: string | null;
  job_id: string;
  hellinger: number;
  success: number;
  shots: number;
  qubits_used: number[] | null;
  two_qubit_gates: number | null;
  transpiled_depth: number | null;
  calibration: Partial<Calibration>;
  simulated: boolean;
};

export type JobRef = { backend: string; job_id: string; submitted: string; status: string; error?: string | null };

export type Board = {
  configured: boolean;
  simulated: boolean;
  live: {
    fetched_at: string | null;
    error: string | null;
    backends: LiveBackend[];
    simulated?: boolean;
    detail?: (LiveBackend & { qubits?: QubitCal[] | null; error?: string }) | null;
  };
  benchmark: {
    enabled: boolean;
    version: string;
    shots: number;
    every_days: number;
    circuits: Circuit[];
    metrics: Metric[];
    next_due: string | null;
    last_submitted: string | null;
    last_message: string | null;
    pending: JobRef[];
    ended: JobRef[];
  };
  runs: BoardRun[];
};

export const isBoard = (d: unknown): d is Board =>
  !!d && typeof d === "object" && typeof (d as Board).configured === "boolean" && Array.isArray((d as Board).runs);

const BASE = "/qlab-api/api/v1/public/hardware-board";
const POLL_MS = 120_000;

export type BoardState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: Board; arrived: Set<string> };

/**
 * The board, refreshed every two minutes while the page is open. `arrived` holds the run ids that
 * were not there on the previous read, so the page can mark them once: motion only on real events.
 */
export function useBoard(backend?: string): BoardState {
  const [s, setS] = useState<BoardState>({ state: "loading" });
  const seen = useRef<Set<string> | null>(null);
  const url = backend ? `${BASE}/${encodeURIComponent(backend)}` : BASE;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch(url, { cache: "no-store", signal, headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(r.status === 404 ? "No such machine name." : `The server answered ${r.status}.`);
      const d: unknown = await r.json();
      if (!isBoard(d)) throw new Error("The server's answer was not a hardware board.");
      const ids = new Set(d.runs.map((x) => x.run_id));
      const arrived = new Set<string>();
      if (seen.current) for (const id of ids) if (!seen.current.has(id)) arrived.add(id);
      seen.current = ids;
      setS({ state: "ok", data: d, arrived });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setS((prev) => (prev.state === "ok" ? prev : { state: "error", message: (e as Error).message || "The board could not be loaded." }));
    }
  }, [url]);

  useEffect(() => {
    seen.current = null;
    const ctl = new AbortController();
    void load(ctl.signal);
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => { ctl.abort(); window.clearInterval(id); };
  }, [load]);

  return s;
}

// ---------------------------------------------------------------------------
// Formatting: "—" whenever there is no real value.
// ---------------------------------------------------------------------------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const fx = (v: number | null | undefined, digits = 3) => (finite(v) ? v.toFixed(digits) : "—");
export const fus = (v: number | null | undefined) => (finite(v) ? `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} µs` : "—");
export const fpct = (v: number | null | undefined, digits = 2) => (finite(v) ? `${(v * 100).toFixed(digits)}%` : "—");
export const fint = (v: number | null | undefined) => (finite(v) ? v.toLocaleString("en-US") : "—");

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.round((now - t) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const txt = a < 90 ? `${a} s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 129600 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
  return future ? `in ${txt}` : `${txt} ago`;
}

/** When a due time is in the past the server submits it on its next check (it may be asleep). */
export function due(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "when the server next checks";
  const t = Date.parse(iso);
  return Number.isNaN(t) || t <= now ? "now, on the server's next check" : ago(iso, now);
}

export const utc = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");

export const metricOf = (r: BoardRun, m: Metric["id"]) => (m === "hellinger" ? r.hellinger : r.success);

/** The latest benchmark result per backend and circuit (current set version only). */
export function latestBy(runs: BoardRun[], version: string): Map<string, Map<string, BoardRun>> {
  const out = new Map<string, Map<string, BoardRun>>();
  for (const r of runs) {
    if (r.set_version !== version) continue;
    const m = out.get(r.backend) ?? new Map<string, BoardRun>();
    const prev = m.get(r.circuit);
    if (!prev || prev.created_at < r.created_at) m.set(r.circuit, r);
    out.set(r.backend, m);
  }
  return out;
}

/** One plain sentence about what the board shows right now. */
export function summarize(b: Board, backend?: string): string {
  if (!b.configured) return "This Q-Lab server has no IBM Quantum key, so it cannot read any quantum computer yet.";
  const live = b.live.backends;
  const parts: string[] = [];
  if (backend) {
    const m = live[0];
    if (m) {
      parts.push(`${m.name} is ${m.operational ? "online" : "not taking jobs"}${finite(m.pending_jobs) ? ` with ${m.pending_jobs} job${m.pending_jobs === 1 ? "" : "s"} in its queue` : ""}.`);
    } else if (b.live.error) {
      parts.push(`${backend}'s live status could not be read right now.`);
    } else {
      parts.push(`${backend} is not among the machines this server's IBM key can see.`);
    }
  } else if (live.length) {
    const online = live.filter((x) => x.operational);
    const queued = online.filter((x) => finite(x.pending_jobs)).sort((a, c) => (a.pending_jobs ?? 0) - (c.pending_jobs ?? 0));
    parts.push(`${online.length} of ${live.length} IBM machine${live.length === 1 ? "" : "s"} ${online.length === 1 ? "is" : "are"} online`
      + (queued.length > 1 ? `; ${queued[0].name} has the shortest queue (${queued[0].pending_jobs} job${queued[0].pending_jobs === 1 ? "" : "s"}).` : "."));
  } else if (b.live.error) {
    parts.push("IBM Quantum could not be reached just now.");
  }
  const runs = b.runs.filter((r) => r.set_version === b.benchmark.version);
  if (runs.length) {
    const last = runs.reduce((a, c) => (a.created_at > c.created_at ? a : c));
    const bell = runs.filter((r) => r.circuit === "bell" && r.created_at.slice(0, 10) === last.created_at.slice(0, 10))
      .sort((a, c) => c.hellinger - a.hellinger)[0];
    const pick = bell ?? last;
    const title = b.benchmark.circuits.find((c) => c.id === pick.circuit)?.title ?? pick.circuit;
    parts.push(`Last benchmark ${ago(last.created_at)}: ${title} fidelity ${pick.hellinger.toFixed(2)} on ${pick.backend}${bell && !backend ? " (best of the day)" : ""}.`);
  } else if (b.benchmark.pending.length) {
    parts.push(`The first benchmark is waiting in IBM's queue on ${b.benchmark.pending.map((p) => p.backend).join(", ")}.`);
  } else if (b.benchmark.enabled) {
    parts.push(`No benchmark has finished yet; the first one is due ${due(b.benchmark.next_due)}.`);
  } else {
    parts.push("The benchmark is switched off on this server; only live status is shown.");
  }
  if (b.simulated) parts.push("These are SIMULATED results from a local preview, not real hardware.");
  return parts.join(" ");
}
