"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AdminUser {
  id: number; email: string; name: string; role: string;
  is_active: boolean; org_id: number | null; created_at: string | null; run_count: number;
  login_count: number; last_login_at: string | null;
}
interface UserActivity {
  user_id: number; email: string; last_login_at: string | null; login_count: number;
  run_count: number; api_key_count: number;
  recent_actions: { action: string; resource_type: string; created_at: string }[];
}
interface AuditLog {
  id: number; action: string; resource_type: string | null; resource_id: string | null;
  user_id: number | null; ip_address: string | null; created_at: string;
}
interface FeedbackItem {
  id: string; type: string; title: string; description: string;
  category: string | null; severity: string | null; status: string;
  user_email: string | null; user_name: string | null; created_at: string; admin_note: string | null;
}
interface NPSItem {
  id: string; score: number; comment: string | null;
  user_email: string | null; user_name: string | null; created_at: string;
}
interface NPSSummary {
  items: NPSItem[]; total: number; avg_score: number | null; nps_score: number | null;
  distribution: Record<string, number>; promoters: number; passives: number; detractors: number;
}

const ROLES = ["viewer", "researcher", "admin", "owner"];
const ROLE_COLOR: Record<string, string> = {
  owner: "#f59e0b", admin: "#6366f1", researcher: "#10b981", viewer: "#64748b",
};
const TYPE_ICON: Record<string, string> = {
  feature_request: "💡", bug_report: "🐛", general: "💬",
};
const SEV_COLOR: Record<string, string> = {
  critical: "var(--danger)", high: "#f59e0b", medium: "#6366f1", low: "var(--muted)",
};

// ─── Unauthorized ─────────────────────────────────────────────────────────────
function Unauthorized() {
  return (
    <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
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
          <ellipse cx="80" cy="174" rx="38" ry="6" fill="rgba(99,102,241,0.15)"/>
          <g className="robot-body">
            <line x1="80" y1="22" x2="80" y2="10" stroke="#6366f1" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="80" cy="7" r="5" fill="#f59e0b"/>
            <rect x="44" y="22" width="72" height="56" rx="14" fill="#1e293b" stroke="#6366f1" strokeWidth="2.5"/>
            <g className="robot-eye">
              <rect x="56" y="36" width="18" height="16" rx="4" fill="#6366f1"/>
              <rect x="86" y="36" width="18" height="16" rx="4" fill="#6366f1"/>
            </g>
            <circle cx="65" cy="44" r="4" fill="#e0e7ff"/>
            <circle cx="95" cy="44" r="4" fill="#e0e7ff"/>
            <rect x="62" y="62" width="36" height="5" rx="2.5" fill="#334155"/>
            <rect x="38" y="84" width="84" height="62" rx="12" fill="#1e293b" stroke="#334155" strokeWidth="2"/>
            <rect x="52" y="94" width="56" height="36" rx="8" fill="#0f172a" stroke="#6366f1" strokeWidth="1.5"/>
            <text x="80" y="107" textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="ui-monospace,monospace" fontWeight="700">ACCESS</text>
            <text x="80" y="120" textAnchor="middle" fill="#ef4444" fontSize="9" fontFamily="ui-monospace,monospace" fontWeight="700">DENIED</text>
            <circle cx="80" cy="130" r="3" fill="#ef4444" opacity="0.9"/>
            <rect x="54" y="144" width="20" height="22" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
            <rect x="86" y="144" width="20" height="22" rx="6" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
            <rect className="robot-arm-l" x="18" y="86" width="20" height="46" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
            <rect className="robot-arm-r" x="122" y="86" width="20" height="46" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="1.5"/>
            <circle cx="28" cy="140" r="9" fill="#ef4444" stroke="#7f1d1d" strokeWidth="1.5"/>
            <text x="28" y="144" textAnchor="middle" fill="white" fontSize="10" fontWeight="900">✋</text>
          </g>
        </svg>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: "0 0 8px" }}>Whoa, stop right there! 🚨</h1>
        <p style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 24px" }}>
          This is the admin zone. My robot guard says you&apos;re not on the list.<br/>
          No sneaking past him — he hasn&apos;t blinked in years.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/" className="button" style={{ textDecoration: "none" }}>← Take me home</a>
          <a href="/runs" className="button secondary" style={{ textDecoration: "none" }}>View my runs</a>
        </div>
        <p style={{ marginTop: 20, fontSize: 12, color: "var(--muted)" }}>
          If you think this is a mistake, ask an admin to update your role.
        </p>
      </div>
    </main>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────
