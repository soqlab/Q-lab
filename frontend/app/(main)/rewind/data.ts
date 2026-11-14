/*
 * Rewind's API shapes (backend/app/routers/rewind.py) and the small pure helpers the screen uses.
 */

export type Medians = {
  date?: string; calibrated_at: string;
  t1_us_median: number | null; t2_us_median: number | null;
  two_qubit_error_median: number | null; readout_error_median: number | null;
};
export type Machine = {
  provider: string; machine: string; snapshots: number; first_date: string; last_date: string;
  first_calibrated_at: string; last_calibrated_at: string; latest: (Medians & { available?: boolean }) | null;
};
export type Machines = {
  collecting: boolean; simulated: boolean; reason: string | null; every_hours: number;
  machines: Machine[]; note: string;
};
export type Day = { date: string; calibrated_at: string };
export type Days = { machine: string; days: Day[]; monthly: string[] };
export type Ideal = {
  available: boolean; reason: string | null; hellinger_fidelity: number | null;
  share_on_ideal_outcomes: number | null; top: [string, number][]; outcomes: number | null;
};
export type Replay = {
  label: string; machine: string; requested_date: string;
  snapshot: { calibrated_at: string; sha256: string; source: string; gap_days: number; note: string; manifest_date: string };
  counts: Record<string, number>; shots: number; seeds: { simulator: number; transpiler: number };
  circuit: { num_qubits: number; operations: number; two_qubit_gates: number; depth: number; measured: number };
  transpiled: { physical_qubits: number[]; depth: number; operations: number; two_qubit_gates: number; optimization_level: number };
  noise_model: {
    channels: Record<string, number>; model: string; not_modelled: string[]; method: string;
    readout_error_median: number | null; basis_gates: string[] | null;
  };
  software: Record<string, string>; seconds: number;
  accuracy: unknown; accuracy_note: string | null; real_hardware: boolean; notes: string[];
  ideal?: Ideal;
  limits?: { qubits: number; shots: number };
};
export type CompareRow = {
  date: string; status: "pending" | "running" | "ok" | "error"; error?: string;
  snapshot?: { calibrated_at: string; sha256: string; gap_days: number };
  hellinger_fidelity?: number | null; share_on_ideal_outcomes?: number | null; top?: [string, number][];
};
export type CompareJob = {
  job: string; machine: string; status: "running" | "done" | "failed"; shots: number; error?: string;
  ideal: { available: boolean | null; reason: string | null; top: [string, number][] };
  results: CompareRow[]; accuracy: unknown; accuracy_note: string | null; label: string;
};
export type WatchMachine = { machine: string; snapshots: number; first_date: string; last_date: string; latest: Medians | null; series: Medians[] };
export type Watch = { collecting: boolean; simulated: boolean; reason: string | null; days: number; machines: WatchMachine[]; note: string };

export const EXAMPLES = [
  {
    id: "bell", name: "Bell", qasm: 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;\n',
  },
  {
    id: "ghz5", name: "GHZ-5",
    qasm: 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[5];\ncreg c[5];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\ncx q[2],q[3];\ncx q[3],q[4];\nmeasure q -> c;\n',
  },
  {
    id: "qft3", name: "QFT-3 round trip",
    qasm: 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\n// prepare 101, then QFT and its inverse: ideally 101 every time\nx q[0];\nx q[2];\n'
      + 'h q[2];\ncu1(pi/2) q[1],q[2];\ncu1(pi/4) q[0],q[2];\nh q[1];\ncu1(pi/2) q[0],q[1];\nh q[0];\nswap q[0],q[2];\n'
      + 'swap q[0],q[2];\nh q[0];\ncu1(-pi/2) q[0],q[1];\nh q[1];\ncu1(-pi/4) q[0],q[2];\ncu1(-pi/2) q[1],q[2];\nh q[2];\nmeasure q -> c;\n',
  },
] as const;

export const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const stamp = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";
export const pct = (x: number) => `${(x * 100).toFixed(x >= 0.995 || x < 0.1 ? 1 : 0)}%`;
export const fid = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));

/** Index of the stored day nearest to `want` (YYYY-MM-DD). */
export function nearestDay(days: Day[], want: string | null): number {
  if (!days.length) return -1;
  if (!want) return days.length - 1;
  const t = Date.parse(`${want}T12:00:00Z`);
  if (Number.isNaN(t)) return days.length - 1;
  let best = 0;
  for (let i = 1; i < days.length; i++) {
    if (Math.abs(Date.parse(`${days[i].date}T12:00:00Z`) - t) < Math.abs(Date.parse(`${days[best].date}T12:00:00Z`) - t)) best = i;
  }
  return best;
}

