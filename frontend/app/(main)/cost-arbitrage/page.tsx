"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getArbitrageRecommendation,
  getBackendQuotes,
  getMarketSnapshot,
  getArbitrageSavingsHistory,
  BackendQuote,
  ArbitrageRecommendation,
} from "../../../lib/api";

type SortKey = keyof BackendQuote;

function AvailabilityDot({ available }: { available: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: available ? "#10b981" : "#6b7280",
      marginRight: 4,
    }} />
  );
}

function QuotesTable({ quotes, highlightBackend }: { quotes: BackendQuote[]; highlightBackend?: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line)" }}>
            {["Backend", "Provider", "Cost/shot", "Min Shots", "Queue", "CX Err", "T1 (µs)", "Fidelity", "Avail"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "7px 10px", fontSize: 10, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quotes.map(q => (
            <tr
              key={q.backend}
              style={{
                borderBottom: "1px solid var(--line)",
                background: highlightBackend === q.backend ? "#6366f111" : "transparent",
              }}
            >
              <td style={{ padding: "7px 10px", fontWeight: highlightBackend === q.backend ? 700 : 400, color: highlightBackend === q.backend ? "#6366f1" : "inherit" }}>
                {highlightBackend === q.backend && <span style={{ marginRight: 4, fontSize: 10 }}>★</span>}
                {q.backend}
              </td>
              <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{q.provider}</td>
              <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>${q.cost_per_shot_usd.toFixed(6)}</td>
              <td style={{ padding: "7px 10px" }}>{q.min_shots.toLocaleString()}</td>
              <td style={{ padding: "7px 10px" }}>{q.queue_wait_min.toFixed(1)} min</td>
              <td style={{ padding: "7px 10px" }}>{(q.cx_error * 100).toFixed(3)}%</td>
              <td style={{ padding: "7px 10px" }}>{q.t1_us.toFixed(1)}</td>
              <td style={{ padding: "7px 10px", fontWeight: 600, color: q.fidelity_score > 0.95 ? "#10b981" : q.fidelity_score > 0.9 ? "#f59e0b" : "#ef4444" }}>
                {(q.fidelity_score * 100).toFixed(1)}%
              </td>
              <td style={{ padding: "7px 10px" }}>
                <AvailabilityDot available={q.available} />
                <span style={{ fontSize: 11 }}>{q.available ? "Yes" : "No"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavingsHistoryChart({ history }: { history: { rec_id: string; backend_chosen: string; savings_usd: number; date: string }[] }) {
  if (!history || history.length === 0) return <div style={{ color: "var(--muted)", fontSize: 13 }}>No savings data yet.</div>;
  const maxSav = Math.max(...history.map(h => h.savings_usd), 0.001);
  const BAR_H = 140, PAD = 32, BAR_W = Math.max(16, Math.min(40, Math.floor((600 - PAD * 2) / history.length) - 4));
  const W = Math.max(500, history.length * (BAR_W + 4) + PAD * 2);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={BAR_H + 40} style={{ display: "block" }}>
        {history.map((h, i) => {
          const barH = Math.max(2, (h.savings_usd / maxSav) * (BAR_H - 20));
          const x = PAD + i * (BAR_W + 4);
          const y = BAR_H - barH;
          return (
            <g key={h.rec_id}>
              <rect x={x} y={y} width={BAR_W} height={barH} fill="#6366f1" rx={2} opacity={0.85} />
              <title>{h.backend_chosen}: ${h.savings_usd.toFixed(4)}</title>
              <text x={x + BAR_W / 2} y={BAR_H + 12} fontSize={9} fill="#6b7280" textAnchor="middle" transform={`rotate(-30, ${x + BAR_W / 2}, ${BAR_H + 12})`}>
                {new Date(h.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </text>
            </g>
          );
        })}
        <text x={PAD - 4} y={20} fontSize={9} fill="#6b7280" textAnchor="end">${maxSav.toFixed(3)}</text>
        <text x={PAD - 4} y={BAR_H} fontSize={9} fill="#6b7280" textAnchor="end">$0</text>
        <line x1={PAD} y1={0} x2={PAD} y2={BAR_H} stroke="#374151" />
      </svg>
    </div>
  );
}

export default function CostArbitragePage() {
  const [marketQuotes, setMarketQuotes] = useState<BackendQuote[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [marketTakenAt, setMarketTakenAt] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cost_per_shot_usd");
  const [sortAsc, setSortAsc] = useState(true);

  const [recForm, setRecForm] = useState({
    circuit_description: "",
    n_shots: 1000,
    budget_usd: 1.0,
    target_fidelity: 0.95,
    prefer_speed: false,
  });
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");
  const [recommendation, setRecommendation] = useState<ArbitrageRecommendation | null>(null);

  const [quoteForm, setQuoteForm] = useState({ n_shots: 1000, circuit_depth: 20, n_qubits: 4 });
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState("");
  const [quickQuotes, setQuickQuotes] = useState<BackendQuote[]>([]);

  const [savingsHistory, setSavingsHistory] = useState<{ rec_id: string; backend_chosen: string; savings_usd: number; date: string }[]>([]);
  const [savingsLoading, setSavingsLoading] = useState(true);

  const loadMarket = useCallback(async () => {
    setMarketLoading(true);
    try {
      const snap = await getMarketSnapshot();
      setMarketQuotes(snap.quotes);
      setMarketTakenAt(snap.taken_at);
      setMarketError("");
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : "Failed to load market");
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const loadSavings = useCallback(async () => {
    setSavingsLoading(true);
    try {
      const hist = await getArbitrageSavingsHistory();
      setSavingsHistory(hist);
    } catch (_) {
      // non-critical
    } finally {
      setSavingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket();
    void loadSavings();
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortedMarket = [...marketQuotes].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const handleGetRecommendation = async () => {
    if (!recForm.circuit_description.trim()) { setRecError("Circuit description is required"); return; }
    setRecLoading(true);
    setRecError("");
    try {
      const rec = await getArbitrageRecommendation({
        circuit_description: recForm.circuit_description,
        n_shots: recForm.n_shots,
        budget_usd: recForm.budget_usd,
        target_fidelity: recForm.target_fidelity,
        prefer_speed: recForm.prefer_speed,
      });
      setRecommendation(rec);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : "Failed to get recommendation");
    } finally {
      setRecLoading(false);
    }
  };

  const handleGetQuotes = async () => {
    setQuotesLoading(true);
    setQuotesError("");
    try {
      const qs = await getBackendQuotes({
        n_shots: quoteForm.n_shots,
        circuit_depth: quoteForm.circuit_depth,
        n_qubits: quoteForm.n_qubits,
      });
      setQuickQuotes(qs);
    } catch (e) {
      setQuotesError(e instanceof Error ? e.message : "Failed to get quotes");
    } finally {
      setQuotesLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Backend Cost Arbitrage</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          Auto-route experiments to the cheapest backend that meets fidelity and speed requirements.
        </p>
      </div>

      {/* Market snapshot */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Market Snapshot</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {marketTakenAt && <span style={{ fontSize: 11, color: "var(--muted)" }}>as of {new Date(marketTakenAt).toLocaleTimeString()}</span>}
            <button className="button secondary" onClick={() => void loadMarket()} disabled={marketLoading} style={{ height: 28, fontSize: 12 }}>
              {marketLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {marketError ? (
          <div style={{ padding: 16, color: "#b91c1c", fontSize: 13 }}>{marketError}</div>
        ) : marketLoading && marketQuotes.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading market data…</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {(["backend", "provider", "cost_per_shot_usd", "fidelity_score", "cx_error", "t1_us", "queue_wait_min", "available"] as SortKey[]).map(k => (
                    <th
                      key={k}
                      onClick={() => handleSort(k)}
                      style={{ textAlign: "left", padding: "7px 10px", fontSize: 10, color: sortKey === k ? "#6366f1" : "var(--muted)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
                    >
                      {k.replace(/_/g, " ")} {sortKey === k ? (sortAsc ? "▲" : "▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMarket.map(q => (
                  <tr key={q.backend} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{q.backend}</td>
                    <td style={{ padding: "7px 10px", color: "var(--muted)" }}>{q.provider}</td>
                    <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>${q.cost_per_shot_usd.toFixed(6)}</td>
                    <td style={{ padding: "7px 10px", fontWeight: 600, color: q.fidelity_score > 0.95 ? "#10b981" : q.fidelity_score > 0.9 ? "#f59e0b" : "#ef4444" }}>
                      {(q.fidelity_score * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: "7px 10px" }}>{(q.cx_error * 100).toFixed(3)}%</td>
                    <td style={{ padding: "7px 10px" }}>{q.t1_us.toFixed(1)}</td>
                    <td style={{ padding: "7px 10px" }}>{q.queue_wait_min.toFixed(1)} min</td>
                    <td style={{ padding: "7px 10px" }}>
                      <AvailabilityDot available={q.available} />
                      {q.available ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recommendation form */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Get Recommendation</h2></div>
        <div style={{ padding: 16 }}>
          {recError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>{recError}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Circuit Description</span>
              <input className="input" value={recForm.circuit_description}
                onChange={e => setRecForm(f => ({ ...f, circuit_description: e.target.value }))}
                placeholder="e.g. 4-qubit VQE ansatz with 20 depth" style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Shots</span>
              <input className="input" type="number" min={100} value={recForm.n_shots}
                onChange={e => setRecForm(f => ({ ...f, n_shots: Number(e.target.value) }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Budget (USD)</span>
              <input className="input" type="number" step="0.01" min={0} value={recForm.budget_usd}
                onChange={e => setRecForm(f => ({ ...f, budget_usd: parseFloat(e.target.value) }))} style={{ height: 34 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                Target Fidelity: <strong style={{ color: "var(--text)" }}>{recForm.target_fidelity.toFixed(2)}</strong>
              </span>
              <input type="range" min={0.8} max={1.0} step={0.01} value={recForm.target_fidelity}
                onChange={e => setRecForm(f => ({ ...f, target_fidelity: parseFloat(e.target.value) }))}
                style={{ accentColor: "#6366f1" }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={recForm.prefer_speed}
                onChange={e => setRecForm(f => ({ ...f, prefer_speed: e.target.checked }))}
                style={{ accentColor: "#6366f1", width: 16, height: 16 }} />
              <span style={{ fontSize: 13 }}>Prefer Speed</span>
            </label>
          </div>
          <button className="button" onClick={() => void handleGetRecommendation()} disabled={recLoading} style={{ height: 36 }}>
            {recLoading ? "Analysing…" : "Get Recommendation"}
          </button>

          {recommendation && (
            <div style={{ marginTop: 20 }}>
              {/* Winner card */}
              <div style={{
                marginBottom: 16, padding: 16, borderRadius: 8,
                background: "linear-gradient(135deg, #6366f122, #10b98111)",
                border: "1px solid #6366f144",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 2 }}>Recommended Backend</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#6366f1" }}>{recommendation.winner_backend}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{recommendation.reasoning}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Savings vs Default</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>
                      ${recommendation.savings_vs_default_usd.toFixed(4)}
                    </div>
                    <div style={{ fontSize: 13, color: "#10b981" }}>({recommendation.savings_pct.toFixed(1)}% cheaper)</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>All Quotes (sorted by fidelity)</div>
              <QuotesTable quotes={[...recommendation.all_quotes].sort((a, b) => b.fidelity_score - a.fidelity_score)} highlightBackend={recommendation.winner_backend} />
            </div>
          )}
        </div>
      </div>

      {/* Quick quote tool */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header"><h2>Quick Quote Tool</h2></div>
        <div style={{ padding: 16 }}>
          {quotesError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#fee2e2", borderRadius: 6, color: "#b91c1c", fontSize: 13 }}>{quotesError}</div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
            {[
              { label: "Shots", key: "n_shots" as const, min: 1 },
              { label: "Circuit Depth", key: "circuit_depth" as const, min: 1 },
              { label: "Qubits", key: "n_qubits" as const, min: 1, max: 127 },
            ].map(({ label, key, min, max }) => (
              <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{label}</span>
                <input className="input" type="number" min={min} max={max} value={quoteForm[key]}
                  onChange={e => setQuoteForm(f => ({ ...f, [key]: Number(e.target.value) }))} style={{ height: 34, width: 110 }} />
              </label>
            ))}
            <button className="button" onClick={() => void handleGetQuotes()} disabled={quotesLoading} style={{ height: 34 }}>
              {quotesLoading ? "Fetching…" : "Get Quotes"}
            </button>
          </div>
          {quickQuotes.length > 0 && <QuotesTable quotes={quickQuotes} />}
        </div>
      </div>

      {/* Savings history */}
      <div className="panel">
        <div className="panel-header"><h2>Savings History</h2></div>
        <div style={{ padding: 16 }}>
          {savingsLoading ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading history…</div>
          ) : (
            <SavingsHistoryChart history={savingsHistory} />
          )}
          {!savingsLoading && savingsHistory.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Total saved: <strong style={{ color: "var(--text)" }}>
                ${savingsHistory.reduce((s, h) => s + h.savings_usd, 0).toFixed(4)}
              </strong> across {savingsHistory.length} recommendations
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