function Overview({ stats, logs, logTotal }: { stats: Record<string, unknown>; logs: AuditLog[]; logTotal: number }) {
  const runs = stats.runs as Record<string, number>;
  return (
    <>
      <section className="summary-grid" style={{ gridTemplateColumns: "repeat(6,minmax(0,1fr))" }}>
        {[["Total Runs", runs.total], ["Completed", runs.completed], ["Failed", runs.failed],
          ["Users", stats.users], ["Webhooks", stats.webhooks], ["Benchmarks", stats.benchmarks],
        ].map(([label, value]) => (
          <div className="metric" key={String(label)}>
            <div className="metric-label">{String(label)}</div>
            <div className="metric-value" style={{ fontSize: 22 }}>{String(value)}</div>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Platform Health</h2></div>
        <div style={{ padding: "16px 18px", display: "grid", gap: 12, fontSize: 14 }}>
          {[["Completion rate", `${((runs.completion_rate ?? 0) * 100).toFixed(1)} %`],
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
      <section className="panel">
        <div className="panel-header">
          <h2>Audit Log</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Last 50 of {logTotal}</span>
        </div>
        {!logs.length ? <div className="empty">No audit events yet.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Action</th><th>Resource</th><th>User ID</th><th>IP</th></tr></thead>
              <tbody>
                {logs.map(lg => (
                  <tr key={lg.id}>
                    <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(lg.created_at).toLocaleString()}</td>
                    <td><code style={{ fontSize: 12 }}>{lg.action}</code></td>
                    <td style={{ fontSize: 12 }}>{lg.resource_type}{lg.resource_id && <> / <span style={{ color: "var(--strong)" }}>{lg.resource_id.slice(0, 10)}</span></>}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lg.user_id ?? "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{lg.ip_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/qlab-api/api/v1/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line

  async function loadActivity(userId: number) {
    setActivityLoading(true);
    setActivity(null);
    try {
      const res = await fetch(`/qlab-api/api/v1/admin/users/${userId}/activity`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setActivity(await res.json());
    } finally {
      setActivityLoading(false);
    }
  }

  async function changeRole(userId: number, role: string) {
    setWorking(userId);
    try {
      await fetch(`/qlab-api/api/v1/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      await load();
    } finally {
      setWorking(null);
    }
  }

  async function toggleActive(u: AdminUser) {
    setWorking(u.id);
    try {
      if (u.is_active) {
        await fetch(`/qlab-api/api/v1/admin/users/${u.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      } else {
        await fetch(`/qlab-api/api/v1/admin/users/${u.id}/reactivate`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
      }
      await load();
    } finally {
      setWorking(null);
    }
  }

  if (loading) return <div className="empty">Loading users…</div>;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Users</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{users.length} total</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>User</th><th>Role</th><th>Runs</th><th>Logins</th><th>Last Login</th><th>Joined</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u => {
                const daysSince = u.last_login_at ? (Date.now() - new Date(u.last_login_at).getTime()) / 86400000 : null;
                const statusLabel = !u.is_active ? "Disabled" : !u.last_login_at ? "Never logged in" : u.login_count === 1 ? "One-time" : daysSince !== null && daysSince < 7 ? "Active" : "Inactive";
                const statusColor = !u.is_active ? "var(--danger)" : !u.last_login_at ? "var(--muted)" : u.login_count === 1 ? "#f59e0b" : daysSince !== null && daysSince < 7 ? "#10b981" : "var(--muted)";
                return (
                  <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</div>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={working === u.id}
                        onChange={e => changeRole(u.id, e.target.value)}
                        style={{
                          background: "var(--surface)", color: ROLE_COLOR[u.role] ?? "var(--text)",
                          border: "1px solid var(--line)", borderRadius: 4, padding: "3px 8px",
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>{u.run_count}</td>
                    <td style={{ fontSize: 13, fontWeight: 700, color: u.login_count > 0 ? "var(--strong)" : "var(--muted)" }}>{u.login_count}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="button secondary" style={{ height: 28, fontSize: 11 }}
                          onClick={() => loadActivity(u.id)}>
                          View
                        </button>
                        <button
                          className="button secondary"
                          style={{ height: 28, fontSize: 11, color: u.is_active ? "var(--danger)" : "#10b981", borderColor: u.is_active ? "var(--danger)" : "#10b981" }}
                          disabled={working === u.id}
                          onClick={() => toggleActive(u)}
                        >
                          {working === u.id ? "…" : u.is_active ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {(activityLoading || activity) && (
        <section className="panel">
          {activityLoading ? (
            <div className="empty">Loading activity…</div>
          ) : activity && (
            <>
              <div className="panel-header">
                <h2>Activity: {activity.email}</h2>
                <button onClick={() => setActivity(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, padding: "16px 18px" }}>
                {[
                  ["Logins", activity.login_count],
                  ["Runs", activity.run_count],
                  ["API Keys", activity.api_key_count],
                  ["Last Login", activity.last_login_at ? new Date(activity.last_login_at).toLocaleDateString() : "Never"],
                ].map(([label, value]) => (
                  <div className="metric" key={String(label)} style={{ padding: "12px 14px" }}>
                    <div className="metric-label">{String(label)}</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{String(value)}</div>
                  </div>
                ))}
              </div>
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
                {activity.recent_actions.length === 0 ? (
                  <div className="empty">No recorded actions.</div>
                ) : (
                  <table>
                    <thead><tr><th>Action</th><th>Resource</th><th>Time</th></tr></thead>
                    <tbody>
                      {activity.recent_actions.map((a, i) => (
                        <tr key={i}>
                          <td><code style={{ fontSize: 12 }}>{a.action}</code></td>
                          <td style={{ fontSize: 12, color: "var(--muted)" }}>{a.resource_type ?? "—"}</td>
                          <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

// ─── Feedback tab ─────────────────────────────────────────────────────────────
function FeedbackTab({ token }: { token: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/qlab-api/api/v1/user-feedback", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setItems(d.items); }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line

  async function setStatus(id: string, status: string) {
    await fetch(`/qlab-api/api/v1/user-feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter || i.status === filter);
  const newCount = items.filter(i => i.status === "new").length;

  if (loading) return <div className="empty">Loading feedback…</div>;

  return (
    <section className="panel">
      <div className="panel-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <h2>Feedback Inbox</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          {newCount > 0 && (
            <span style={{ background: "var(--danger)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>
              {newCount} new
            </span>
          )}
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{items.length} total</span>
        </div>
      </div>

      <div style={{ padding: "10px 16px", display: "flex", gap: 6, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        {[["all", "All"], ["feature_request", "💡 Feature"], ["bug_report", "🐛 Bugs"], ["general", "💬 General"],
          ["new", "New"], ["reviewed", "Reviewed"], ["closed", "Closed"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{
              padding: "4px 12px", borderRadius: 14, fontSize: 12, cursor: "pointer",
              border: "1px solid var(--line)",
              background: filter === v ? "var(--strong)" : "transparent",
              color: filter === v ? "#fff" : "var(--muted)",
            }}>
            {l}
          </button>
        ))}
      </div>

      {!filtered.length
        ? <div className="empty">No feedback{filter !== "all" ? ` matching "${filter}"` : ""} yet.</div>
        : filtered.map(item => (
          <div key={item.id} style={{ borderBottom: "1px solid var(--line)", padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{TYPE_ICON[item.type] ?? "💬"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</span>
                  {item.severity && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: SEV_COLOR[item.severity] ?? "var(--muted)" }}>
                      {item.severity}
                    </span>
                  )}
                  {item.category && (
                    <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, border: "1px solid var(--line)", color: "var(--muted)" }}>
                      {item.category}
                    </span>
                  )}
                  <span style={{
                    fontSize: 11, padding: "1px 7px", borderRadius: 10, fontWeight: 600,
                    background: item.status === "new" ? "rgba(239,68,68,0.12)" : item.status === "reviewed" ? "rgba(99,102,241,0.12)" : "rgba(16,185,129,0.12)",
                    color: item.status === "new" ? "var(--danger)" : item.status === "reviewed" ? "var(--strong)" : "#10b981",
                  }}>
                    {item.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  {item.user_name ?? "Anonymous"}{item.user_email ? ` · ${item.user_email}` : ""} · {new Date(item.created_at).toLocaleDateString()}
                </div>
                {expanded === item.id && (
                  <div style={{
                    marginTop: 10, fontSize: 13, color: "var(--text)", lineHeight: 1.65,
                    whiteSpace: "pre-wrap", background: "var(--surface)", borderRadius: 6, padding: 12,
                  }}>
                    {item.description}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="button secondary" style={{ height: 28, fontSize: 11 }}
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
                  {expanded === item.id ? "Collapse" : "Read"}
                </button>
                {item.status === "new" && (
                  <button className="button secondary"
                    style={{ height: 28, fontSize: 11, color: "#6366f1", borderColor: "#6366f1" }}
                    onClick={() => setStatus(item.id, "reviewed")}>
                    Review
                  </button>
                )}
                {item.status !== "closed" && (
                  <button className="button secondary"
                    style={{ height: 28, fontSize: 11, color: "#10b981", borderColor: "#10b981" }}
                    onClick={() => setStatus(item.id, "closed")}>
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      }
    </section>
  );
}

// ─── NPS tab ──────────────────────────────────────────────────────────────────
function NPSTab({ token }: { token: string }) {
  const [data, setData] = useState<NPSSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/qlab-api/api/v1/nps", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); }).finally(() => setLoading(false));
  }, []); // eslint-disable-line

  if (loading) return <div className="empty">Loading NPS data…</div>;
  if (!data || data.total === 0) {
    return <div className="empty">No NPS responses yet. The in-app survey appears to users after 7 days of activity.</div>;
  }

  const maxVal = Math.max(...Object.values(data.distribution), 1);
  const npsColor = (data.nps_score ?? 0) >= 50 ? "#10b981" : (data.nps_score ?? 0) >= 0 ? "#f59e0b" : "var(--danger)";

  return (
    <>
      <section className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {[
          ["NPS Score", data.nps_score !== null ? `${data.nps_score}` : "—", npsColor],
          ["Avg Rating", data.avg_score !== null ? `${data.avg_score} / 10` : "—", undefined],
          ["Responses", String(data.total), undefined],
          ["Promoters", `${data.promoters} (${data.total ? Math.round(data.promoters / data.total * 100) : 0}%)`, "#10b981"],
        ].map(([label, value, color]) => (
          <div className="metric" key={String(label)}>
            <div className="metric-label">{String(label)}</div>
            <div className="metric-value" style={{ fontSize: 20, color: color ?? undefined }}>{String(value)}</div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-header"><h2>Score Distribution</h2></div>
        <div style={{ padding: "20px 24px", display: "flex", gap: 8, alignItems: "flex-end", height: 140 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const score = i + 1;
            const count = data.distribution[String(score)] ?? 0;
            const pct = Math.round((count / maxVal) * 100);
            const barColor = score >= 9 ? "#10b981" : score >= 7 ? "#f59e0b" : "var(--danger)";
            return (
              <div key={score} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{count || ""}</span>
                <div style={{
                  width: "100%", background: barColor, borderRadius: "3px 3px 0 0",
                  height: `${Math.max(pct, count > 0 ? 8 : 2)}%`, opacity: 0.85, minHeight: 2,
                }} />
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{score}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 16, padding: "0 24px 16px", fontSize: 12, flexWrap: "wrap" }}>
          {[["🟢 Promoters (9–10)", data.promoters], ["🟡 Passives (7–8)", data.passives], ["🔴 Detractors (1–6)", data.detractors]].map(([l, v]) => (
            <span key={String(l)} style={{ color: "var(--muted)" }}>
              {String(l)}: <strong style={{ color: "var(--text)" }}>{String(v)}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent Responses</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{data.total} total</span>
        </div>
        {data.items.slice(0, 50).map(item => (
          <div key={item.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14,
              background: item.score >= 9 ? "rgba(16,185,129,0.15)" : item.score >= 7 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.12)",
              color: item.score >= 9 ? "#10b981" : item.score >= 7 ? "#f59e0b" : "var(--danger)",
            }}>
              {item.score}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                {item.user_name ?? "Anonymous"}{item.user_email ? ` · ${item.user_email}` : ""} · {new Date(item.created_at).toLocaleDateString()}
              </div>
              {item.comment && (
                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>{item.comment}</div>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

// ─── Activity Feed Tab ────────────────────────────────────────────────────────
interface ActivityEvent {
  id: number; action: string; resource_type: string | null; resource_id: string | null;
  user_id: number | null; user_email: string | null; ip_address: string | null;
  user_agent: string | null; meta: Record<string, unknown>; created_at: string;
}

const ACTION_ICON: Record<string, string> = {
  "auth.login": "🔑",
  "auth.register": "✨",
  "auth.logout": "🚪",
  "run.created": "⚛️",
  "run.updated": "✏️",
  "run.deleted": "🗑️",
  "run.viewed": "👁️",
  "insight.generated": "🤖",
  "insight.requested": "💡",
  "cost_oracle.queried": "💰",
  "assistant.queried": "🤖",
  "billing.viewed": "💳",
  "page.view": "📄",
};
const ACTION_COLOR: Record<string, string> = {
  "auth.login": "#10b981", "auth.register": "#6366f1",
  "run.created": "#6366f1", "run.deleted": "#ef4444",
  "insight.generated": "#f59e0b",
  "page.view": "#64748b",
};

function ActivityFeedTab({ token }: { token: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/qlab-api/api/v1/admin/activity-feed?limit=200", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { setEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const filtered = filter
    ? events.filter(e =>
        e.action.includes(filter) ||
        (e.user_email ?? "").includes(filter) ||
        (e.resource_id ?? "").includes(filter)
      )
    : events;

  function fmt(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
  }

  return (
    <section className="panel">
      <div className="panel-header" style={{ gap: 12 }}>
        <h2>Live Activity Feed</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} events</span>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by action, email, or resource…"
          style={{
            marginLeft: "auto", height: 32, padding: "0 12px", borderRadius: 6,
            border: "1px solid var(--line)", background: "var(--surface)",
            color: "var(--text)", fontSize: 13, width: 280,
          }}
        />
      </div>
      {loading ? (
        <div className="empty">Loading activity…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No events yet — activity appears here as users interact with Q-Lab.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                <th style={{ padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>Time</th>
                <th style={{ padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>User</th>
                <th style={{ padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>Action</th>
                <th style={{ padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>Resource</th>
                <th style={{ padding: "8px 12px", color: "var(--muted)", fontWeight: 600 }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "7px 12px", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmt(e.created_at)}</td>
                  <td style={{ padding: "7px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.user_email ?? <span style={{ color: "var(--muted)" }}>anonymous</span>}
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: `${ACTION_COLOR[e.action] ?? "#64748b"}18`,
                      color: ACTION_COLOR[e.action] ?? "var(--muted)",
                      borderRadius: 999, padding: "2px 9px", fontWeight: 600, fontSize: 12,
                    }}>
                      {ACTION_ICON[e.action] ?? "•"} {e.action}
                    </span>
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--muted)", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.resource_id ?? "—"}
                  </td>
                  <td style={{ padding: "7px 12px", color: "var(--muted)", fontSize: 12 }}>{e.ip_address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "overview" | "users" | "feedback" | "nps" | "activity";

export default function AdminPage() {
  const { token, user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Don't act until auth has finished reading from localStorage
    if (loading) return;
    if (!token) { router.push("/login?next=/admin"); return; }
    // Non-admin: don't fetch, just let render show the guard
    if (!user || (user.role !== "owner" && user.role !== "admin")) return;
    void Promise.all([
      fetch("/qlab-api/api/v1/admin/stats", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setStats).catch(() => setError("Failed to load stats")),
      fetch("/qlab-api/api/v1/admin/audit-logs?limit=50", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => { setLogs(d.items); setLogTotal(d.total); }).catch(() => {}),
    ]);
  }, [loading, token, user]); // eslint-disable-line

  // Auth still initialising (token is read from localStorage in a useEffect, so
  // it starts null even for logged-in users — don't redirect until loading=false)
  if (loading) return <main className="page"><div className="empty">Loading…</div></main>;
  // Unauthorised — show the robot guard
  if (!user || (user.role !== "owner" && user.role !== "admin")) return <Unauthorized />;
  if (error) return <main className="page"><div className="empty" style={{ color: "var(--danger)" }}>{error}</div></main>;
  if (!stats) return <main className="page"><div className="empty">Loading…</div></main>;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview",  label: "Overview" },
    { key: "users",     label: "Users" },
    { key: "activity",  label: "Activity" },
    { key: "feedback",  label: "Feedback" },
    { key: "nps",       label: "NPS" },
  ];

  return (
    <main className="page">
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--line)" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none",
              color: tab === t.key ? "var(--text)" : "var(--muted)",
              borderBottom: tab === t.key ? "2px solid var(--strong)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview"  && <Overview stats={stats} logs={logs} logTotal={logTotal} />}
      {tab === "users"     && <UsersTab token={token!} />}
      {tab === "activity"  && <ActivityFeedTab token={token!} />}
      {tab === "feedback"  && <FeedbackTab token={token!} />}
      {tab === "nps"       && <NPSTab token={token!} />}
    </main>
  );
}
