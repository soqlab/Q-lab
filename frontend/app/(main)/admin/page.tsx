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
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--line) transparent" }}>
            <style>{`
              .audit-scroll::-webkit-scrollbar { width: 6px; }
              .audit-scroll::-webkit-scrollbar-track { background: transparent; }
              .audit-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }
              .audit-scroll::-webkit-scrollbar-thumb:hover { background: #6366f1; }
            `}</style>
            <div className="audit-scroll" style={{ maxHeight: 320, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "#6366f1 transparent" }}>
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

// ─── Analytics Tab ───────────────────────────────────────────────────────────
interface AnalyticsData {
  period_days: number; total_events: number;
  action_breakdown: { action: string; count: number }[];
  daily_timeline: { day: string; active_users: number; events: number }[];
  top_users: { user_id: number; email: string; events: number }[];
  top_pages: { page: string; views: number }[];
  signup_trend: { day: string; count: number }[];
}

function MiniBar({ value, max, color = "#6366f1" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 32, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function AnalyticsTab({ token }: { token: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/analytics?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading analytics…</div>;
  if (!data) return <div className="empty">Failed to load analytics.</div>;

  const maxAction = data.action_breakdown[0]?.count ?? 1;
  const maxPage = data.top_pages[0]?.views ?? 1;
  const maxUser = data.top_users[0]?.events ?? 1;

  const ACTION_COLOR_MAP: Record<string, string> = {
    "page.view": "#64748b", "auth.login": "#10b981", "auth.register": "#6366f1",
    "run.created": "#6366f1", "run.viewed": "#a78bfa", "run.deleted": "#ef4444",
    "insight.generated": "#f59e0b", "assistant.queried": "#f59e0b",
    "cost_oracle.queried": "#10b981", "billing.viewed": "#06b6d4",
  };

  return (
    <>
      {/* Controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: days === d ? "var(--strong)" : "var(--surface)",
            color: days === d ? "#fff" : "var(--muted)",
            border: `1px solid ${days === d ? "var(--strong)" : "var(--line)"}`,
          }}>Last {d}d</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>
          {data.total_events.toLocaleString()} events
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Action breakdown */}
        <section className="panel">
          <div className="panel-header"><h2>Action Breakdown</h2></div>
          <div style={{ padding: "0 20px 20px" }}>
            {data.action_breakdown.slice(0, 12).map(a => (
              <div key={a.action} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: ACTION_COLOR_MAP[a.action] ?? "var(--text)", fontWeight: 600 }}>
                    {ACTION_ICON[a.action] ?? "•"} {a.action}
                  </span>
                </div>
                <MiniBar value={a.count} max={maxAction} color={ACTION_COLOR_MAP[a.action] ?? "#6366f1"} />
              </div>
            ))}
          </div>
        </section>

        {/* Top users */}
        <section className="panel">
          <div className="panel-header"><h2>Most Active Users</h2></div>
          <div style={{ padding: "0 20px 20px" }}>
            {data.top_users.map((u, i) => (
              <div key={u.user_id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", maxWidth: "75%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    #{i + 1} {u.email}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{u.events} events</span>
                </div>
                <MiniBar value={u.events} max={maxUser} color="#6366f1" />
              </div>
            ))}
            {data.top_users.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No activity yet in this period.</div>}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top pages */}
        <section className="panel">
          <div className="panel-header"><h2>Top Pages Visited</h2></div>
          <div style={{ padding: "0 20px 20px" }}>
            {data.top_pages.map(p => (
              <div key={p.page} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{p.page}</span>
                </div>
                <MiniBar value={p.views} max={maxPage} color="#a78bfa" />
              </div>
            ))}
            {data.top_pages.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No page views tracked yet.</div>}
          </div>
        </section>

        {/* Signup trend */}
        <section className="panel">
          <div className="panel-header"><h2>New Signups per Day</h2></div>
          <div style={{ padding: "0 20px 20px" }}>
            {data.signup_trend.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>No new signups in this period.</div>
            ) : (
              data.signup_trend.map(s => (
                <div key={s.day} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.day}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>+{s.count}</span>
                  </div>
                  <MiniBar value={s.count} max={Math.max(...data.signup_trend.map(x => x.count), 1)} color="#10b981" />
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Reach Tab (web self-promotion tools) ─────────────────────────────────────
function ReachTab({ token }: { token: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [galleryCount, setGalleryCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/qlab-api/api/v1/public/gallery?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setGalleryCount(d.total ?? 0)).catch(() => {});
  }, [token]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const badgeMarkdown = `[![Tracked on Q-Lab](${origin}/api/v1/badge/runs.svg)](${origin})`;
  const badgeHtml = `<a href="${origin}"><img src="${origin}/api/v1/badge/runs.svg" alt="Tracked on Q-Lab"></a>`;

  function CodeBox({ label, code, copyKey }: { label: string; code: string; copyKey: string }) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</span>
          <button
            onClick={() => copy(code, copyKey)}
            style={{ fontSize: 12, padding: "3px 10px", borderRadius: 5, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", color: "var(--muted)" }}
          >
            {copied === copyKey ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: "10px 14px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {code}
        </pre>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Stats */}
        <section className="panel">
          <div className="panel-header"><h2>Organic Reach</h2></div>
          <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Public shared experiments</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#6366f1" }}>{galleryCount ?? "…"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Public gallery page</span>
              <a href="/gallery" target="_blank" style={{ fontSize: 13, color: "#6366f1" }}>{origin}/gallery →</a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>RSS feed (for aggregators)</span>
              <a href="/feed.xml" target="_blank" style={{ fontSize: 13, color: "#6366f1" }}>feed.xml →</a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Live badge (updates with run count)</span>
              <img src={`${origin}/api/v1/badge/runs.svg`} alt="badge preview" style={{ height: 20 }} />
            </div>
          </div>
        </section>

        {/* How it spreads */}
        <section className="panel">
          <div className="panel-header"><h2>How Q-Lab Spreads</h2></div>
          <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { icon: "⚛️", title: "GitHub badge", desc: "Users embed it in Qiskit repos — every repo is a permanent backlink" },
              { icon: "🌐", title: "Public gallery", desc: "Each shared experiment is an SEO page: 'Grover algorithm IBM 14 qubits'" },
              { icon: "📡", title: "RSS feed", desc: "Quantum computing blogs aggregate it — free recurring exposure" },
              { icon: "🔗", title: "Share links", desc: "Every /share/token page has a 'Get started free' CTA at the bottom" },
              { icon: "📄", title: "JSON-LD + OG tags", desc: "Google indexes Q-Lab as a SoftwareApplication; rich link previews on Twitter/LinkedIn" },
            ].map(item => (
              <div key={item.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Embed codes */}
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><h2>Embed Codes — put these in GitHub READMEs &amp; Notebooks</h2></div>
        <div style={{ padding: "8px 20px 20px" }}>
          <CodeBox label="Markdown badge (GitHub README)" code={badgeMarkdown} copyKey="md" />
          <CodeBox label="HTML badge (notebooks, websites)" code={badgeHtml} copyKey="html" />
          <CodeBox label="RSS feed URL (submit to Feedly, quantum aggregators)" code={`${origin}/feed.xml`} copyKey="rss" />
        </div>
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

// ─── Shared helpers ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="metric" style={{ padding: "14px 18px" }}>
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 22, color: color ?? "var(--text)" }}>{String(value)}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Bar({ value, max, color = "#6366f1", label }: { value: number; max: number; color?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString()}</span>
      </div>
      <div style={{ height: 5, background: "var(--line)", borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function DaySelector({ days, setDays }: { days: number; setDays: (d: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
      {[7, 14, 30, 90].map(d => (
        <button key={d} onClick={() => setDays(d)} style={{
          padding: "5px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: days === d ? "var(--strong)" : "var(--surface)",
          color: days === d ? "#fff" : "var(--muted)",
          border: `1px solid ${days === d ? "var(--strong)" : "var(--line)"}`,
        }}>Last {d}d</button>
      ))}
    </div>
  );
}

// ─── Traffic Tab ──────────────────────────────────────────────────────────────
interface TrafficData {
  period_days: number; total_page_views: number;
  heatmap: { day: number; hour: number; count: number }[];
  hourly_breakdown: { hour: number; views: number }[];
  daily_views: { day: string; views: number; unique_visitors: number }[];
  browsers: { browser: string; count: number }[];
  os_breakdown: { os: string; count: number }[];
  devices: { device: string; count: number }[];
  top_pages: { page: string; views: number }[];
}

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function TrafficTab({ token }: { token: string }) {
  const [data, setData] = useState<TrafficData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/traffic-stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading traffic data…</div>;
  if (!data) return <div className="empty">Failed to load traffic data.</div>;

  // Build 7×24 heatmap grid
  const hmap: Record<string, number> = {};
  let hmapMax = 0;
  data.heatmap.forEach(h => { hmap[`${h.day}:${h.hour}`] = h.count; hmapMax = Math.max(hmapMax, h.count); });

  const peakHour = data.hourly_breakdown.reduce((a, b) => b.views > a.views ? b : a, { hour: 0, views: 0 });
  const totalUnique = data.daily_views.reduce((s, d) => s + d.unique_visitors, 0);
  const maxPage = data.top_pages[0]?.views ?? 1;
  const maxBrowser = data.browsers[0]?.count ?? 1;
  const maxOS = data.os_breakdown[0]?.count ?? 1;
  const maxViews = Math.max(...data.daily_views.map(d => d.views), 1);
  const mobile = data.devices.find(d => d.device === "Mobile")?.count ?? 0;
  const mobilePct = data.total_page_views > 0 ? Math.round(mobile / data.total_page_views * 100) : 0;

  return (
    <>
      <DaySelector days={days} setDays={setDays} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
        <StatCard label="Total Page Views" value={data.total_page_views.toLocaleString()} />
        <StatCard label="Peak Hour" value={`${peakHour.hour}:00`} sub={`${peakHour.views} views`} color="#6366f1" />
        <StatCard label="Unique Visitors" value={totalUnique.toLocaleString()} sub="by user ID" />
        <StatCard label="Mobile Traffic" value={`${mobilePct}%`} sub={`${mobile} sessions`} />
      </div>

      {/* Heatmap */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><h2>Traffic Heatmap — Day × Hour</h2><span style={{ fontSize: 12, color: "var(--muted)" }}>darker = more views</span></div>
        <div style={{ padding: "12px 18px 18px", overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "40px repeat(24,1fr)", gap: 2, minWidth: 600 }}>
            {/* Hour labels */}
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ fontSize: 9, color: "var(--muted)", textAlign: "center" }}>{h}</div>
            ))}
            {DAYS_SHORT.map((dayLabel, dow) => (
              <div key={dow} style={{ display: "contents" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center" }}>{dayLabel}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const cnt = hmap[`${dow}:${h}`] ?? 0;
                  const intensity = hmapMax > 0 ? cnt / hmapMax : 0;
                  const alpha = intensity > 0 ? 0.12 + intensity * 0.78 : 0.04;
                  return (
                    <div key={h} title={`${dayLabel} ${h}:00 — ${cnt} views`} style={{
                      height: 16, borderRadius: 2,
                      background: `rgba(99,102,241,${alpha.toFixed(2)})`,
                      cursor: "default",
                    }} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Daily trend */}
        <section className="panel">
          <div className="panel-header"><h2>Daily Page Views</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.daily_views.slice(-30).map(d => (
              <div key={d.day} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.day.slice(5)}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.views}</span>
                </div>
                <div style={{ height: 4, background: "var(--line)", borderRadius: 2 }}>
                  <div style={{ width: `${maxViews > 0 ? Math.round(d.views / maxViews * 100) : 0}%`, height: "100%", background: "#6366f1", borderRadius: 2 }} />
                </div>
              </div>
            ))}
            {data.daily_views.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No page views in this period.</div>}
          </div>
        </section>

        {/* Top pages */}
        <section className="panel">
          <div className="panel-header"><h2>Top Pages</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.top_pages.map(p => <Bar key={p.page} label={p.page} value={p.views} max={maxPage} color="#a78bfa" />)}
            {data.top_pages.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No data yet.</div>}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <section className="panel">
          <div className="panel-header"><h2>Browsers</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.browsers.map(b => <Bar key={b.browser} label={b.browser} value={b.count} max={maxBrowser} />)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Operating Systems</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.os_breakdown.map(o => <Bar key={o.os} label={o.os} value={o.count} max={maxOS} color="#10b981" />)}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Device Type</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.devices.map(d => (
              <div key={d.device} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{d.device}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{data.total_page_views > 0 ? Math.round(d.count / data.total_page_views * 100) : 0}%</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--strong)" }}>{d.count.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Runs Analytics Tab ───────────────────────────────────────────────────────
interface RunsStatsData {
  period_days: number; total_runs: number; completion_rate: number; failure_rate: number;
  avg_circuit_depth: number | null;
  backends: { backend: string; count: number }[];
  statuses: { status: string; count: number }[];
  daily_runs: { day: string; count: number }[];
  qubit_distribution: { bucket: string; count: number }[];
  top_projects: { project: string; runs: number }[];
}

const BACKEND_COLOR: Record<string, string> = {
  ibm: "#6366f1", ionq: "#f59e0b", rigetti: "#ef4444", aer: "#10b981",
  "ibm_nairobi": "#6366f1", "ibm_jakarta": "#6366f1",
};
const STATUS_COLOR: Record<string, string> = {
  completed: "#10b981", failed: "#ef4444", running: "#f59e0b", submitted: "#64748b",
};

function RunsAnalyticsTab({ token }: { token: string }) {
  const [data, setData] = useState<RunsStatsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/runs-stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading run analytics…</div>;
  if (!data) return <div className="empty">Failed to load run data.</div>;

  const maxBackend = data.backends[0]?.count ?? 1;
  const maxStatus = data.statuses[0]?.count ?? 1;
  const maxQubit = Math.max(...data.qubit_distribution.map(q => q.count), 1);
  const maxProject = data.top_projects[0]?.runs ?? 1;
  const maxDaily = Math.max(...data.daily_runs.map(d => d.count), 1);

  return (
    <>
      <DaySelector days={days} setDays={setDays} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
        <StatCard label="Total Runs" value={data.total_runs.toLocaleString()} />
        <StatCard label="Completion Rate" value={`${(data.completion_rate * 100).toFixed(1)}%`} color="#10b981" />
        <StatCard label="Failure Rate" value={`${(data.failure_rate * 100).toFixed(1)}%`} color={data.failure_rate > 0.2 ? "#ef4444" : "var(--text)"} />
        <StatCard label="Avg Circuit Depth" value={data.avg_circuit_depth ?? "—"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <section className="panel">
          <div className="panel-header"><h2>Backend Distribution</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.backends.map(b => {
              const key = b.backend.toLowerCase();
              const color = Object.entries(BACKEND_COLOR).find(([k]) => key.includes(k))?.[1] ?? "#64748b";
              return <Bar key={b.backend} label={b.backend} value={b.count} max={maxBackend} color={color} />;
            })}
            {data.backends.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No runs in this period.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Status Breakdown</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.statuses.map(s => <Bar key={s.status} label={s.status} value={s.count} max={maxStatus} color={STATUS_COLOR[s.status] ?? "#64748b"} />)}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <section className="panel">
          <div className="panel-header"><h2>Daily Runs</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.daily_runs.slice(-30).map(d => (
              <div key={d.day} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.day.slice(5)}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.count}</span>
                </div>
                <div style={{ height: 4, background: "var(--line)", borderRadius: 2 }}>
                  <div style={{ width: `${maxDaily > 0 ? Math.round(d.count / maxDaily * 100) : 0}%`, height: "100%", background: "#6366f1", borderRadius: 2 }} />
                </div>
              </div>
            ))}
            {data.daily_runs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No runs yet.</div>}
          </div>
        </section>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="panel">
            <div className="panel-header"><h2>Qubit Distribution</h2></div>
            <div style={{ padding: "8px 18px 18px" }}>
              {data.qubit_distribution.map(q => <Bar key={q.bucket} label={`${q.bucket} qubits`} value={q.count} max={maxQubit} color="#f59e0b" />)}
              {data.qubit_distribution.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No qubit data.</div>}
            </div>
          </section>
          {data.top_projects.length > 0 && (
            <section className="panel">
              <div className="panel-header"><h2>Top Projects</h2></div>
              <div style={{ padding: "8px 18px 18px" }}>
                {data.top_projects.map(p => <Bar key={p.project} label={p.project} value={p.runs} max={maxProject} color="#a78bfa" />)}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ─── AI Usage Tab ─────────────────────────────────────────────────────────────
interface AIStatsData {
  period_days: number; total_ai_requests: number;
  by_type: { action: string; count: number }[];
  hourly_usage: { hour: number; count: number }[];
  daily_usage: { day: string; count: number }[];
  top_users: { user_id: number; email: string; requests: number }[];
}

const AI_LABEL: Record<string, string> = {
  "insight.generated": "AI Insights",
  "assistant.queried": "Lab Assistant",
  "cost_oracle.queried": "Cost Oracle",
};
const AI_COLOR: Record<string, string> = {
  "insight.generated": "#f59e0b",
  "assistant.queried": "#6366f1",
  "cost_oracle.queried": "#10b981",
};

function AIUsageTab({ token }: { token: string }) {
  const [data, setData] = useState<AIStatsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/ai-stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading AI analytics…</div>;
  if (!data) return <div className="empty">Failed to load AI data.</div>;

  const maxType = data.by_type[0]?.count ?? 1;
  const maxHourly = Math.max(...data.hourly_usage.map(h => h.count), 1);
  const maxDaily = Math.max(...data.daily_usage.map(d => d.count), 1);
  const maxUser = data.top_users[0]?.requests ?? 1;

  return (
    <>
      <DaySelector days={days} setDays={setDays} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
        <StatCard label="Total AI Requests" value={data.total_ai_requests.toLocaleString()} color="#f59e0b" />
        {data.by_type.slice(0, 3).map(t => (
          <StatCard key={t.action} label={AI_LABEL[t.action] ?? t.action} value={t.count} color={AI_COLOR[t.action] ?? "var(--text)"} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <section className="panel">
          <div className="panel-header"><h2>By Feature</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.by_type.map(t => (
              <Bar key={t.action} label={AI_LABEL[t.action] ?? t.action} value={t.count} max={maxType} color={AI_COLOR[t.action] ?? "#6366f1"} />
            ))}
            {data.by_type.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No AI requests in this period.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Top AI Users</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.top_users.map((u, i) => (
              <div key={u.user_id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: "var(--text)", maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{i + 1} {u.email}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{u.requests}</span>
                </div>
                <MiniBar value={u.requests} max={maxUser} color="#f59e0b" />
              </div>
            ))}
            {data.top_users.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No users yet.</div>}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Hourly bar chart */}
        <section className="panel">
          <div className="panel-header"><h2>Usage by Hour of Day</h2></div>
          <div style={{ padding: "16px 18px 14px", display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
            {data.hourly_usage.map(h => {
              const pct = maxHourly > 0 ? Math.max(h.count > 0 ? 6 : 2, Math.round(h.count / maxHourly * 88)) : 2;
              return (
                <div key={h.hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }} title={`${h.hour}:00 — ${h.count} requests`}>
                  <div style={{ width: "100%", height: pct, background: "#f59e0b", borderRadius: "2px 2px 0 0", opacity: 0.8 }} />
                  {h.hour % 6 === 0 && <span style={{ fontSize: 8, color: "var(--muted)" }}>{h.hour}h</span>}
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Daily AI Usage</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.daily_usage.slice(-21).map(d => (
              <div key={d.day} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.day.slice(5)}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{d.count}</span>
                </div>
                <div style={{ height: 4, background: "var(--line)", borderRadius: 2 }}>
                  <div style={{ width: `${maxDaily > 0 ? Math.round(d.count / maxDaily * 100) : 0}%`, height: "100%", background: "#f59e0b", borderRadius: 2 }} />
                </div>
              </div>
            ))}
            {data.daily_usage.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No AI usage yet.</div>}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────
interface SessionsData {
  period_days: number; total_sessions: number; avg_session_duration_seconds: number;
  avg_pages_per_session: number; bounce_rate: number; bounce_sessions: number;
  daily_sessions: { day: string; sessions: number }[];
}

function SessionsTab({ token }: { token: string }) {
  const [data, setData] = useState<SessionsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/sessions-stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading session data…</div>;
  if (!data) return <div className="empty">Failed to load session data.</div>;

  const fmtDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  };

  const maxSessions = Math.max(...data.daily_sessions.map(d => d.sessions), 1);
  const bounceColor = data.bounce_rate > 60 ? "#ef4444" : data.bounce_rate > 40 ? "#f59e0b" : "#10b981";

  return (
    <>
      <DaySelector days={days} setDays={setDays} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
        <StatCard label="Total Sessions" value={data.total_sessions.toLocaleString()} />
        <StatCard label="Avg Duration" value={fmtDuration(data.avg_session_duration_seconds)} sub="per session" color="#6366f1" />
        <StatCard label="Pages / Session" value={data.avg_pages_per_session} />
        <StatCard label="Bounce Rate" value={`${data.bounce_rate}%`} sub={`${data.bounce_sessions} 1-page sessions`} color={bounceColor} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Daily Sessions</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Sessions where a user visited at least one page</span>
        </div>
        <div style={{ padding: "8px 20px 20px" }}>
          {data.daily_sessions.slice(-30).map(d => (
            <div key={d.day} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.day}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.sessions} sessions</span>
              </div>
              <div style={{ height: 5, background: "var(--line)", borderRadius: 3 }}>
                <div style={{ width: `${Math.round(d.sessions / maxSessions * 100)}%`, height: "100%", background: "#6366f1", borderRadius: 3 }} />
              </div>
            </div>
          ))}
          {data.daily_sessions.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No session data yet. Sessions are derived from page.view events — make sure usePageTracker is wired up.</div>
          )}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><h2>How Sessions Are Calculated</h2></div>
        <div style={{ padding: "12px 20px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {[
            { icon: "⏱️", label: "Session Gap", value: "30 minutes", desc: "A gap of 30+ min between page views starts a new session" },
            { icon: "📄", label: "Bounce Definition", value: "1 page only", desc: "Sessions with a single page view count as bounced" },
            { icon: "👤", label: "Identity", value: "User ID / IP", desc: "Authenticated users tracked by ID; anonymous by IP" },
          ].map(item => (
            <div key={item.label} style={{ padding: 14, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>{item.value}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Security Tab ─────────────────────────────────────────────────────────────
interface SecurityData {
  period_days: number; total_logins: number; new_registrations: number; unique_ips: number;
  suspicious_ips: { ip: string; users: number; actions: number }[];
  users_multiple_ips: { user_id: number; email: string; ip_count: number }[];
  top_login_ips: { ip: string; count: number }[];
  recent_registrations: { created_at: string; ip_address: string | null; user_agent: string | null }[];
}

function SecurityTab({ token }: { token: string }) {
  const [data, setData] = useState<SecurityData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/qlab-api/api/v1/admin/security-stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [token, days]);

  if (loading) return <div className="empty">Loading security data…</div>;
  if (!data) return <div className="empty">Failed to load security data. (Owner role required)</div>;

  const maxLoginIp = data.top_login_ips[0]?.count ?? 1;

  return (
    <>
      <DaySelector days={days} setDays={setDays} />

      <div className="summary-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 16 }}>
        <StatCard label="Total Logins" value={data.total_logins.toLocaleString()} color="#10b981" />
        <StatCard label="New Registrations" value={data.new_registrations} color="#6366f1" />
        <StatCard label="Unique IPs" value={data.unique_ips} />
        <StatCard label="Suspicious IPs" value={data.suspicious_ips.length} color={data.suspicious_ips.length > 0 ? "#ef4444" : "var(--text)"} sub="shared by 2+ users" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <section className="panel">
          <div className="panel-header">
            <h2>Suspicious IPs</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>IPs used by multiple accounts</span>
          </div>
          {data.suspicious_ips.length === 0 ? (
            <div className="empty" style={{ color: "#10b981" }}>No suspicious IPs detected.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>IP Address</th><th>Accounts</th><th>Total Actions</th><th>Risk</th></tr></thead>
                <tbody>
                  {data.suspicious_ips.map(ip => (
                    <tr key={ip.ip}>
                      <td><code style={{ fontSize: 12 }}>{ip.ip}</code></td>
                      <td style={{ fontWeight: 700, color: ip.users > 3 ? "#ef4444" : "#f59e0b" }}>{ip.users}</td>
                      <td style={{ color: "var(--muted)", fontSize: 13 }}>{ip.actions}</td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                          background: ip.users > 5 ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                          color: ip.users > 5 ? "#ef4444" : "#f59e0b",
                        }}>
                          {ip.users > 5 ? "HIGH" : "MEDIUM"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header"><h2>Top Login IPs</h2></div>
          <div style={{ padding: "8px 18px 18px" }}>
            {data.top_login_ips.map(ip => <Bar key={ip.ip} label={ip.ip} value={ip.count} max={maxLoginIp} color="#6366f1" />)}
            {data.top_login_ips.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No logins recorded yet.</div>}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section className="panel">
          <div className="panel-header">
            <h2>Users with Many IPs</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>> 2 IPs used to login</span>
          </div>
          {data.users_multiple_ips.length === 0 ? (
            <div className="empty" style={{ color: "#10b981" }}>All users login from consistent IPs.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>User</th><th>IPs Used</th></tr></thead>
                <tbody>
                  {data.users_multiple_ips.map(u => (
                    <tr key={u.user_id}>
                      <td style={{ fontSize: 13 }}>{u.email}</td>
                      <td style={{ fontWeight: 700, color: u.ip_count > 5 ? "#ef4444" : "#f59e0b" }}>{u.ip_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-header"><h2>Recent Registrations</h2></div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {data.recent_registrations.length === 0 ? (
              <div className="empty">No new registrations.</div>
            ) : (
              data.recent_registrations.map((r, i) => (
                <div key={i} style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(r.created_at).toLocaleString()}</span>
                    <code style={{ fontSize: 11, color: "var(--text)" }}>{r.ip_address ?? "—"}</code>
                  </div>
                  {r.user_agent && (
                    <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.user_agent}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Tab = "overview" | "users" | "activity" | "analytics" | "traffic" | "runs" | "ai" | "sessions" | "security" | "reach" | "feedback" | "nps";

export default function AdminPage() {
  const { token, user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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

  const PRIMARY_TABS: { key: Tab; label: string }[] = [
    { key: "overview",  label: "Overview" },
    { key: "users",     label: "Users" },
    { key: "activity",  label: "Activity" },
    { key: "analytics", label: "Analytics" },
    { key: "traffic",   label: "Traffic" },
    { key: "runs",      label: "Runs" },
    { key: "ai",        label: "AI Usage" },
  ];

  const MORE_TABS: { key: Tab; label: string }[] = [
    { key: "sessions",  label: "Sessions" },
    { key: "security",  label: "Security" },
    { key: "reach",     label: "Reach" },
    { key: "feedback",  label: "Feedback" },
    { key: "nps",       label: "NPS" },
  ];

  const activeInMore = MORE_TABS.some(t => t.key === tab);

  return (
    <main className="page">
      <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: "1px solid var(--line)", flexWrap: "wrap", position: "relative" }}>
        {PRIMARY_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setMoreOpen(false); }}
            style={{
              padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none",
              color: tab === t.key ? "var(--text)" : "var(--muted)",
              borderBottom: tab === t.key ? "2px solid var(--strong)" : "2px solid transparent",
              marginBottom: -1, whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        ))}
        {/* More dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMoreOpen(o => !o)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none",
              color: activeInMore ? "var(--text)" : "var(--muted)",
              borderBottom: activeInMore ? "2px solid var(--strong)" : "2px solid transparent",
              marginBottom: -1, whiteSpace: "nowrap",
            }}
          >
            {activeInMore ? MORE_TABS.find(t => t.key === tab)?.label : "More"} ▾
          </button>
          {moreOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 100,
              background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)", minWidth: 160, overflow: "hidden",
            }}>
              {MORE_TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setMoreOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: tab === t.key ? "rgba(99,102,241,0.1)" : "transparent",
                    color: tab === t.key ? "var(--strong)" : "var(--text)",
                    border: "none", borderBottom: "1px solid var(--line)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {tab === "overview"  && <Overview stats={stats} logs={logs} logTotal={logTotal} />}
      {tab === "users"     && <UsersTab token={token!} />}
      {tab === "activity"  && <ActivityFeedTab token={token!} />}
      {tab === "analytics" && <AnalyticsTab token={token!} />}
      {tab === "traffic"   && <TrafficTab token={token!} />}
      {tab === "runs"      && <RunsAnalyticsTab token={token!} />}
      {tab === "ai"        && <AIUsageTab token={token!} />}
      {tab === "sessions"  && <SessionsTab token={token!} />}
      {tab === "security"  && <SecurityTab token={token!} />}
      {tab === "reach"     && <ReachTab token={token!} />}
      {tab === "feedback"  && <FeedbackTab token={token!} />}
      {tab === "nps"       && <NPSTab token={token!} />}
    </main>
  );
}
