/*
 * "Reproduce a paper": the API's shapes (backend/app/routers/papers.py) and the small pure helpers
 * the screen uses to read what the user types as the paper's numbers.
 */

export type Facts = { num_qubits: number; operations: number; two_qubit_gates: number; depth: number; measured: number; expanded_operations: number; clbits: number };
export type FoundCircuit = { id: string; name: string; origin: string; source: string; qasm: string; ok: boolean; problem: string | null; facts: Facts | null };
export type Source = { name: string; url: string; status: "ok" | "missing" | "refused" | "error"; note: string | null; files_read: number; skipped: { name: string; reason: string }[]; skipped_total: number };
export type Values = { origin: string; kind: "counts" | "probabilities"; distribution: Record<string, number>; status: string };
export type Paper = {
  arxiv_id: string; version_id: string; title: string; authors: string[]; authors_total: number; abstract: string | null;
  comment: string | null; published: string | null; url: string; sources: Source[]; circuits: FoundCircuit[]; more: number;
  python_files: string[]; python_only: boolean; values: Values[]; message: string; checked_at: string; cached: boolean;
};
export type Status = {
  calibration_available: boolean; simulated: boolean; reason: string | null; ideal_label: string; note: string;
  machines: { machine: string; snapshots: number; first_date: string; last_date: string }[];
  limits: { qubits: number; shots: number };
};
export type Kind = "probability" | "fidelity" | "distribution";
export type Reported = { kind: Kind; value?: number; outcomes?: string[]; distribution?: Record<string, number>; extracted?: boolean };
export type Comparison = {
  kind: Kind; ours: number | null; reported: number | null; difference: number | null; tolerance: number | null;
  verdict: "match" | "lower" | "higher" | "close" | "rough" | "differs" | "ideal_only" | "cannot"; line: string; notes: string[];
  outcomes?: string[]; hellinger_fidelity?: number; tvd?: number; reversed_fidelity?: number; rows?: [string, number, number][];
};
export type RunResult = {
  mode: "ideal" | "calibrated"; label: string; machine: string | null; requested_date: string | null;
  snapshot: { calibrated_at: string; sha256: string; gap_days: number; note: string } | null;
  counts: Record<string, number>; shots: number; seeds: { simulator: number; transpiler: number };
  circuit: Facts; method?: string; noise_model?: { method: string; not_modelled: string[] };
  ideal: { available: boolean; reason: string | null; hellinger_fidelity: number | null; share_on_ideal_outcomes: number | null; top: [string, number][] };
  software: Record<string, string>; seconds: number; accuracy_note: string | null; real_hardware: boolean; notes: string[];
  comparison: Comparison | null; note: string;
};

export const EXAMPLE = "1707.03429";

/** "0.87", "87%", ".87" -> 0.87; anything else -> null. */
export function parseValue(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const pctForm = t.endsWith("%");
  const n = Number(pctForm ? t.slice(0, -1).trim() : t);
  if (!Number.isFinite(n)) return null;
  const v = pctForm || n > 1 ? n / 100 : n;
  return v >= 0 && v <= 1 ? v : null;
}

/** "000, 111" or "000 111" -> ["000", "111"]; null when anything isn't a bitstring. */
export function parseOutcomes(raw: string): string[] | null {
  const parts = raw.split(/[\s,;|]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => !/^[01]{1,32}$/.test(p))) return null;
  return [...new Set(parts)];
}

