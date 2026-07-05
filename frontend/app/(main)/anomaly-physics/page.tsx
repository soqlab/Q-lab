"use client";

import { useState } from "react";
import {
  checkPhysicsConstraints,
  compareToLiterature,
  PhysicsCheck,
  LiteratureComparison,
} from "@/lib/api";

type Tab = "physics" | "literature";

type PhysicsForm = {
  t1_us: string;
  t2_us: string;
  gate_fidelity: string;
  readout_fidelity: string;
  fidelity: string;
  backend: string;
  n_qubits: string;
};

type LitForm = {
  metric: string;
  value: string;
  backend: string;
  n_qubits: string;
  algorithm: string;
};

function parseOptFloat(v: string): number | undefined {
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

function parseOptInt(v: string): number | undefined {
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function GaugeFill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor =
    value >= 0.8
      ? "var(--ok)"
      : value >= 0.5
      ? "#f59e0b"
      : "var(--danger)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 8, color: "inherit" }}>
        {pct}
      </div>
      <div
        style={{
          width: 160,
          height: 16,
          background: "var(--line)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 999,
            width: `${pct}%`,
            background: barColor,
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        Physics Score
      </div>
    </div>
  );
}

export default function AnomalyPhysicsPage() {
  const [tab, setTab] = useState<Tab>("physics");

  // Physics check state
  const [physForm, setPhysForm] = useState<PhysicsForm>({
    t1_us: "",
    t2_us: "",
    gate_fidelity: "",
    readout_fidelity: "",
    fidelity: "",
    backend: "ibm_brisbane",
    n_qubits: "",
  });
  const [physResult, setPhysResult] = useState<PhysicsCheck | null>(null);
  const [physLoading, setPhysLoading] = useState(false);
  const [physError, setPhysError] = useState<string | null>(null);

  // Literature compare state
  const [litForm, setLitForm] = useState<LitForm>({
    metric: "fidelity",
    value: "",
    backend: "ibm_brisbane",
    n_qubits: "",
    algorithm: "",
  });
  const [litResult, setLitResult] = useState<LiteratureComparison | null>(null);
  const [litLoading, setLitLoading] = useState(false);
  const [litError, setLitError] = useState<string | null>(null);

  async function handlePhysicsCheck() {
    setPhysError(null);
    setPhysLoading(true);
    setPhysResult(null);
    try {
      const res = await checkPhysicsConstraints({
        t1_us: parseOptFloat(physForm.t1_us),
        t2_us: parseOptFloat(physForm.t2_us),
        gate_fidelity: parseOptFloat(physForm.gate_fidelity),
        readout_fidelity: parseOptFloat(physForm.readout_fidelity),
        fidelity: parseOptFloat(physForm.fidelity),
        backend: physForm.backend || undefined,
        n_qubits: parseOptInt(physForm.n_qubits),
      });
      setPhysResult(res);
    } catch (e) {
      setPhysError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setPhysLoading(false);
    }
  }

  async function handleLitCompare() {
    setLitError(null);
    setLitLoading(true);
    setLitResult(null);
    try {
      const res = await compareToLiterature({
        metric: litForm.metric,
        value: parseFloat(litForm.value),
        backend: litForm.backend,
        n_qubits: parseInt(litForm.n_qubits, 10),
        algorithm: litForm.algorithm,
      });
      setLitResult(res);
    } catch (e) {
      setLitError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setLitLoading(false);
    }
  }

  return (
    <div className="page" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        Anomaly Physics Engine
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        Validate experimental results against known quantum physics constraints
        and published literature.
      </p>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--surface)",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
          marginBottom: 24,
        }}
      >
        {(["physics", "literature"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              border: "none",
              background: tab === t ? "var(--strong)" : "transparent",
              color: tab === t ? "var(--text)" : "var(--muted)",
            }}
          >
            {t === "physics" ? "Physics Check" : "Literature Compare"}
          </button>
        ))}
      </div>

      {/* ── Physics Check Tab ── */}
      {tab === "physics" && (
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ width: 288, flexShrink: 0 }}>
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                Leave fields blank to skip those constraints.
              </p>

              {(
                [
                  ["T1 (µs)", "t1_us"],
                  ["T2 (µs)", "t2_us"],
                  ["Gate fidelity", "gate_fidelity"],
                  ["Readout fidelity", "readout_fidelity"],
                  ["Fidelity", "fidelity"],
                  ["Qubits", "n_qubits"],
                ] as [string, keyof PhysicsForm][]
              ).map(([label, key]) => (
                <div key={key}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="input"
                    style={{ width: "100%" }}
                    placeholder="optional"
                    value={physForm[key]}
                    onChange={(e) =>
                      setPhysForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Backend
                </label>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={physForm.backend}
                  onChange={(e) =>
                    setPhysForm((f) => ({ ...f, backend: e.target.value }))
                  }
                >
                  <option value="ibm_brisbane">ibm_brisbane</option>
                  <option value="ibm_kyoto">ibm_kyoto</option>
                  <option value="ionq_aria_1">ionq_aria_1</option>
                  <option value="quantinuum_h2">quantinuum_h2</option>
                </select>
              </div>

              <button
                onClick={handlePhysicsCheck}
                disabled={physLoading}
                className="button"
                style={{
                  width: "100%",
                  opacity: physLoading ? 0.5 : 1,
                  cursor: physLoading ? "not-allowed" : "pointer",
                }}
              >
                {physLoading ? "Checking…" : "Check Physics"}
              </button>
              {physError && (
                <p style={{ color: "var(--danger)", fontSize: 12 }}>{physError}</p>
              )}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {!physResult && !physLoading && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 256,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Fill in values and click Check Physics.
              </div>
            )}

            {physResult && (
              <>
                {/* Score gauge + overall_valid */}
                <div
                  style={{
                    background: "var(--surface)",
                    borderRadius: 12,
                    padding: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                  }}
                >
                  <GaugeFill value={physResult.physics_score} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "4px 12px",
                        borderRadius: 999,
                        width: "fit-content",
                        background: physResult.overall_valid
                          ? "rgba(16,185,129,0.1)"
                          : "rgba(239,68,68,0.1)",
                        color: physResult.overall_valid
                          ? "var(--ok)"
                          : "var(--danger)",
                      }}
                    >
                      {physResult.overall_valid ? "Valid" : "Invalid"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {(physResult.violations ?? []).length} violation(s),{" "}
                      {(physResult.warnings ?? []).length} warning(s),{" "}
                      {(physResult.passed ?? []).length} passed
                    </span>
                  </div>
                </div>

                {/* Violations */}
                {(physResult.violations ?? []).length > 0 && (
                  <div
                    style={{
                      background: "var(--surface)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontWeight: 600,
                        color: "var(--danger)",
                        marginBottom: 12,
                      }}
                    >
                      Violations
                    </h3>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {(physResult.violations ?? []).map((v, i) => (
                        <div
                          key={i}
                          style={{
                            background: "rgba(0,0,0,0.2)",
                            borderRadius: 8,
                            padding: 12,
                            borderLeft: "2px solid var(--danger)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                background: "rgba(239,68,68,0.15)",
                                color: "var(--danger)",
                                padding: "2px 8px",
                                borderRadius: 6,
                              }}
                            >
                              {v.rule}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--muted)",
                                textTransform: "uppercase",
                              }}
                            >
                              {v.severity}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text)",
                              marginBottom: 4,
                            }}
                          >
                            Observed: <strong>{v.observed}</strong> | Limit:{" "}
                            <strong>{v.limit}</strong>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>
                            {v.explanation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {(physResult.warnings ?? []).length > 0 && (
                  <div
                    style={{
                      background: "var(--surface)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontWeight: 600,
                        color: "#f59e0b",
                        marginBottom: 12,
                      }}
                    >
                      Warnings
                    </h3>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {(physResult.warnings ?? []).map((w, i) => (
                        <div
                          key={i}
                          style={{
                            background: "rgba(0,0,0,0.2)",
                            borderRadius: 8,
                            padding: 12,
                            borderLeft: "2px solid #f59e0b",
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: "#f59e0b", fontWeight: 500 }}>
                            {w.rule}
                          </span>
                          <span style={{ color: "var(--text)", marginLeft: 8 }}>
                            {w.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Passed */}
                {(physResult.passed ?? []).length > 0 && (
                  <div
                    style={{
                      background: "var(--surface)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontWeight: 600,
                        color: "var(--ok)",
                        marginBottom: 12,
                      }}
                    >
                      Passed Checks
                    </h3>
                    <ul
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                      }}
                    >
                      {(physResult.passed ?? []).map((p, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13,
                            color: "var(--text)",
                          }}
                        >
                          <span style={{ color: "var(--ok)" }}>&#10003;</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Literature Compare Tab ── */}
      {tab === "literature" && (
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ width: 288, flexShrink: 0 }}>
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Metric
                </label>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={litForm.metric}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, metric: e.target.value }))
                  }
                >
                  <option value="fidelity">fidelity</option>
                  <option value="energy">energy</option>
                  <option value="error_rate">error_rate</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Value
                </label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  style={{ width: "100%" }}
                  value={litForm.value}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, value: e.target.value }))
                  }
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Backend
                </label>
                <select
                  className="input"
                  style={{ width: "100%" }}
                  value={litForm.backend}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, backend: e.target.value }))
                  }
                >
                  <option value="ibm_brisbane">ibm_brisbane</option>
                  <option value="ibm_kyoto">ibm_kyoto</option>
                  <option value="ionq_aria_1">ionq_aria_1</option>
                  <option value="quantinuum_h2">quantinuum_h2</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Qubits
                </label>
                <input
                  type="number"
                  className="input"
                  style={{ width: "100%" }}
                  value={litForm.n_qubits}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, n_qubits: e.target.value }))
                  }
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Algorithm
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="e.g. VQE, QAOA…"
                  value={litForm.algorithm}
                  onChange={(e) =>
                    setLitForm((f) => ({ ...f, algorithm: e.target.value }))
                  }
                />
              </div>

              <button
                onClick={handleLitCompare}
                disabled={
                  litLoading ||
                  !litForm.value ||
                  !litForm.n_qubits ||
                  !litForm.algorithm
                }
                className="button"
                style={{
                  width: "100%",
                  opacity:
                    litLoading ||
                    !litForm.value ||
                    !litForm.n_qubits ||
                    !litForm.algorithm
                      ? 0.5
                      : 1,
                  cursor:
                    litLoading ||
                    !litForm.value ||
                    !litForm.n_qubits ||
                    !litForm.algorithm
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {litLoading ? "Comparing…" : "Compare to Literature"}
              </button>
              {litError && (
                <p style={{ color: "var(--danger)", fontSize: 12 }}>{litError}</p>
              )}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {!litResult && !litLoading && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 256,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Fill in values and click Compare to Literature.
              </div>
            )}

            {litResult && (
              <>
                {/* Percentile + record badge */}
                <div
                  style={{
                    background: "var(--surface)",
                    borderRadius: 12,
                    padding: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 60,
                        fontWeight: 700,
                        color: "var(--strong)",
                      }}
                    >
                      {litResult.percentile}
                      <span
                        style={{
                          fontSize: 24,
                          verticalAlign: "super",
                          color: "var(--muted)",
                        }}
                      >
                        th
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--muted)",
                        marginTop: 4,
                      }}
                    >
                      Percentile Rank
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ color: "var(--text)", fontSize: 13 }}>
                      {litResult.assessment}
                    </p>
                    <div
                      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                      {litResult.is_record && (
                        <span
                          style={{
                            background: "rgba(245,158,11,0.2)",
                            color: "#f59e0b",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "4px 12px",
                            borderRadius: 999,
                          }}
                        >
                          New Record
                        </span>
                      )}
                      <span
                        style={{
                          background: "var(--line)",
                          color: "var(--text)",
                          fontSize: 12,
                          padding: "4px 12px",
                          borderRadius: 999,
                        }}
                      >
                        Better than {litResult.better_than_pct}% of papers
                      </span>
                    </div>
                    {litResult.record_holder && (
                      <p style={{ fontSize: 12, color: "var(--muted)" }}>
                        Current record: {litResult.record_holder}
                      </p>
                    )}
                  </div>
                </div>

                {/* Similar papers table */}
                {(litResult.similar_papers ?? []).length > 0 && (
                  <div
                    style={{
                      background: "var(--surface)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <h3
                      style={{
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: 12,
                      }}
                    >
                      Similar Papers
                    </h3>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                        <thead>
                          <tr
                            style={{
                              color: "var(--muted)",
                              fontSize: 12,
                              borderBottom: "1px solid var(--line)",
                            }}
                          >
                            <th style={{ textAlign: "left", paddingBottom: 8 }}>
                              arXiv ID
                            </th>
                            <th style={{ textAlign: "left", paddingBottom: 8 }}>
                              Title
                            </th>
                            <th style={{ textAlign: "right", paddingBottom: 8 }}>
                              Value
                            </th>
                            <th style={{ textAlign: "right", paddingBottom: 8 }}>
                              Year
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(litResult.similar_papers ?? []).map((p, i) => (
                            <tr
                              key={i}
                              style={{
                                borderBottom:
                                  i < (litResult.similar_papers ?? []).length - 1
                                    ? "1px solid var(--line)"
                                    : "none",
                              }}
                            >
                              <td
                                style={{
                                  padding: "8px 0",
                                  color: "var(--strong)",
                                  fontFamily: "ui-monospace,monospace",
                                  fontSize: 12,
                                }}
                              >
                                {p.arxiv_id}
                              </td>
                              <td
                                style={{
                                  padding: "8px 0",
                                  color: "var(--text)",
                                  maxWidth: 320,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {p.title}
                              </td>
                              <td
                                style={{
                                  padding: "8px 0",
                                  textAlign: "right",
                                  color: "var(--text)",
                                }}
                              >
                                {p.value}
                              </td>
                              <td
                                style={{
                                  padding: "8px 0",
                                  textAlign: "right",
                                  color: "var(--muted)",
                                }}
                              >
                                {p.year}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
