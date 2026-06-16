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
    if (user && user.role !== "owner" && user.role !== "admin") {
      router.push("/");
      return;
    }
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
