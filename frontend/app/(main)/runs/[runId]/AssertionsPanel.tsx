"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, FlaskConical } from "lucide-react";
import { fetchRunAssertions, RunAssertionResult, RunAssertionsResponse } from "../../../../lib/api";

function AssertionRow({ a }: { a: RunAssertionResult }) {
  const icon = a.passed === true
    ? <CheckCircle size={16} color="var(--ok)" />
    : a.passed === false
    ? <XCircle size={16} color="var(--danger)" />
    : <Clock size={16} color="var(--muted)" />;

  const bg = a.passed === true
    ? "var(--ok-bg)"
    : a.passed === false
    ? "var(--danger-bg)"
    : "var(--panel-2)";

  const border = a.passed === true
    ? "var(--ok)"
    : a.passed === false
    ? "var(--danger)"
    : "var(--line)";

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 18px",
      borderBottom: "1px solid var(--line)", background: bg,
    }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {a.label && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.label}</span>
          )}
          {a.state && (
            <code style={{
              fontSize: 12, background: "var(--panel)", border: `1px solid ${border}`,
              padding: "1px 6px", borderRadius: 5,
            }}>|{a.state}⟩</code>
          )}
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
            {a.assertion_type.replace("_", " ")}
          </span>
        </div>
        {a.message && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text)", fontFamily: "monospace" }}>
            {a.message}
          </p>
        )}
        <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
          {a.expected_min != null && (
            <span>min: <strong>{a.expected_min}</strong></span>
          )}
          {a.expected_max != null && (
            <span>max: <strong>{a.expected_max}</strong></span>
          )}
          {a.actual_value != null && (
            <span>actual: <strong style={{ color: "var(--text)" }}>{a.actual_value.toFixed(4)}</strong></span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssertionsPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<RunAssertionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRunAssertions(runId)
      .then(d => { if (d.total > 0) setData(d); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading || !data) return null;

  const overallColor = data.overall === "passed"
    ? "var(--ok)"
    : data.overall === "failed"
    ? "var(--danger)"
    : "var(--muted)";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={16} aria-hidden="true" />
          Circuit Assertions
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {data.passed} passed · {data.failed} failed
            {data.pending > 0 ? ` · ${data.pending} pending` : ""}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: data.overall === "passed" ? "var(--ok-bg)"
              : data.overall === "failed" ? "var(--danger-bg)"
              : "var(--panel-2)",
            color: overallColor,
          }}>
            {data.overall.toUpperCase()}
          </span>
        </div>
      </div>
      <div>
        {data.assertions.map(a => <AssertionRow key={a.id} a={a} />)}
      </div>
    </section>
  );
}
