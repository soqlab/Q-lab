"use client";
import { useState, useEffect } from "react";
import { submitReplicationClaim, attemptReplication, listReplicationClaims, ReplicationClaim } from "@/lib/api";

const badgeStyle: Record<string, Record<string, string>> = {
  gold: { background: "#eab308", color: "#713f12" },
  silver: { background: "#9ca3af", color: "#111827" },
  contested: { background: "rgba(239,68,68,0.1)", color: "var(--danger)" },
  pending: { background: "var(--line)", color: "var(--text)" },
};

const statusColorMap: Record<string, string> = {
  open: "var(--info-text)",
  replicated: "var(--ok)",
  contested: "var(--danger)",
  failed: "#f97316",
};

export default function ReplicationPage() {
  const [claims, setClaims] = useState<ReplicationClaim[]>([]);
  const [selected, setSelected] = useState<ReplicationClaim | null>(null);
  const [showClaim, setShowClaim] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [claimForm, setClaimForm] = useState({ title: "", original_value: 0.95, metric: "fidelity", description: "", backend: "ibm_brisbane", n_qubits: 5 });
  const [attemptForm, setAttemptForm] = useState({ your_value: 0.0, notes: "" });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await listReplicationClaims();
      setClaims(r.claims);
    } catch { /* ignore */ }
  }

  async function submitClaim() {
    setLoading(true); setError("");
    try {
      await submitReplicationClaim({ title: claimForm.title, original_value: claimForm.original_value, metric: claimForm.metric, description: claimForm.description, backend: claimForm.backend, n_qubits: claimForm.n_qubits });
      setShowClaim(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function attempt() {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      await attemptReplication({ claim_id: selected.claim_id, your_value: attemptForm.your_value, notes: attemptForm.notes });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Replication Market</h1>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Track replication attempts for quantum results. Claims earn Gold/Silver/Contested badges based on independent reproductions.</p>
        </div>
        <button onClick={() => setShowClaim(!showClaim)}
          style={{ padding: "8px 16px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, border: "none", color: "var(--text)", cursor: "pointer" }}>
          + New Claim
        </button>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {showClaim && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontWeight: 600 }}>New Replication Claim</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Claim Title</label>
              <input value={claimForm.title} onChange={e => setClaimForm(f => ({ ...f, title: e.target.value }))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Metric</label>
              <select value={claimForm.metric} onChange={e => setClaimForm(f => ({ ...f, metric: e.target.value }))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }}>
                {["fidelity", "energy", "approximation_ratio", "error_rate", "t2_us"].map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Original Value</label>
              <input type="number" step="any" value={claimForm.original_value} onChange={e => setClaimForm(f => ({ ...f, original_value: Number(e.target.value) }))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Backend</label>
              <input value={claimForm.backend} onChange={e => setClaimForm(f => ({ ...f, backend: e.target.value }))}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Description</label>
              <textarea value={claimForm.description} onChange={e => setClaimForm(f => ({ ...f, description: e.target.value }))} rows={2}
                style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={submitClaim} disabled={loading || !claimForm.title}
              style={{ padding: "8px 16px", background: "rgba(16,185,129,0.1)", borderRadius: 6, fontSize: 13, opacity: (loading || !claimForm.title) ? 0.5 : 1, border: "1px solid var(--ok)", color: "var(--ok)", cursor: (loading || !claimForm.title) ? "not-allowed" : "pointer" }}>
              Submit
            </button>
            <button onClick={() => setShowClaim(false)}
              style={{ padding: "8px 16px", background: "var(--line)", borderRadius: 6, fontSize: 13, border: "none", color: "var(--text)", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", textTransform: "uppercase" }}>Claims</h2>
          {(claims ?? []).map(c => (
            <div key={c.claim_id} onClick={() => setSelected(c)}
              style={{ background: "var(--surface)", borderRadius: 8, padding: 12, cursor: "pointer", border: selected?.claim_id === c.claim_id ? "1px solid var(--strong)" : "1px solid transparent" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                {c.badge && (
                  <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, flexShrink: 0, ...(badgeStyle[c.badge] ?? { background: "var(--line)", color: "var(--text)" }) }}>
                    {c.badge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, fontFamily: "ui-monospace,monospace" }}>
                {c.metric}: {c.original_value.toFixed(4)} → {c.consensus_value !== null ? c.consensus_value.toFixed(4) : "—"}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: statusColorMap[c.status] ?? "var(--muted)" }}>
                {c.status} · {c.replication_count} attempt{c.replication_count !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                <h2 style={{ fontWeight: 700, fontSize: 18 }}>{selected.title}</h2>
                {selected.badge && (
                  <span style={{ fontSize: 13, padding: "4px 12px", borderRadius: 999, fontWeight: 700, flexShrink: 0, ...(badgeStyle[selected.badge] ?? { background: "var(--line)" }) }}>
                    {selected.badge.toUpperCase()} BADGE
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, fontSize: 13 }}>
                <div style={{ background: "var(--surface)", borderRadius: 6, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Original</div>
                  <div style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "var(--text)" }}>{selected.original_value.toFixed(4)}</div>
                </div>
                <div style={{ background: "var(--surface)", borderRadius: 6, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Consensus</div>
                  <div style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: "var(--strong)" }}>{selected.consensus_value !== null ? selected.consensus_value.toFixed(4) : "—"}</div>
                </div>
                <div style={{ background: "var(--surface)", borderRadius: 6, padding: 12, textAlign: "center", border: "1px solid var(--line)" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Replication Rate</div>
                  <div style={{ fontWeight: 500, color: selected.replication_rate > 0.7 ? "var(--ok)" : "var(--danger)" }}>{(selected.replication_rate * 100).toFixed(0)}%</div>
                </div>
              </div>
              {selected.description && <div style={{ fontSize: 13, color: "var(--text)" }}>{selected.description}</div>}
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{selected.backend} · {selected.n_qubits} qubits · {selected.metric}</div>

              {selected.attempts && (selected.attempts as { your_value?: number; notes?: string }[]).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <h3 style={{ fontWeight: 600, fontSize: 13 }}>Replication Attempts ({selected.replication_count})</h3>
                  {(selected.attempts as { your_value?: number; notes?: string; backend?: string }[]).map((a, i) => (
                    <div key={i} style={{ background: "var(--surface)", borderRadius: 6, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--line)" }}>
                      <div>
                        <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 13, color: "var(--text)" }}>{a.your_value?.toFixed(4) ?? "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{a.backend} · {a.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ fontWeight: 600, fontSize: 13 }}>Submit Replication Attempt</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>Your Value ({selected.metric})</label>
                  <input type="number" step="any" value={attemptForm.your_value} onChange={e => setAttemptForm(f => ({ ...f, your_value: Number(e.target.value) }))}
                    style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", fontFamily: "ui-monospace,monospace", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>Notes</label>
                  <input value={attemptForm.notes} onChange={e => setAttemptForm(f => ({ ...f, notes: e.target.value }))}
                    style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 13, boxSizing: "border-box" }} />
                </div>
              </div>
              <button onClick={attempt} disabled={loading}
                style={{ padding: "8px 16px", background: "var(--strong)", borderRadius: 6, fontSize: 13, opacity: loading ? 0.5 : 1, border: "none", color: "var(--text)", cursor: loading ? "not-allowed" : "pointer" }}>
                Submit Attempt
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
