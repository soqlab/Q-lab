"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Incident {
  name: string;
  status: string;
  impact: string;
  created_at: string;
  shortlink: string;
}

interface ProviderStatus {
  id: string;
  name: string;
  color: string;
  status: "operational" | "degraded" | "outage" | "maintenance" | "unknown";
  description: string;
  incidents: Incident[];
  last_checked: number;
  cache_age_s: number;
  dashboard_url: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  operational: { label: "OPERATIONAL", color: "#00e887", glow: "rgba(0,232,135,0.35)" },
  degraded:    { label: "DEGRADED",    color: "#ffaa00", glow: "rgba(255,170,0,0.35)" },
  outage:      { label: "OUTAGE",      color: "#ff3838", glow: "rgba(255,56,56,0.45)" },
  maintenance: { label: "MAINTENANCE", color: "#00d4ff", glow: "rgba(0,212,255,0.35)" },
  unknown:     { label: "UNKNOWN",     color: "#6b7f8f", glow: "rgba(107,127,143,0.25)" },
};

function fmtTs(epoch: number) {
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtIso(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function overallHealth(providers: ProviderStatus[]) {
  if (providers.some(p => p.status === "outage")) return "outage";
  if (providers.some(p => p.status === "degraded")) return "degraded";
  if (providers.every(p => p.status === "operational")) return "operational";
  if (providers.some(p => p.status === "maintenance")) return "maintenance";
  return "unknown";
}

// ─── StatusDot ────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: ProviderStatus["status"] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10, borderRadius: "50%",
      background: cfg.color,
      boxShadow: status === "operational" ? `0 0 6px ${cfg.glow}, 0 0 12px ${cfg.glow}` : `0 0 6px ${cfg.glow}`,
      animation: status === "operational" ? "pulse-ok 2.4s ease-in-out infinite" : "none",
      flexShrink: 0,
    }} />
  );
}

