"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Cpu, Loader, Info, GitCompare } from "lucide-react";
import { findSimilarRuns, embedAllRuns, checkUnitaryFidelity, type SimilarRunsResponse, type SimilarRunResult, type UnitaryFidelityResult } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth";

function SimBadge({ sim }: { sim: number }) {
  const pct = Math.round(sim * 100);
  const color = sim >= 0.95 ? "#27ae60" : sim >= 0.85 ? "#1d6f8f" : sim >= 0.75 ? "#e67e22" : "#888";
  const label = sim >= 0.95 ? "Near-identical" : sim >= 0.85 ? "Very similar" : sim >= 0.75 ? "Similar" : "Partial match";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 48, height: 6, background: "#e8ecf0", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 28 }}>{pct}%</span>
      <span style={{ fontSize: 11, color: "#aaa" }}>{label}</span>
    </div>
  );
}

function DeltaChip({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  const sign = value > 0 ? "+" : "";
  const color = value > 0 ? "#e74c3c" : "#27ae60";
  return (
    <span style={{ fontSize: 11, background: "#f4f6f9", padding: "2px 6px", borderRadius: 4, color, fontFamily: "monospace" }}>
      {label} {sign}{value}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const isWL = method === "wl_gnn";
  return (
    <span style={{
      fontSize: 10, padding: "1px 6px", borderRadius: 10, fontWeight: 600,
      background: isWL ? "#f0eaff" : "#f4f4f4",
      color: isWL ? "#7c3aed" : "#888",
    }}>
      {isWL ? "WL-GNN" : "structural"}
    </span>
  );
}

function ResultCard({
  r,
  anchorId,
  onVerify,
}: {
  r: SimilarRunResult;
  anchorId: string;
  onVerify: (otherId: string) => void;
}) {
  const d = r.fingerprint_delta;
  const hasDelta = d.depth !== 0 || d.size !== 0 || d.num_qubits !== 0 || d.nc_ratio !== 0;
  const healthColor = r.health_score !== null
    ? (r.health_score >= 70 ? "#27ae60" : r.health_score >= 40 ? "#e67e22" : "#e74c3c")
    : "#bbb";

  return (
    <div className="panel" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Link href={`/runs/${r.run_id}`} style={{ fontWeight: 700, fontSize: 14, color: "#1d6f8f", fontFamily: "monospace", textDecoration: "none" }}>
              {r.circuit_name || r.run_id.slice(0, 12)}
            </Link>
            {r.has_qasm
              ? <span style={{ fontSize: 10, background: "#eaf6ef", color: "#1f8a5b", padding: "1px 6px", borderRadius: 10, fontWeight: 600 }}>QASM</span>
              : <span style={{ fontSize: 10, background: "#f4f4f4", color: "#888", padding: "1px 6px", borderRadius: 10 }}>fingerprint</span>
            }
            <MethodBadge method={r.embedding_method} />
            {r.health_score !== null && (
              <span style={{ fontSize: 12, fontWeight: 700, color: healthColor, marginLeft: "auto" }}>
                ⬡ {r.health_score}
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: "#5f6f80", marginBottom: 6 }}>
            {r.backend && <span style={{ marginRight: 10 }}><Cpu size={11} style={{ verticalAlign: "middle" }} /> {r.backend}</span>}
            {r.project && <span style={{ marginRight: 10 }}>{r.project}</span>}
            <span style={{ color: "#bbb" }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</span>
          </div>

          <SimBadge sim={r.similarity} />

          {hasDelta && (
            <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "#aaa", marginRight: 2 }}>vs anchor:</span>
              <DeltaChip label="depth" value={d.depth} />
              <DeltaChip label="size" value={d.size} />
              <DeltaChip label="qubits" value={d.num_qubits} />
              {d.nc_ratio !== 0 && (
                <span style={{ fontSize: 11, background: "#f4f6f9", padding: "2px 6px", borderRadius: 4, color: d.nc_ratio > 0 ? "#e74c3c" : "#27ae60", fontFamily: "monospace" }}>
                  NC {d.nc_ratio > 0 ? "+" : ""}{(d.nc_ratio * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {r.tags.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {r.tags.slice(0, 4).map(t => (
                <span key={t} style={{ fontSize: 11, background: "#ebf5fb", color: "#1d6f8f", padding: "2px 7px", borderRadius: 10 }}>{t}</span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <Link href={`/search/circuits?anchor=${r.run_id}`} title="Search from this run" style={{ fontSize: 12, color: "#1d6f8f", textDecoration: "none", background: "#f0f4f8", padding: "4px 10px", borderRadius: 5 }}>
            Use as anchor →
          </Link>
          {r.has_qasm && anchorId && (
            <button
              onClick={() => onVerify(r.run_id)}
              title="Verify exact semantic equivalence via unitary matrix (≤8 qubits)"
              style={{ fontSize: 11, color: "#7c3aed", background: "#f0eaff", border: "none", padding: "4px 10px", borderRadius: 5, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            >
              <GitCompare size={11} /> Verify equiv.
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CircuitSearchPageWrapper() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
      <CircuitSearchPage />
    </Suspense>
  );
}

function CircuitSearchPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [anchorId, setAnchorId] = useState(searchParams.get("anchor") ?? "");
  const [minSim, setMinSim] = useState(0.70);
  const [topN, setTopN] = useState(15);
  const [filterProject, setFilterProject] = useState("");
  const [filterBackend, setFilterBackend] = useState("");
  const [sameQubits, setSameQubits] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimilarRunsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embedStatus, setEmbedStatus] = useState<string | null>(null);
  const [fidelityResult, setFidelityResult] = useState<UnitaryFidelityResult | null>(null);
  const [fidelityLoading, setFidelityLoading] = useState(false);
  const [fidelityError, setFidelityError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!anchorId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await findSimilarRuns(anchorId.trim(), {
        n: topN,
        min_sim: minSim,
        project: filterProject || undefined,
        backend: filterBackend || undefined,
        same_qubits: sameQubits,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(otherId: string) {
    if (!anchorId) return;
    setFidelityLoading(true);
    setFidelityResult(null);
    setFidelityError(null);
    try {
      const r = await checkUnitaryFidelity(anchorId, otherId);
      setFidelityResult(r);
    } catch (err) {
      setFidelityError(err instanceof Error ? err.message : "Equivalence check failed");
    } finally {
      setFidelityLoading(false);
    }
  }

  async function handleEmbedAll() {
    setEmbedStatus("Embedding…");
    try {
      const r = await embedAllRuns(500);
      setEmbedStatus(`Done — ${r.queued} newly embedded, ${r.already_embedded} already cached`);
    } catch {
      setEmbedStatus("Embedding failed");
    }
  }

  // Sync URL anchor param changes (e.g. "Use as anchor" links)
  useEffect(() => {
    const a = searchParams.get("anchor");
    if (a) setAnchorId(a);
  }, [searchParams]);

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={17} /> Semantic Circuit Search
          </h2>
          {user && (
            <button className="button secondary" style={{ height: 30, fontSize: 12 }} onClick={handleEmbedAll}>
              Embed All Runs
            </button>
          )}
        </div>

        <div style={{ padding: "10px 18px 4px", background: "#f7f8fa", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#5f6f80" }}>
            <Info size={12} />
            Uses a Weisfeiler-Lehman GNN on the Qiskit circuit DAG — 3 rounds of gate-predecessor aggregation
            capture causal topology, not just aggregate stats. Fingerprint-only runs fall back to structural matching.
          </div>
        </div>

        <form onSubmit={handleSearch} style={{ padding: "14px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 10, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Anchor run ID *</label>
              <input
                className="input"
                value={anchorId}
                onChange={e => setAnchorId(e.target.value)}
                placeholder="Paste a run_id to find similar circuits"
                required
                style={{ width: "100%", fontFamily: "monospace" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Min similarity</label>
              <select className="input" value={minSim} onChange={e => setMinSim(Number(e.target.value))} style={{ width: "100%" }}>
                <option value={0.95}>≥ 95% (near-identical)</option>
                <option value={0.85}>≥ 85% (very similar)</option>
                <option value={0.70}>≥ 70% (similar)</option>
                <option value={0.50}>≥ 50% (loose)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Project filter</label>
              <input className="input" value={filterProject} onChange={e => setFilterProject(e.target.value)} placeholder="(all)" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Backend filter</label>
              <input className="input" value={filterBackend} onChange={e => setFilterBackend(e.target.value)} placeholder="(all)" style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Top N</label>
                <input className="input" type="number" value={topN} min={1} max={50} onChange={e => setTopN(Number(e.target.value))} style={{ width: "100%" }} />
              </div>
              <button className="button" type="submit" disabled={loading} style={{ flexShrink: 0, height: 36, width: 36, padding: 0 }}>
                {loading ? <Loader size={15} /> : <Search size={15} />}
              </button>
            </div>
          </div>

          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 10, cursor: "pointer", width: "fit-content" }}>
            <input type="checkbox" checked={sameQubits} onChange={e => setSameQubits(e.target.checked)} />
            Only same qubit count
          </label>
        </form>

        {embedStatus && (
          <div style={{ padding: "8px 18px", fontSize: 12, color: "#5f6f80", borderTop: "1px solid var(--border)" }}>
            {embedStatus}
          </div>
        )}
      </section>

      {error && (
        <div className="panel" style={{ padding: "12px 18px", background: "#fdecea", border: "1px solid #f5c3c3", fontSize: 13, color: "#c0392b" }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <div style={{ fontWeight: 700 }}>
                  {result.result_count} similar circuits found
                  <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)", marginLeft: 8 }}>
                    (scanned {result.candidates_scanned} runs)
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Anchor: <Link href={`/runs/${result.anchor_run_id}`} style={{ color: "#1d6f8f", fontFamily: "monospace" }}>
                    {result.anchor_circuit_name || result.anchor_run_id.slice(0, 12)}
                  </Link>
                  {" "}on {result.anchor_backend || "unknown"}
                  {" "}· embedding:{" "}
                  <strong style={{ color: result.embedding_source === "wl_gnn" ? "#7c3aed" : undefined }}>
                    {result.embedding_source === "wl_gnn" ? "WL-GNN" : result.embedding_source}
                  </strong>
                  {result.embedding_source !== "wl_gnn" && (
                    <span style={{ color: "#e67e22", marginLeft: 6 }}>
                      ⚠ No QASM — submit runs with QASM to enable WL-GNN graph matching.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {fidelityLoading && (
            <div className="panel" style={{ padding: "10px 18px", fontSize: 13, color: "#7c3aed" }}>
              <Loader size={13} style={{ verticalAlign: "middle", marginRight: 6 }} /> Computing unitary fidelity…
            </div>
          )}
          {fidelityError && (
            <div className="panel" style={{ padding: "10px 18px", fontSize: 13, color: "#c0392b", background: "#fdecea", border: "1px solid #f5c3c3" }}>
              {fidelityError}
            </div>
          )}
          {fidelityResult && !fidelityLoading && (
            <div className="panel" style={{ padding: "12px 18px", borderLeft: `4px solid ${fidelityResult.equivalent ? "#27ae60" : "#e67e22"}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                {fidelityResult.equivalent
                  ? "Circuits are semantically equivalent (up to global phase)"
                  : "Circuits are NOT equivalent"}
              </div>
              <div style={{ fontSize: 12, color: "#5f6f80" }}>
                Unitary fidelity: <strong>{(fidelityResult.fidelity * 100).toFixed(4)}%</strong>
                {fidelityResult.num_qubits && <span style={{ marginLeft: 8 }}> · {fidelityResult.num_qubits} qubits · 2^{fidelityResult.num_qubits} × 2^{fidelityResult.num_qubits} matrix</span>}
                {fidelityResult.note && <span style={{ marginLeft: 8, color: "#e67e22" }}> · {fidelityResult.note}</span>}
              </div>
            </div>
          )}

          {result.results.length === 0 ? (
            <div className="empty">No circuits found above the similarity threshold. Try lowering the minimum similarity or removing filters.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.results.map(r => (
                <ResultCard key={r.run_id} r={r} anchorId={anchorId} onVerify={handleVerify} />
              ))}
            </div>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="panel" style={{ padding: "40px 24px", textAlign: "center" }}>
          <Search size={40} style={{ color: "#ccd", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Find structurally similar circuits</div>
          <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 520, margin: "0 auto", lineHeight: 1.65 }}>
            Paste any run ID to find circuits with similar gate composition and structure across your entire experiment history.
            Works even across different backends and parameters.
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: "#bbb" }}>
            WL-GNN: 3-round Weisfeiler-Lehman message passing on the Qiskit DAGCircuit → 64-dim embedding.
            Captures gate connectivity, not just histogram. Fallback: structural features from fingerprint.
          </div>
        </div>
      )}
    </main>
  );
}
