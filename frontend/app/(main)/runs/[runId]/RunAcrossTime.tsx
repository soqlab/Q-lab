"use client";

/**
 * This run across time: one slider. Left of the run, the same circuit replayed on the same IBM
 * machine as it was calibrated on each stored day (Rewind, simulated). At the run, what the
 * machine really measured. Right of the run, a forecast of which machine and hour should do best
 * in the coming days. Backend: GET /api/v1/runs/{id}/timeline[/replay|/forecast] (app/time_dial.py).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiUrl, getStoredToken } from "../../../../lib/api";
import s from "./RunAcrossTime.module.css";

type Counts = Record<string, number>;

type Timeline = {
  run_id: string;
  run_date: string | null;
  state: "ready" | "empty" | "unavailable";
  reason: string | null;
  message: string | null;
  machine: string | null;
  present?: { counts: Counts | null; shots: number | null };
  past?: { date: string; calibrated_at: string }[];
  accuracy?: { median: number } | null;
  accuracy_note?: string;
  label?: string;
  forecast?: { available: boolean; method: string };
};

type Replay = {
  date: string;
  counts: Counts;
  shots: number;
  label: string;
  snapshot: { calibrated_at: string; note: string };
  tvd_vs_run: number | null;
  hellinger_fidelity: number | null;
  accuracy: { median: number } | null;
  accuracy_note: string;
  changed: { sentence: string | null };
};

type MachineForecast = {
  machine: string;
  days: number;
  esp: number | null;
  low?: number;
  high?: number;
  usual_calibration_hour_utc?: number | null;
  reason?: string;
  weak_point?: { text: string; detail: string } | null;
};

type Forecast = {
  available: boolean;
  message: string | null;
  sentence: string | null;
  method: string;
  machines: MachineForecast[];
  best: { machine: string } | null;
  drift: { state: string; sentence: string | null } | null;
  label: string;
};

type Loaded<T> = { ok: true; data: T } | { ok: false; message: string; retry: boolean };

type Stop =
  | { kind: "past"; date: string }
  | { kind: "run" }
  | { kind: "future" }
  | { kind: "past-empty" }
  | { kind: "future-empty" };

const DEBOUNCE_MS = 350;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<Loaded<T>> {
  const token = getStoredToken();
  try {
    const r = await fetch(apiUrl(path), { cache: "no-store", signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (r.ok) return { ok: true, data: (await r.json()) as T };
    const body = await r.json().catch(() => ({}));
    const detail = typeof body?.detail === "string" ? body.detail : `The server answered ${r.status}.`;
    if (r.status === 429) return { ok: false, message: "That's a lot of replays in a minute; wait a moment, then try again.", retry: true };
    return { ok: false, message: detail, retry: r.status === 503 || r.status === 504 };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ok: false, message: "Couldn't reach the server.", retry: true };
  }
}

function dayWords(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const norm = (k: string) => k.replace(/ /g, "");

function buildStops(tl: Timeline): Stop[] {
  if (tl.state !== "ready") return [{ kind: "past-empty" }, { kind: "run" }, { kind: "future-empty" }];
  const days = tl.past ?? [];
  const runDay = tl.run_date ?? "";
  const before = days.filter((d) => d.date <= runDay).map((d) => ({ kind: "past" as const, date: d.date }));
  const after = days.filter((d) => d.date > runDay).map((d) => ({ kind: "past" as const, date: d.date }));
  return [...before, { kind: "run" }, ...after, tl.forecast?.available ? { kind: "future" } : { kind: "future-empty" }];
}

function stopText(stop: Stop, tl: Timeline): string {
  switch (stop.kind) {
    case "past": return `${dayWords(stop.date)}: replay on ${tl.machine} as calibrated that day, simulated`;
    case "run": return `This run${tl.run_date ? `, ${dayWords(tl.run_date)}` : ""}: what the machine measured`;
    case "future": return "Coming days: forecast of the best machine and hour";
    case "past-empty": return "Past: no stored calibrations yet";
    case "future-empty": return "Coming days: no forecast without stored calibrations";
  }
}

/** Outcome bars: the selected distribution, with a tick where the run itself measured each outcome. */
function Bars({ counts, reference, busy }: { counts: Counts; reference: Counts | null; busy: boolean }) {
  const rows = useMemo(() => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const refTotal = reference ? Object.values(reference).reduce((a, b) => a + b, 0) || 1 : 1;
    const ref = new Map(Object.entries(reference ?? {}).map(([k, v]) => [norm(k), v / refTotal]));
    const mine = new Map(Object.entries(counts).map(([k, v]) => [norm(k), v / total]));
    const keys = Array.from(new Set([...mine.keys(), ...ref.keys()]));
    keys.sort((a, b) => (ref.get(b) ?? 0) - (ref.get(a) ?? 0) || (mine.get(b) ?? 0) - (mine.get(a) ?? 0) || a.localeCompare(b));
    const top = keys.slice(0, 12);
    const max = Math.max(...top.map((k) => Math.max(mine.get(k) ?? 0, ref.get(k) ?? 0)), 1e-9);
    return { top: top.map((k) => ({ k, p: mine.get(k) ?? 0, r: reference ? ref.get(k) ?? 0 : null })), max, more: keys.length - top.length };
  }, [counts, reference]);
  return (
    <div className={s.bars} aria-busy={busy}>
      {rows.top.map(({ k, p, r }) => (
        <div key={k} className={s.row}>
          <code className={s.key} title={k}>{k}</code>
          <div className={s.lane} aria-hidden="true">
            <div className={s.bar} style={{ width: `${Math.max((p / rows.max) * 100, p > 0 ? 0.6 : 0)}%` }} />
            {r !== null && <div className={s.ghost} style={{ left: `calc(${(r / rows.max) * 100}% - 1px)` }} />}
          </div>
          <span className={s.pct}>{pct(p)}</span>
        </div>
      ))}
      {rows.more > 0 && <p className={s.note}>The 12 most common of {rows.top.length + rows.more} outcomes.</p>}
    </div>
  );
}