// ─── ProviderCard ─────────────────────────────────────────────────────────────
function ProviderCard({ p }: { p: ProviderStatus }) {
  const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.unknown;
  const [exp, setExp] = useState(false);

  return (
    <div style={{
      border: `1px solid ${cfg.color}44`,
      borderLeft: `3px solid ${cfg.color}`,
      background: "var(--intel-card-bg)",
      borderRadius: 4,
      padding: "14px 16px",
      fontFamily: "'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      cursor: p.incidents.length > 0 ? "pointer" : "default",
      transition: "border-color 0.2s, box-shadow 0.2s",
      boxShadow: `0 0 0 0 transparent`,
    }}
    onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 12px ${cfg.glow}`)}
    onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
    onClick={() => p.incidents.length > 0 && setExp(x => !x)}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 4, background: p.color + "22",
          border: `1px solid ${p.color}55`, display: "grid", placeItems: "center",
          fontSize: 10, fontWeight: 700, color: p.color, letterSpacing: 0.5,
        }}>
          {p.id.slice(0, 3).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: "var(--intel-text-hi)", fontSize: 14 }}>{p.name}</div>
          <div style={{ color: "var(--intel-text-lo)", fontSize: 11 }}>{p.description}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot status={p.status} />
          <span style={{ color: cfg.color, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: 16, color: "var(--intel-text-lo)", fontSize: 11 }}>
        <span>CHECKED {fmtTs(p.last_checked)}</span>
        {p.cache_age_s > 0 && <span>CACHE {p.cache_age_s}s</span>}
        {p.incidents.length > 0 && (
          <span style={{ color: "#ffaa00" }}>
            {p.incidents.length} INCIDENT{p.incidents.length > 1 ? "S" : ""} {exp ? "▲" : "▼"}
          </span>
        )}
        <a
          href={p.dashboard_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ color: "var(--intel-accent)", marginLeft: "auto" }}
        >
          DASHBOARD ↗
        </a>
      </div>

      {/* Incidents */}
      {exp && p.incidents.map((inc, i) => (
        <div key={i} style={{
          marginTop: 10,
          padding: "8px 10px",
          background: "rgba(255,170,0,0.06)",
          border: "1px solid rgba(255,170,0,0.2)",
          borderRadius: 3,
          fontSize: 11,
        }}>
          <div style={{ color: "#ffaa00", fontWeight: 700, marginBottom: 3 }}>
            [{inc.impact.toUpperCase()}] {inc.name}
          </div>
          <div style={{ color: "var(--intel-text-lo)" }}>
            STATUS: {inc.status.toUpperCase()} · {fmtIso(inc.created_at)}
            {inc.shortlink && (
              <a href={inc.shortlink} target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--intel-accent)", marginLeft: 8 }}>
                VIEW ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SweepBar ─────────────────────────────────────────────────────────────────
function SweepBar({ active }: { active: boolean }) {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 2,
      background: "linear-gradient(90deg, transparent, #00d4ff, transparent)",
      opacity: active ? 1 : 0,
      animation: active ? "sweep 1.8s ease-in-out" : "none",
      pointerEvents: "none",
    }} />
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IntelPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setSweeping(true);
    try {
      const res = await fetch(apiUrl("/api/v1/intel/hardware-status"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
        setLastRefresh(new Date());
      }
    } finally {
      setLoading(false);
      setTimeout(() => setSweeping(false), 1900);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(refresh, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  const health = providers.length > 0 ? overallHealth(providers) : "unknown";
  const healthCfg = STATUS_CONFIG[health];
  const ops = providers.filter(p => p.status === "operational").length;
  const totalIncidents = providers.reduce((n, p) => n + p.incidents.length, 0);

  return (
    <>
      <style>{`
        :root {
          --intel-bg: #060c14;
          --intel-panel: #0a1220;
          --intel-card-bg: #0d1628;
          --intel-border: #162030;
          --intel-text-hi: #c8d8e8;
          --intel-text-lo: #4a6070;
          --intel-accent: #00d4ff;
          --intel-ok: #00e887;
        }

        @keyframes pulse-ok {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(0,232,135,0.35), 0 0 12px rgba(0,232,135,0.35); }
          50% { opacity: 0.7; box-shadow: 0 0 3px rgba(0,232,135,0.15), 0 0 6px rgba(0,232,135,0.15); }
        }
        @keyframes sweep {
          0% { transform: translateX(-100%); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateX(100%); opacity: 0; }
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; } 50% { opacity: 0; }
        }
        .intel-cursor::after {
          content: "▮";
          animation: blink-cursor 1s step-end infinite;
          color: var(--intel-accent);
          margin-left: 2px;
        }
      `}</style>

      <main className="page" style={{
        background: "var(--intel-bg)",
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Cascadia Code', Consolas, monospace",
      }}>
        {/* Sweep bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden" }}>
          <SweepBar active={sweeping} />
        </div>

        {/* Header */}
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              fontFamily: "'Cascadia Code', Consolas, monospace",
              fontSize: 11,
              color: "var(--intel-accent)",
              letterSpacing: 2,
              fontWeight: 700,
            }}>
              QUANTUM INTEL // HARDWARE STATUS MONITOR
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 5, marginLeft: "auto",
              fontSize: 11, color: "var(--intel-text-lo)",
            }}>
              <StatusDot status={health} />
              <span style={{ color: healthCfg.color, fontWeight: 700 }}>
                {ops}/{providers.length} NOMINAL
              </span>
            </div>
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: "var(--intel-text-hi)", letterSpacing: 1,
          }} className="intel-cursor">
            Hardware Intel Feed
          </div>
          <div style={{ color: "var(--intel-text-lo)", fontSize: 12 }}>
            Live status intelligence from public quantum hardware provider APIs
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}>
          {[
            { label: "PROVIDERS TRACKED", value: providers.length || "—" },
            { label: "NOMINAL", value: ops || "—", accent: "#00e887" },
            { label: "ACTIVE INCIDENTS", value: totalIncidents, accent: totalIncidents > 0 ? "#ffaa00" : "#00e887" },
            { label: "OVERALL STATUS", value: healthCfg.label, accent: healthCfg.color },
          ].map(s => (
            <div key={s.label} style={{
              background: "var(--intel-panel)",
              border: "1px solid var(--intel-border)",
              borderRadius: 4,
              padding: "12px 14px",
            }}>
              <div style={{ fontSize: 10, color: "var(--intel-text-lo)", letterSpacing: 1, marginBottom: 4 }}>
                {s.label}
              </div>
              <div style={{
                fontSize: 22, fontWeight: 700,
                color: s.accent ?? "var(--intel-text-hi)",
                fontFamily: "'Cascadia Code', Consolas, monospace",
              }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={refresh}
            disabled={sweeping}
            style={{
              fontFamily: "'Cascadia Code', Consolas, monospace",
              fontSize: 11, letterSpacing: 1,
              background: "transparent",
              border: "1px solid var(--intel-accent)",
              color: "var(--intel-accent)",
              borderRadius: 3, padding: "6px 14px", cursor: "pointer",
              opacity: sweeping ? 0.5 : 1,
            }}
          >
            {sweeping ? "SCANNING..." : "↻ RESCAN"}
          </button>
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: "var(--intel-text-lo)", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ accentColor: "var(--intel-accent)" }}
            />
            AUTO 30s
          </label>
          {lastRefresh && (
            <span style={{ fontSize: 11, color: "var(--intel-text-lo)", marginLeft: "auto" }}>
              LAST SCAN {lastRefresh.toLocaleTimeString([], { hour12: false })}
            </span>
          )}
        </div>

        {/* Provider grid */}
        {loading ? (
          <div style={{ color: "var(--intel-accent)", fontSize: 13, letterSpacing: 1 }}>
            INITIALIZING INTEL FEED...
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {providers.map(p => <ProviderCard key={p.id} p={p} />)}
          </div>
        )}

        {/* Footer note */}
        <div style={{ fontSize: 11, color: "var(--intel-text-lo)", borderTop: "1px solid var(--intel-border)", paddingTop: 12 }}>
          DATA SOURCES: Public Atlassian StatusPage APIs (status.ionq.co, status.rigetti.com, status.quantum.ibm.com, status.quantinuum.com) · AWS Health Dashboard · Cached 5 min
        </div>
      </main>
    </>
  );
}
