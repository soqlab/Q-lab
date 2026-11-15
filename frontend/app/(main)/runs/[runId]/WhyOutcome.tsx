"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import MeasurementHistogram from "./MeasurementHistogram";
import { apiUrl, getStoredToken } from "../../../../lib/api";

/*
 * "Why this outcome?": pick a bar in the run's histogram and Q-Lab names the error sources that make
 * that outcome likely, from a noise model built from the run's calibration (backend/app/why_failed.py,
 * docs/WHY_METHOD.md). Self-contained so the run page only swaps one element.
 */

const METHOD_URL = "https://github.com/soqlab/Q-lab/blob/main/docs/WHY_METHOD.md";

type Source = {
  key: string;
  kind: "readout" | "gate_2q" | "gate_1q" | "decoherence";
  qubits: number[];
  label: string;
  share: number;
  probability_drop: number;
};

type MapNode = { qubit: number; x: number; y: number; used: boolean; share: number };
type MapEdge = { a: number; b: number; share: number };

type WhyAnswer = {
  status: "explained" | "expected_outcome" | "unexplained" | "no_calibration" | "no_layout" | "too_large" | "unsupported" | "no_counts";
  outcome: string;
  message: string;
  headline?: string;
  sources?: Source[];
  confidence?: "high" | "medium" | "low";
  confidence_reasons?: string[];
  observed?: { count: number; shots: number; share: number | null };
  noise_free_probability?: number;
  modelled_probability?: number;
  missing?: string[];
  limits?: { qubits: number; operations: number; seconds: number };
  calibration?: { origin: "run" | "rewind"; calibrated_at: string | null; note: string; label: string | null; hours_from_run: number | null };
  coupling_map?: { nodes: MapNode[]; edges: MapEdge[]; source: string; partial: boolean };
  not_modelled?: string[];
};

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(v > 0 && v < 0.001 ? 3 : digits)}%`;

const CONFIDENCE_CHIP = { high: "chip chip-ok", medium: "chip chip-warn", low: "chip chip-danger" } as const;

export default function WhyOutcome({ runId, results, expected }: {
  runId: string; results: Record<string, unknown>; expected?: string[] | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<WhyAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const pick = useCallback((outcome: string) => {
    abort.current?.abort();
    if (outcome === picked) {
      setPicked(null);
      setAnswer(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPicked(outcome);
    setAnswer(null);
    setError(null);
    setLoading(true);
    const token = getStoredToken();
    fetch(apiUrl(`/api/v1/runs/${encodeURIComponent(runId)}/why?outcome=${encodeURIComponent(outcome)}`), {
      cache: "no-store", signal: ctrl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { detail?: string }).detail ?? `The server answered ${res.status}.`);
        setAnswer(body as WhyAnswer);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Couldn't reach Q-Lab.");
      })
      .finally(() => {
        if (abort.current === ctrl) setLoading(false);
      });
  }, [picked, runId]);

  const close = () => pick(picked ?? "");

  return (
    <>
      <MeasurementHistogram results={results} expected={expected} onPick={pick} picked={picked} />
      {picked && (
        <section ref={panel} className="frame" aria-labelledby="why-h" aria-live="polite" aria-busy={loading} style={{ marginTop: 12 }}>
          <div className="frame-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 id="why-h" className="inst-label">Why <code className="mono">{picked}</code>?</h2>
            <button type="button" className="button secondary" onClick={close} aria-label="Close the explanation"
              style={{ height: 30, padding: "0 8px" }}><X size={14} aria-hidden /></button>
          </div>
          <div className="frame-body" style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13, lineHeight: 1.55 }}>
            {loading && (
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Simulating your circuit with each error source removed in turn. This takes up to half a minute the
                first time; other outcomes of this run are instant after that.
              </p>
            )}
            {error && <p role="alert" style={{ margin: 0, color: "var(--danger-text)" }}>{error}</p>}
            {answer && <Answer a={answer} />}
          </div>
        </section>
      )}
    </>
  );
}

function Answer({ a }: { a: WhyAnswer }) {
  if (a.status !== "explained") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0 }}>{a.message}</p>
        {a.missing && a.missing.length > 0 && (
          <p style={{ margin: 0, color: "var(--muted)" }}>Missing: {a.missing.join(", ")}.</p>
        )}
        {a.status === "too_large" && a.limits && (
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Limits here: {a.limits.qubits} qubits, {a.limits.operations} operations, {a.limits.seconds} s.
          </p>
        )}
        {a.coupling_map && a.coupling_map.nodes.length > 0 && <CouplingMap map={a.coupling_map} />}
        <Method a={a} />
      </div>
    );
  }
  const sources = a.sources ?? [];
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{a.headline}</strong>
        {a.confidence && <span className={CONFIDENCE_CHIP[a.confidence]}>{a.confidence} confidence</span>}
      </div>
      <p className="num" style={{ margin: 0, color: "var(--muted)" }}>
        Measured: {pct(a.observed?.share)} of shots ({a.observed?.count.toLocaleString()} of {a.observed?.shots.toLocaleString()}).
        {" "}The model of the machine gives {pct(a.modelled_probability)}; without noise the circuit never gives it.
      </p>

      <div>
        <div className="inst-label" style={{ marginBottom: 6 }}>Share of the cause, in the model</div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {sources.map((s) => (
            <li key={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 52px", gap: 8, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflowWrap: "anywhere" }}>{s.label}</div>
                <div aria-hidden style={{ height: 6, background: "var(--panel-2)", marginTop: 3 }}>
                  <div style={{ height: 6, width: `${Math.max(1, s.share * 100)}%`, background: "var(--warn)" }} />
                </div>
              </div>
              <span className="num" style={{ textAlign: "right" }}>~{Math.round(s.share * 100)}%</span>
            </li>
          ))}
        </ol>
      </div>

      {a.coupling_map && a.coupling_map.nodes.length > 0 && <CouplingMap map={a.coupling_map} />}

      {a.confidence_reasons && a.confidence_reasons.length > 0 && (
        <div>
          <div className="inst-label" style={{ marginBottom: 4 }}>Why {a.confidence} confidence</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
            {a.confidence_reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <Method a={a} />
    </>
  );
}

function Method({ a }: { a: WhyAnswer }) {
  return (
    <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      {a.calibration && (
        <span>
          Calibration: {a.calibration.note}
          {a.calibration.calibrated_at ? ` Calibrated ${a.calibration.calibrated_at.replace("T", " ").slice(0, 16)} UTC.` : ""}
          {a.calibration.label ? ` ${a.calibration.label}` : ""}
        </span>
      )}
      <span>
        This is a model, not a measurement of your job: shares come from removing one error source at a time and
        seeing how much less likely this outcome becomes. Not modelled: {(a.not_modelled ?? []).join(", ")}.{" "}
        <a href={METHOD_URL} target="_blank" rel="noreferrer">How it works</a>
      </span>
    </div>
  );
}

function CouplingMap({ map }: { map: NonNullable<WhyAnswer["coupling_map"]> }) {
  const W = 360, H = 220, P = 22;
  const pos = new Map(map.nodes.map((n) => [n.qubit, { x: P + n.x * (W - 2 * P), y: P + n.y * (H - 2 * P) }]));
  const blamed = map.nodes.filter((n) => n.share > 0.005).map((n) => `qubit ${n.qubit} ${Math.round(n.share * 100)}%`)
    .concat(map.edges.filter((e) => e.share > 0.005).map((e) => `coupler ${e.a}-${e.b} ${Math.round(e.share * 100)}%`));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", maxWidth: 480, height: "auto", display: "block" }}
        aria-label={`The machine's qubits around this run. Blamed: ${blamed.join(", ") || "none"}.`}>
        {map.edges.map((e) => {
          const a = pos.get(e.a), b = pos.get(e.b);
          if (!a || !b) return null;
          return <line key={`${e.a}-${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={e.share > 0.005 ? "var(--warn)" : "var(--line)"} strokeWidth={e.share > 0.005 ? 2 + 7 * e.share : 2} />;
        })}
        {map.nodes.map((n) => {
          const p = pos.get(n.qubit)!;
          const hot = n.share > 0.005;
          return (
            <g key={n.qubit}>
              <circle cx={p.x} cy={p.y} r={hot ? 11 + 6 * n.share : 11}
                fill={hot ? "var(--warn)" : n.used ? "var(--panel)" : "var(--panel-2)"}
                stroke={n.used ? "var(--text)" : "var(--line)"} strokeWidth={n.used ? 1.5 : 1} />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={10}
                fill={hot ? "var(--panel)" : n.used ? "var(--text)" : "var(--muted)"}
                style={{ fontFamily: "var(--font-mono, monospace)" }}>{n.qubit}</text>
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Qubits your run used (outlined) and their neighbours{map.partial ? " (part of the machine)" : ""}; highlighted
        where the model puts the blame, thicker for a larger share. Connections: {map.source}.
      </figcaption>
    </figure>
  );
}
