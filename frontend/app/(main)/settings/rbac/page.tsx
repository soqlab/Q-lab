"use client";

import { useEffect, useState } from "react";
import { getRbacRoles, listRbacUsers, changeUserRole, RbacRole, RbacUser } from "../../../../lib/api";

const ROLE_COLOR: Record<string, string> = {
  owner: "#f59e0b", admin: "#3b82f6", researcher: "#10b981", viewer: "#6b7280",
};

export default function RBACPage() {
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [users, setUsers] = useState<RbacUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [changing, setChanging] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([getRbacRoles(), listRbacUsers()])
      .then(([r, u]) => { setRoles(r.roles); setUsers(u); setErr(""); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRoleChange = async (userId: number, role: string) => {
    setChanging(userId);
    try {
      await changeUserRole(userId, role);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setChanging(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Role Management</h1>

      {err && <div className="alert alert-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* Role cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        {roles.map(role => (
          <div key={role.name} className="panel" style={{ padding: 16, flex: 1, minWidth: 180 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                background: `${ROLE_COLOR[role.name] ?? "#6b7280"}22`,
                color: ROLE_COLOR[role.name] ?? "#6b7280",
              }}>{role.name}</span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>rank {role.rank}</span>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>{role.description}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {role.permissions.map(p => (
                <span key={p} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 2, background: "#1f2937", color: "#9ca3af" }}>{p}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="panel">
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Users</h2>
          <button className="btn" onClick={load} style={{ fontSize: 12 }}>Refresh</button>
        </div>
        {loading ? (
          <div style={{ padding: 16, color: "#9ca3af" }}>Loading...</div>
        ) : (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                {["ID", "Email", "Name", "Role", "Active", "Joined", "Change Role"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#9ca3af", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>No users found.</td></tr>
              ) : users.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid #111827" }}>
                  <td style={{ padding: "9px 12px", color: "#6b7280", fontSize: 12 }}>{u.id}</td>
                  <td style={{ padding: "9px 12px" }}>{u.email}</td>
                  <td style={{ padding: "9px 12px", color: "#9ca3af" }}>{u.name || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600,
                      background: `${ROLE_COLOR[u.role] ?? "#6b7280"}22`,
                      color: ROLE_COLOR[u.role] ?? "#6b7280",
                    }}>{u.role}</span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ color: u.is_active ? "#10b981" : "#ef4444" }}>
                      {u.is_active ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", color: "#6b7280", fontSize: 12 }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <select
                      className="input"
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      disabled={changing === u.id}
                      style={{ fontSize: 12, padding: "3px 6px" }}
                    >
                      {["viewer", "researcher", "admin", "owner"].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