/** The answer, first: what the circuit gave, on which machine, as of when. */
export function sentence(r: Replay, name: string, plain: boolean): string {
  const when = day(r.snapshot.calibrated_at);
  const head = `On ${r.machine} as of ${when}, ${name}`;
  const entries = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
  const id = r.ideal;
  let s: string;
  if (id?.available && id.share_on_ideal_outcomes != null && id.outcomes != null && id.outcomes <= 4) {
    const outs = id.top.filter(([, p]) => p >= 1e-3).map(([k]) => k).join("/");
    s = `${head} gave ${outs} in ${pct(id.share_on_ideal_outcomes)} of shots; without noise it would be every shot.`;
  } else if (id?.available && id.hellinger_fidelity != null) {
    s = `${head} matched its noiseless distribution with a Hellinger fidelity of ${id.hellinger_fidelity.toFixed(3)}; the most common outcome was ${entries[0][0]} (${pct(entries[0][1] / r.shots)} of shots).`;
  } else {
    s = `${head} gave ${entries[0][0]} most often, in ${pct(entries[0][1] / r.shots)} of shots.`;
  }
  if (plain) return `${s} Simulated from that day's calibration; not run on hardware.`;
  const f = id?.available && id.hellinger_fidelity != null && (id.outcomes ?? 99) <= 4 ? ` Hellinger fidelity to the ideal: ${id.hellinger_fidelity.toFixed(3)}.` : "";
  return `${s}${f} Simulated from that day's calibration, not run on hardware.`;
}

export type MetricKey = "t1_us_median" | "t2_us_median" | "two_qubit_error_median" | "readout_error_median";
export const METRICS: { key: MetricKey; label: string; short: string; better: "low" | "high"; fmt: (v: number) => string }[] = [
  { key: "two_qubit_error_median", label: "two-qubit error", short: "2-qubit error", better: "low", fmt: (v) => `${(v * 100).toFixed(2)}%` },
  { key: "readout_error_median", label: "readout error", short: "Readout error", better: "low", fmt: (v) => `${(v * 100).toFixed(2)}%` },
  { key: "t1_us_median", label: "T1", short: "T1", better: "high", fmt: (v) => `${v.toFixed(0)} µs` },
  { key: "t2_us_median", label: "T2", short: "T2", better: "high", fmt: (v) => `${v.toFixed(0)} µs` },
];

/** How today's value sits in the window: the sentence QPU Watch leads with. */
export function verdict(m: WatchMachine, key: MetricKey, windowDays: number): { text: string; rank: "best" | "worst" | "mid" | "none" } {
  const meta = METRICS.find((x) => x.key === key)!;
  const vals = m.series.map((p) => p[key]).filter((v): v is number => typeof v === "number");
  const last = m.latest?.[key];
  if (last == null || vals.length < 2) return { text: `${m.machine}'s ${meta.label} has too little history here for a trend.`, rank: "none" };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.min(windowDays, Math.round((Date.parse(m.series[m.series.length - 1].calibrated_at) - Date.parse(m.series[0].calibrated_at)) / 86400000) + 1);
  const good = meta.better === "low" ? last <= lo : last >= hi;
  const bad = meta.better === "low" ? last >= hi : last <= lo;
  if (good) return { text: `${m.machine}'s ${meta.label} is the ${meta.better === "low" ? "lowest" : "highest"} it's been in ${span} days (${meta.fmt(last)}).`, rank: "best" };
  if (bad) return { text: `${m.machine}'s ${meta.label} is the ${meta.better === "low" ? "highest" : "lowest"} it's been in ${span} days (${meta.fmt(last)}).`, rank: "worst" };
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const rel = (last - med) / med;
  const better = meta.better === "low" ? rel < 0 : rel > 0;
  if (Math.abs(rel) < 0.03) return { text: `${m.machine}'s ${meta.label} is at its ${span}-day median (${meta.fmt(last)}).`, rank: "mid" };
  return { text: `${m.machine}'s ${meta.label} is ${Math.abs(rel * 100).toFixed(0)}% ${better ? "better" : "worse"} than its ${span}-day median (${meta.fmt(last)}).`, rank: "mid" };
}

export function apiError(status: number, detail: unknown): string {
  if (status === 429) return "That's a lot of replays in a short time. Wait a minute, then try again.";
  if (status === 503) return typeof detail === "string" ? detail : "Rewind is busy with another replay; try again in a few seconds.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "Some of the input isn't valid: check the date, the shots and the circuit.";
  return `The server answered ${status}.`;
}
