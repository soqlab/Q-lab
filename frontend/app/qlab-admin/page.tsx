"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
  run_count: number;
}

interface Stats {
  runs: { total: number; completed: number; failed: number; completion_rate: number };
  users: number;
  organizations: number;
  webhooks: number;
  benchmarks: number;
  audit_events: number;
}

interface AuditLog {
  id: number;
  action: string;
  resource_type: string;
  user_id: number | null;
  ip_address: string | null;
  created_at: string;
}

const ROLE_COLORS: Record<string, string> = {
  owner: "#6366f1",
  admin: "#1d6f8f",
  researcher: "#10b981",
  viewer: "#9aa8b6",
};

export default function QLabAdminPage() {
  const { token, user, loading } = useAuth();
  const router = useRouter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "activity">("overview");
  const [err, setErr] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [purgeConfirmId, setPurgeConfirmId] = useState<number | null>(null);
  const [purgingId, setPurgingId] = useState<number | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!token) { router.push("/login"); return; }
    if (!user) return;
    if (user.role !== "owner" && user.role !== "admin") return;
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, user]);

  async function load() {
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [sRes, uRes, lRes] = await Promise.all([
        fetch("/qlab-api/api/v1/admin/stats", { headers: h }),
        fetch("/qlab-api/api/v1/admin/users", { headers: h }),
        fetch("/qlab-api/api/v1/admin/audit-logs?limit=50", { headers: h }),
      ]);
      if (!sRes.ok) {
        const txt = await sRes.text();
        setErr(`Stats API error (${sRes.status}): ${txt}`);
        return;
      }
      if (!uRes.ok) {
        const txt = await uRes.text();
        setErr(`Users API error (${uRes.status}): ${txt}`);
        return;
      }
      if (!lRes.ok) {
        const txt = await lRes.text();
        setErr(`Logs API error (${lRes.status}): ${txt}`);
        return;
      }
      const [s, u, l] = await Promise.all([sRes.json(), uRes.json(), lRes.json()]);
      setStats(s);
      setUsers(Array.isArray(u) ? u : []);
      setLogs(l?.items ?? []);
    } catch (e) {
      setErr(`Failed to load admin data: ${String(e)}`);
    }
  }

  async function removeUser(userId: number) {
    setRemovingId(userId);
    try {
      const res = await fetch(`/qlab-api/api/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.detail ?? "Failed to remove user");
      } else {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: false } : u));
        setConfirmId(null);
      }
    } catch {
      setErr("Failed to remove user");
    } finally {
      setRemovingId(null);
    }
  }

  async function purgeUser(userId: number) {
    setPurgingId(userId);
    try {
      const res = await fetch(`/qlab-api/api/v1/admin/users/${userId}/purge`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.detail ?? "Failed to purge user");
      } else {
        setUsers(prev => prev.filter(u => u.id !== userId));
        setPurgeConfirmId(null);
      }
    } catch {
      setErr("Failed to purge user");
    } finally {
      setPurgingId(null);
    }
  }

  if (loading || (!stats && !err && (!user || (user.role === "owner" || user.role === "admin")))) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#5f6f80" }}>
        Loading…
      </div>
    );
  }

  if (!user || (user.role !== "owner" && user.role !== "admin")) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100vh", fontFamily: "system-ui, sans-serif", background: "#0d1b2a",
        gap: 16, textAlign: "center", padding: 24,
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #1d4e6f)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 36, marginBottom: 8,
          boxShadow: "0 0 40px rgba(99,102,241,0.4)",
        }}>
          🔒
        </div>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 24 }}>Access Restricted</div>
        <div style={{ color: "#64748b", fontSize: 14, maxWidth: 320, lineHeight: 1.6 }}>
          This area is for Q-Lab administrators only. Your account does not have the required permissions.
        </div>
        <a href="/runs" style={{
          marginTop: 12, background: "#6366f1", color: "#fff", padding: "10px 24px",
          borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 14,
        }}>
          Back to Q-Lab →
        </a>
      </div>
    );
  }

  const tab = (id: typeof activeTab, label: string) => (
    <button
      onClick={() => setActiveTab(id)}
      style={{
        padding: "8px 20px", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13,
        background: activeTab === id ? "#0d1b2a" : "transparent",
        color: activeTab === id ? "#fff" : "#5f6f80",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8fa", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#0d1b2a", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "#6366f1", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>Q</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>Q-Lab Admin</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>Platform Management</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#64748b", fontSize: 13 }}>Signed in as <strong style={{ color: "#94a3b8" }}>{user?.email}</strong></span>
          <a href="/runs" style={{ color: "#6366f1", fontSize: 13, textDecoration: "none", fontWeight: 600 }}>← Back to Q-Lab</a>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {err && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", marginBottom: 20 }}>{err}</div>}

        {/* KPI strip */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 28 }}>
            {[
              { label: "Total Users", value: stats.users ?? 0, color: "#6366f1" },
              { label: "Total Runs", value: stats.runs?.total ?? 0, color: "#1d6f8f" },
              { label: "Completed", value: stats.runs?.completed ?? 0, color: "#10b981" },
              { label: "Failed", value: stats.runs?.failed ?? 0, color: "#e74c3c" },
              { label: "Orgs", value: stats.organizations ?? 0, color: "#f59e0b" },
              { label: "Audit Events", value: stats.audit_events ?? 0, color: "#8b5cf6" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "#fff", borderRadius: 10, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa8b6", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#fff", borderRadius: 8, padding: 4, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", width: "fit-content" }}>
          {tab("overview", "Overview")}
          {tab("users", `Users (${users.length})`)}
          {tab("activity", "Activity Log")}
        </div>

        {/* Overview tab */}
        {activeTab === "overview" && stats && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Run Health</h3>
              {[
                ["Completion rate", `${((stats.runs?.completion_rate ?? 0) * 100).toFixed(1)}%`],
                ["Failure rate", `${(((stats.runs?.failed ?? 0) / (stats.runs?.total || 1)) * 100).toFixed(1)}%`],
                ["Total benchmarks", stats.benchmarks ?? 0],
                ["Active webhooks", stats.webhooks ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f3f5", fontSize: 14 }}>
                  <span style={{ color: "#5f6f80" }}>{String(label)}</span>
                  <span style={{ fontWeight: 600 }}>{String(value)}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 10, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Users by Role</h3>
              {["owner", "admin", "researcher", "viewer"].map((role) => {
                const count = users.filter((u) => u.role === role).length;
                return (
                  <div key={role} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f1f3f5", fontSize: 14 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLORS[role] ?? "#ccc", display: "inline-block" }} />
                      <span style={{ textTransform: "capitalize", color: "#5f6f80" }}>{role}</span>
                    </span>
                    <span style={{ fontWeight: 700, color: ROLE_COLORS[role] ?? "#333" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Users tab */}
        {activeTab === "users" && (
          <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f3f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>All Users</h3>
              <span style={{ fontSize: 12, color: "#9aa8b6" }}>{users.length} total</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8f9fb" }}>
                    {["Name", "Email", "Role", "Runs", "Signed Up", "Status", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#5f6f80", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={{ borderTop: "1px solid #f1f3f5" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{u.name || "—"}</td>
                      <td style={{ padding: "12px 16px", color: "#374151" }}>{u.email}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ background: `${ROLE_COLORS[u.role]}18`, color: ROLE_COLORS[u.role] ?? "#333", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>
                          {u.role}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 700, color: "#1d6f8f" }}>{u.run_count}</td>
                      <td style={{ padding: "12px 16px", color: "#9aa8b6", fontSize: 12 }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ color: u.is_active ? "#10b981" : "#e74c3c", fontWeight: 600, fontSize: 12 }}>
                          {u.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                        {u.id !== user?.id && (
                          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {/* Deactivate (soft delete) */}
                            {u.is_active && (
                              confirmId === u.id ? (
                                <>
                                  <button onClick={() => removeUser(u.id)} disabled={removingId === u.id}
                                    style={{ background: "#e74c3c", color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                                    {removingId === u.id ? "…" : "Confirm"}
                                  </button>
                                  <button onClick={() => setConfirmId(null)}
                                    style={{ background: "transparent", border: "1px solid #d1d5db", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#5f6f80" }}>
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => { setConfirmId(u.id); setPurgeConfirmId(null); }}
                                  style={{ background: "transparent", border: "1px solid #fecaca", color: "#e74c3c", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                                  Disable
                                </button>
                              )
                            )}
                            {/* Purge (hard delete) */}
                            {purgeConfirmId === u.id ? (
                              <>
                                <button onClick={() => purgeUser(u.id)} disabled={purgingId === u.id}
                                  style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
                                  {purgingId === u.id ? "…" : "Yes, delete"}
                                </button>
                                <button onClick={() => setPurgeConfirmId(null)}
                                  style={{ background: "transparent", border: "1px solid #d1d5db", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#5f6f80" }}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button onClick={() => { setPurgeConfirmId(u.id); setConfirmId(null); }}
                                style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
                                Purge
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div style={{ padding: "32px", textAlign: "center", color: "#9aa8b6" }}>No users yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Activity tab */}
        {activeTab === "activity" && (
          <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f3f5" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Recent Activity</h3>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8f9fb" }}>
                    {["Time", "Action", "Resource", "User", "IP"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#5f6f80", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((lg) => (
                    <tr key={lg.id} style={{ borderTop: "1px solid #f1f3f5" }}>
                      <td style={{ padding: "10px 16px", color: "#9aa8b6", fontSize: 12, whiteSpace: "nowrap" }}>{new Date(lg.created_at).toLocaleString()}</td>
                      <td style={{ padding: "10px 16px" }}><code style={{ background: "#f1f3f5", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>{lg.action}</code></td>
                      <td style={{ padding: "10px 16px", color: "#5f6f80", fontSize: 12 }}>{lg.resource_type ?? "—"}</td>
                      <td style={{ padding: "10px 16px", color: "#5f6f80", fontSize: 12 }}>{lg.user_id ?? "—"}</td>
                      <td style={{ padding: "10px 16px", color: "#9aa8b6", fontSize: 12 }}>{lg.ip_address ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && (
                <div style={{ padding: "32px", textAlign: "center", color: "#9aa8b6" }}>No activity yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