function ForecastView({ f, runMachine }: { f: Forecast; runMachine: string }) {
  const scored = f.machines.filter((m) => m.esp !== null);
  return (
    <>
      <p className={s.stop}>{f.sentence}</p>
      <ul className={s.machines} aria-label="Estimated success by machine">
        {scored.map((m) => (
          <li key={m.machine} className={s.machine} data-best={f.best?.machine === m.machine}>
            <code className={s.key}>{m.machine}{m.machine === runMachine ? " ·" : ""}</code>
            <div className={s.lane} aria-hidden="true">
              <div className={s.spread} style={{ left: `${(m.low ?? 0) * 100}%`, width: `${Math.max(((m.high ?? 0) - (m.low ?? 0)) * 100, 0.5)}%` }} />
              <div className={s.mid} style={{ left: `calc(${(m.esp ?? 0) * 100}% - 1px)` }} />
            </div>
            <span className={s.pct}>{pct(m.esp ?? 0)}</span>
            <p className={s.why}>
              {m.low !== undefined && m.high !== undefined ? `${pct(m.low)}–${pct(m.high)} over ${m.days} stored day${m.days === 1 ? "" : "s"}` : ""}
              {m.usual_calibration_hour_utc != null ? `; calibrated around ${String(m.usual_calibration_hour_utc).padStart(2, "0")}:00 UTC` : ""}
              {m.weak_point ? `; weakest point: ${m.weak_point.text}` : ""}
            </p>
          </li>
        ))}
        {f.machines.filter((m) => m.esp === null).map((m) => (
          <li key={m.machine} className={s.why}>{m.machine}: {m.reason}</li>
        ))}
      </ul>
      {f.drift?.sentence && <p className={s.changed}>{f.drift.sentence}</p>}
      <details className={s.note}>
        <summary>This is a forecast. How it&apos;s worked out</summary>
        <p>{f.method}</p>
      </details>
    </>
  );
}

