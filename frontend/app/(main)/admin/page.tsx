"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAuditLogs, fetchSystemStats, type AuditLogEntry } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

export default function AdminPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    if (user && user.role !== "owner" && user.role !== "admin") return; // show cartoon instead
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user]);

  async function load() {
    try {
      const [s, l] = await Promise.all([
        fetchSystemStats(token!),
        fetchAuditLogs(token!, { limit: "50" }),
      ]);
      setStats(s);
      setLogs(l.items);
      setLogTotal(l.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    }
  }

  if (user && user.role !== "owner" && user.role !== "admin") {
    return (
      <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
        <div style={{ textAlign: "center", maxWidth: 440 }}>
          {/* Cartoon robot guard */}
          <svg width="160" height="180" viewBox="0 0 160 180" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: 8 }}>
            <style>{`
              @keyframes bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
              @keyframes blink { 0%,90%,100%{transform:scaleY(1)} 95%{transform:scaleY(0.08)} }
              @keyframes swing { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
              .robot-body { animation: bob 2.4s ease-in-out infinite; transform-origin: bottom center; }
              .robot-eye { animation: blink 3.5s ease-in-out infinite; transform-origin: center; }
              .robot-arm-l { animation: swing 2.4s ease-in-out infinite; transform-origin: 38px 96px; }
              .robot-arm-r { animation: swing 2.4s ease-in-out infinite reverse; transform-origin: 122px 96px; }
            `}</style>
            {/* Shadow */}
            <ellipse cx="80" cy="174" rx="38" ry="6" fill="rgba(99,102,241,0.15)"/>
            <g className="robot-body">
              {/* Antenna */}
              <line x1="80" y1="22" x2="80" y2="10" stroke="#6366f1" strokeWidth="3" strokeLinecap="round"/>
              <circle cx="80" cy="7" r="5" fill="#f59e0b"/>
              {/* Head */}
              <rect x="44" y="22" width="72" height="56" rx="14" fill="#1e293b" stroke="#6366f1" strokeWidth="2.5"/>
              {/* Eyes */}
              <g className="robot-eye">
                <rect x="56" y="36" width="18" height="16" rx="4" fill="#6366f1"/>
                <rect x="86" y="36" width="18" height="16" rx="4" fill="#6366f1"/>
              </g>
              <circle cx="65" cy="44" r="4" fill="#e0e7ff"/>
              <circle cx="95" cy="44" r="4" fill="#e0e7ff"/>
              {/* Mouth — flat line (not happy) */}
              <rect x="62" y="62" width="36" height="5" rx="2.5" fill="#334155"/>
              {/* Body */}
              <rect x="38" y="84" width="84" height="62" rx="12" fill="#1e293b" stroke="#334155" strokeWidth="2"/>
              {/* Chest screen */}
              <rect x="52" y="94" width="56" height="36" rx="8" fill="#0f172a" stroke="#6366f1" strokeWidth="1.5"/>
              <text x="80" y="107" textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="ui-monospace,monospace" fontWeight="700">ACCESS</text>
              <text x="80" y="120" textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="ui-monospace,monospace" fontWeight="700">DENIED</text>
              {/* Blinky light */}
              <circle cx="80" cy="130" r="3" fill="#ef4444" opacity="0.9"/>
              {/* Legs */}
              <rect x="54" y="144" width="20" height="22" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
              <rect x="86" y="144" width="20" height="22" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
              {/* Arms */}
              <rect className="robot-arm-l" x="18" y="86" width="20" height="46" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
              <rect className="robot-arm-r" x="122" y="86" width="20" height="46" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
              {/* Stop-sign hand */}
              <circle cx="28" cy="140" r="9" fill="#ef4444" stroke="#7f1d1d" strokeWidth="1.5"/>
              <text x="28" y="144" textAnchor="middle" fill="white" fontSize="10" fontWeight="900">✋</text>
            </g>
          </svg>

          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: "0 0 8px" }}>
            Whoa, stop right there! 🚨
          </h1>
          <p style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 24px" }}>
            This is the admin zone. My robot guard says you&apos;re not on the list.<br/>
            No sneaking past him — he hasn&apos;t blinked in years.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/" className="button" style={{ textDecoration: "none" }}>
              ← Take me home
            </a>
            <a href="/runs" className="button secondary" style={{ textDecoration: "none" }}>
              View my runs
            </a>
          </div>
          <p style={{ marginTop: 20, fontSize: 12, color: "var(--muted)" }}>
            If you think this is a mistake, ask an admin to update your role.
          </p>
        </div>
      </main>
    );
  }

  if (error) return <main className="page"><div className="empty" style={{ color: "var(--danger)" }}>{error}</div></main>;
  if (!stats) return <main className="page"><div className="empty">Loading…</div></main>;

  const runs = stats.runs as Record<string, number>;

  return (
    <main className="page">
      {/* Stat cards */}
      <section className="summary-grid" style={{ gridTemplateColumns: "repeat(6,minmax(0,1fr))" }}>
        {[
          ["Total Runs", runs.total],
          ["Completed", runs.completed],
          ["Failed", runs.failed],
          ["Users", stats.users],
          ["Webhooks", stats.webhooks],
          ["Benchmarks", stats.benchmarks],
        ].map(([label, value]) => (
          <div className="metric" key={String(label)}>
            <div className="metric-label">{String(label)}</div>
            <div className="metric-value" style={{ fontSize: 22 }}>{String(value)}</div>
          </div>
        ))}
      </section>

      {/* Completion rate */}
      <section className="panel">
        <div className="panel-header"><h2>Platform Health</h2></div>
        <div style={{ padding: "16px 18px", display: "grid", gap: 12, fontSize: 14 }}>
          {[
            ["Completion rate", `${((runs.completion_rate ?? 0) * 100).toFixed(1)} %`],
            ["Failure rate", `${((runs.failure_rate ?? 0) * 100).toFixed(1)} %`],
            ["Audit events", logTotal],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ color: "var(--muted)", fontWeight: 500 }}>{String(label)}</span>
              <span style={{ fontWeight: 600 }}>{String(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Audit log */}
      <section className="panel">
        <div className="panel-header">
          <h2>Audit Log</h2>
          <span style={{ fontSize: 13, color: "#5f6f80" }}>Last 50 of {logTotal}</span>
        </div>
        {!logs.length ? (
          <div className="empty">No audit events yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>User ID</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((lg) => (
                  <tr key={lg.id}>
                    <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {new Date(lg.created_at).toLocaleString()}
                    </td>
                    <td>
                      <code style={{ fontSize: 12 }}>{lg.action}</code>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {lg.resource_type && <>{lg.resource_type}</>}
                      {lg.resource_id && <> / <span style={{ color: "var(--strong)" }}>{lg.resource_id.slice(0, 10)}</span></>}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lg.user_id ?? "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lg.ip_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
