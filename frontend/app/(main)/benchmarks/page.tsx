"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { fetchBenchmark, fetchBenchmarks, healthColor, type Benchmark } from "../../../lib/api";

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string }> = {
    running: { bg: "var(--info-bg)", color: "var(--info-text)" },
    completed: { bg: "var(--ok-bg)", color: "var(--ok-text)" },
    partial: { bg: "rgba(167,99,16,0.1)", color: "var(--warn)" },
  };
  const s = cfg[status] ?? { bg: "#f5f5f5", color: "#666" };
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
      {status}
    </span>
  );
}

function CompareTable({ benchmarkId }: { benchmarkId: string }) {
  const [bm, setBm] = useState<Benchmark | null>(null);

  useEffect(() => {
    void fetchBenchmark(benchmarkId).then(setBm).catch(() => {});
  }, [benchmarkId]);

  if (!bm?.comparison) return null;
  const backends = Object.keys(bm.comparison);
  if (!backends.length) return null;

  const firstEntry = bm.comparison[backends[0]] as Record<string, unknown>;
  const cols = Object.keys(firstEntry).filter(k => k !== "run_id");

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
    return String(v);
  }

  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>Backend</th>
            {cols.map(c => <th key={c}>{c.replace(/_/g, " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {backends.map(backend => {
            const row = bm.comparison![backend] as Record<string, unknown>;
            return (
              <tr key={backend}>
                <td>
                  <Link href={`/runs/${String(row.run_id)}`} style={{ color: "var(--strong)", fontWeight: 600 }}>
                    {backend}
                  </Link>
                </td>
                {cols.map(c => (
                  <td key={c} style={c === "success_probability" && typeof row[c] === "number" ? { color: healthColor((row[c] as number) * 100) } : {}}>
                    {fmt(row[c])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void fetchBenchmarks()
      .then(setBenchmarks)
      .catch(() => setBenchmarks([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2>Benchmarks ({benchmarks.length})</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Fan-out experiments — same circuit across multiple backends
          </span>
        </div>
        {loading && <div className="empty">Loading…</div>}
        {!loading && !benchmarks.length && (
          <div className="empty">
            {"No benchmarks yet. Use "}
            <code>{"qlab.benchmark(circuit, backends=[\"ibm_a\",\"ibm_b\"])"}</code>
            {" in your Qiskit script."}
          </div>
        )}
        {benchmarks.map((bm) => (
          <div key={bm.benchmark_id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {bm.name || bm.benchmark_id.slice(0, 16) + "…"}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  {(bm.backends ?? []).join(" · ")} &nbsp;·&nbsp; {new Date(bm.created_at).toLocaleString()}
                  {bm.project && <> &nbsp;·&nbsp; <span style={{ fontWeight: 500 }}>{bm.project}</span></>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <StatusBadge status={bm.status} />
                <button
                  className="button secondary"
                  style={{ height: 30, fontSize: 12 }}
                  onClick={() => setExpanded(expanded === bm.benchmark_id ? null : bm.benchmark_id)}
                >
                  {expanded === bm.benchmark_id ? "Collapse" : "Compare"} <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
            {expanded === bm.benchmark_id && <CompareTable benchmarkId={bm.benchmark_id} />}
          </div>
        ))}
      </section>
    </main>
  );
}