export default function RunAcrossTime({ runId }: { runId: string }) {
  const [tl, setTl] = useState<Loaded<Timeline> | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [replays, setReplays] = useState<Record<string, Loaded<Replay>>>({});
  const [forecast, setForecast] = useState<Loaded<Forecast> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [prevRunId, setPrevRunId] = useState(runId);
  if (runId !== prevRunId) {
    setPrevRunId(runId);
    setTl(null);
    setPicked(null);
    setReplays({});
    setForecast(null);
  }

  useEffect(() => {
    const ac = new AbortController();
    getJson<Timeline>(`/api/v1/runs/${encodeURIComponent(runId)}/timeline`, ac.signal).then(setTl).catch(() => {});
    return () => ac.abort();
  }, [runId]);

  const timeline = tl?.ok ? tl.data : null;
  const stops = useMemo(() => (timeline ? buildStops(timeline) : []), [timeline]);
  const runIndex = stops.findIndex((x) => x.kind === "run");
  const index = picked ?? runIndex;
  const stop = stops[index];
  const pastDate = stop?.kind === "past" ? stop.date : null;
  const wantForecast = stop?.kind === "future";
  const replay = pastDate ? replays[pastDate] : undefined;

  // Replay the selected day once the slider rests on it; each day is fetched once (the server caches too).
  useEffect(() => {
    if (!pastDate || replay) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      getJson<Replay>(`/api/v1/runs/${encodeURIComponent(runId)}/timeline/replay?date=${pastDate}`, ac.signal)
        .then((r) => setReplays((m) => ({ ...m, [pastDate]: r })))
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [runId, pastDate, replay, attempt]);

  useEffect(() => {
    if (!wantForecast || forecast) return;
    const ac = new AbortController();
    getJson<Forecast>(`/api/v1/runs/${encodeURIComponent(runId)}/timeline/forecast`, ac.signal).then(setForecast).catch(() => {});
    return () => ac.abort();
  }, [runId, wantForecast, forecast, attempt]);

  if (!tl) return null;
  if (!tl.ok || !timeline) return null;
  // A run with no machine, or a Rewind replay (already labelled at the top of the page): nothing to show.
  if (timeline.state === "unavailable" && (timeline.reason === "no_backend" || timeline.reason === "replay")) return null;
  if (timeline.state === "unavailable") {
    return (
      <section className="frame" aria-labelledby="across-time-h">
        <div className="frame-head"><h2 id="across-time-h" className="inst-label">This run across time</h2></div>
        <p className={`${s.body} ${s.sub}`}>{timeline.message}</p>
      </section>
    );
  }

  const machine = timeline.machine ?? "";
  const runCounts = timeline.present?.counts ?? null;

  // While a day is being replayed, keep the nearest day already replayed on screen (dimmed).
  let shown: Replay | null = replay?.ok ? replay.data : null;
  if (!shown && stop?.kind === "past") {
    for (let d = 1; d < stops.length && !shown; d++) {
      for (const j of [index - d, index + d]) {
        const x = stops[j];
        const e = x?.kind === "past" ? replays[x.date] : undefined;
        if (e?.ok) { shown = e.data; break; }
      }
    }
  }
  const loadingReplay = stop?.kind === "past" && !replay;

  const retry = () => {
    if (pastDate) setReplays((m) => { const n = { ...m }; delete n[pastDate]; return n; });
    if (wantForecast) setForecast(null);
    setAttempt((a) => a + 1);
  };

  const pastCount = stops.filter((x) => x.kind === "past").length;
  const head = (() => {
    if (!stop) return null;
    if (stop.kind === "run") {
      return <p className={s.stop}><b>This run</b> on {machine}{timeline.run_date ? `, ${dayWords(timeline.run_date)}` : ""}: what the machine really measured.{timeline.state === "ready" ? ` Drag left to replay it on ${machine} as calibrated on ${pastCount} stored day${pastCount === 1 ? "" : "s"}, right for the coming days.` : ""}</p>;
    }
    if (stop.kind === "past-empty" || stop.kind === "future-empty") {
      return <p className={s.stop}>{timeline.state === "empty" ? timeline.message : "Nothing to forecast from yet: there are no stored calibrations to score this circuit against."}</p>;
    }
    if (stop.kind === "future") return null;
    const gap = timeline.run_date ? daysBetween(timeline.run_date, stop.date) : null;
    const rel = gap === null || gap === 0 ? "the run's day" : `${Math.abs(gap)} day${Math.abs(gap) === 1 ? "" : "s"} ${gap < 0 ? "before" : "after"} this run`;
    return <p className={s.stop}><b>{dayWords(stop.date)}</b> ({rel}): this circuit replayed on a simulated {machine} as calibrated that day.</p>;
  })();

  return (
    <section className="frame" aria-labelledby="across-time-h">
      <div className="frame-head">
        <h2 id="across-time-h" className="inst-label">This run across time</h2>
        <Link className="mono" style={{ fontSize: 11, color: "var(--muted)", textDecoration: "underline" }}
          href={timeline.state === "ready" ? `/rewind?${new URLSearchParams({ machine, ...(timeline.run_date ? { date: timeline.run_date } : {}), run: timeline.run_id })}` : "/rewind"}>
          {machine} in Rewind
        </Link>
      </div>
      <div className={s.body}>
        <div className={s.track}>
          <input
            id="across-time-slider"
            className={s.range}
            type="range"
            min={0}
            max={Math.max(stops.length - 1, 0)}
            step={1}
            value={index}
            onChange={(e) => setPicked(Number(e.target.value))}
            aria-label={`Move this run through time on ${machine}`}
            aria-valuetext={stop ? stopText(stop, timeline) : undefined}
          />
          <div className={s.ends} aria-hidden="true"><span>Past</span><span>This run</span><span>Coming days</span></div>
        </div>

        <div aria-live="polite">{head}</div>

        {stop?.kind === "run" && runCounts && <Bars counts={runCounts} reference={null} busy={false} />}

        {stop?.kind === "past" && (
          <>
            {replay && !replay.ok && (
              <p className={s.sub} role="status">{replay.message}{replay.retry && <button type="button" className={s.retry} onClick={retry}>Try again</button>}</p>
            )}
            {loadingReplay && <p className={s.sub} role="status">Replaying {dayWords(stop.date)}…</p>}
            {shown && (
              <>
                {replay?.ok && shown.changed.sentence && <p className={s.changed}>{shown.changed.sentence}</p>}
                <Bars counts={shown.counts} reference={runCounts} busy={!replay?.ok} />
                {runCounts && (
                  <div className={s.legend}>
                    <span><i className={s.swatch} />replay, {shown.shots.toLocaleString()} shots</span>
                    <span><i className={s.tick} />what this run measured</span>
                  </div>
                )}
                {replay?.ok && (
                  <p className={s.note}>
                    {shown.tvd_vs_run !== null && <>The replay is {pct(shown.tvd_vs_run)} away from what this run measured (total variation distance). </>}
                    {shown.snapshot.note}{" "}
                    {shown.accuracy ? shown.accuracy_note : `How close replays of ${machine} come to the real machine hasn't been measured yet.`}{" "}
                    {shown.label}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {stop?.kind === "future" && (
          forecast === null ? <p className={s.sub} role="status">Scoring this circuit against each machine&apos;s recent calibrations…</p>
            : !forecast.ok ? <p className={s.sub} role="status">{forecast.message}{forecast.retry && <button type="button" className={s.retry} onClick={retry}>Try again</button>}</p>
              : forecast.data.available ? <ForecastView f={forecast.data} runMachine={machine} />
                : <p className={s.sub}>{forecast.data.message}</p>
        )}

      </div>
    </section>
  );
}