/** "00: 0.48, 11: 0.47", one pair per line, or JSON -> { "00": 0.48, ... }; null when it can't be read. */
export function parseDistribution(raw: string): Record<string, number> | null {
  const t = raw.trim();
  if (!t) return null;
  let pairs: [string, unknown][] = [];
  if (t.startsWith("{")) {
    try { pairs = Object.entries(JSON.parse(t) as Record<string, unknown>); } catch { return null; }
  } else {
    for (const piece of t.split(/[\n,;]+/)) {
      const m = piece.trim().match(/^"?([01 ]{1,40})"?\s*[:=\s]\s*([0-9.eE+-]+%?)$/);
      if (!piece.trim()) continue;
      if (!m) return null;
      pairs.push([m[1], m[2].endsWith("%") ? Number(m[2].slice(0, -1)) / 100 : Number(m[2])]);
    }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of pairs) {
    const key = k.replace(/ /g, "");
    if (!/^[01]{1,32}$/.test(key) || typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    out[key] = (out[key] ?? 0) + v;
  }
  return Object.keys(out).length ? out : null;
}

export function distributionText(d: Record<string, number>): string {
  return Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("\n");
}

export type ReportedInput = { kind: Kind; value: string; outcomes: string; distribution: string; extracted: boolean };

/** What the user typed as the paper's numbers, ready for the API, or why not (null: nothing typed). */
export function buildReported(r: ReportedInput): { ok: true; reported: Reported } | { ok: false; msg: string } | null {
  if (r.kind === "distribution") {
    if (!r.distribution.trim()) return null;
    const d = parseDistribution(r.distribution);
    return d ? { ok: true, reported: { kind: "distribution", distribution: d, extracted: r.extracted } }
      : { ok: false, msg: "Write the distribution as bitstring: value pairs, one per line, like 000: 0.48." };
  }
  if (!r.value.trim()) return null;
  const v = parseValue(r.value);
  if (v == null) return { ok: false, msg: "The reported value must be between 0 and 1 (or a percentage)." };
  if (r.kind === "fidelity") return { ok: true, reported: { kind: "fidelity", value: v, extracted: r.extracted } };
  const outs = parseOutcomes(r.outcomes);
  if (!outs) return { ok: false, msg: "List the outcomes the probability is for, as bitstrings like 000, 111." };
  return { ok: true, reported: { kind: "probability", value: v, outcomes: outs, extracted: r.extracted } };
}

export const fmt3 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(3));
export const pct = (x: number) => `${(x * 100).toFixed(x >= 0.995 || x < 0.1 ? 1 : 0)}%`;
export const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function apiError(status: number, detail: unknown): string {
  if (status === 429) return "That's a lot of requests in a short time. Wait a few minutes, then try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "Some of the input isn't valid: check the shots, the date and the paper's numbers.";
  return `The server answered ${status}.`;
}

/** The address of this comparison: the paper, the circuit, where it ran and the paper's numbers. */
export function shareUrl(base: string, p: { paper: string; circuit: string; machine: string; date: string; shots: number; reported: ReportedInput }): string {
  const u = new URL(base);
  u.search = "";
  u.searchParams.set("paper", p.paper);
  u.searchParams.set("c", p.circuit);
  if (p.machine) u.searchParams.set("machine", p.machine);
  if (p.date) u.searchParams.set("date", p.date);
  if (p.shots !== 1024) u.searchParams.set("shots", String(p.shots));
  const r = p.reported;
  if (r.kind === "distribution" ? r.distribution.trim() : r.value.trim()) {
    u.searchParams.set("rk", r.kind);
    if (r.kind === "distribution") {
      const d = parseDistribution(r.distribution);
      if (d) u.searchParams.set("rd", Object.entries(d).map(([k, v]) => `${k}:${v}`).join(","));
    } else {
      u.searchParams.set("rv", r.value.trim());
      if (r.kind === "probability" && r.outcomes.trim()) u.searchParams.set("ro", r.outcomes.trim());
    }
    if (r.extracted) u.searchParams.set("rx", "1");
  }
  return u.toString();
}

export function readShare(search: string): { paper: string | null; circuit: string | null; machine: string; date: string; shots: number | null; reported: ReportedInput | null } {
  const p = new URLSearchParams(search);
  const kind = p.get("rk");
  const k: Kind | null = kind === "probability" || kind === "fidelity" || kind === "distribution" ? kind : null;
  const shots = Number(p.get("shots"));
  return {
    paper: p.get("paper"), circuit: p.get("c"), machine: p.get("machine") ?? "", date: /^\d{4}-\d{2}-\d{2}$/.test(p.get("date") ?? "") ? p.get("date")! : "",
    shots: Number.isInteger(shots) && shots > 0 ? shots : null,
    reported: k ? { kind: k, value: (p.get("rv") ?? "").slice(0, 20), outcomes: (p.get("ro") ?? "").slice(0, 400),
      distribution: (p.get("rd") ?? "").split(",").map((x) => x.replace(":", ": ")).join("\n").slice(0, 20000), extracted: p.get("rx") === "1" } : null,
  };
}
