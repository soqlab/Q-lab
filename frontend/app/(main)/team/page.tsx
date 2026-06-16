"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Plus, Shield, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import {
  acceptInvite,
  changeMemberRole,
  fetchTeamInvites,
  fetchTeamMembers,
  inviteMember,
  removeMember,
  revokeInvite,
  type InviteResult,
  type OrgInvite,
  type TeamMember,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const ROLES = ["viewer", "researcher", "admin", "owner"] as const;
type Role = typeof ROLES[number];

const ROLE_COLORS: Record<string, string> = {
  owner: "#7c3aed",
  admin: "#1d6f8f",
  researcher: "#27ae60",
  viewer: "#6b7280",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
      background: `${ROLE_COLORS[role] ?? "#6b7280"}18`,
      color: ROLE_COLORS[role] ?? "#6b7280",
      textTransform: "capitalize",
    }}>
      {role}
    </span>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <code style={{ fontSize: 12, background: "#f0f3f7", padding: "4px 8px", borderRadius: 6, flex: 1, wordBreak: "break-all" }}>{url}</code>
      <button className="button secondary" style={{ height: 30, padding: "0 10px", fontSize: 12, flexShrink: 0 }} onClick={copy} type="button">
        {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
      </button>
    </div>
  );
}

export default function TeamPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("researcher");
  const [sending, setSending] = useState(false);
  const [newInvite, setNewInvite] = useState<InviteResult | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const canManage = user?.role === "owner" || user?.role === "admin";

  useEffect(() => {
    if (token === undefined) return;
    if (!token) { router.push("/login"); return; }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, inv] = await Promise.all([
        fetchTeamMembers(token!),
        canManage ? fetchTeamInvites(token!) : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvites(inv);
    } catch {
      setError("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setInviteError(null);
    setNewInvite(null);
    try {
      const result = await inviteMember(token!, email.trim(), role);
      setNewInvite(result);
      setEmail("");
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(memberId: number, newRole: string) {
    try {
      await changeMemberRole(token!, memberId, newRole);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    }
  }

  async function handleRemove(memberId: number) {
    try {
      await removeMember(token!, memberId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handleRevokeInvite(inviteId: number) {
    try {
      await revokeInvite(token!, inviteId);
      await load();
    } catch {
      setError("Failed to revoke invite");
    }
  }

  if (!user?.org_id) {
    return (
      <main className="page">
        <section className="panel" style={{ padding: "40px 32px", textAlign: "center" }}>
          <Users size={40} style={{ color: "#9aa8b6", marginBottom: 16 }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No organization found</div>
          <div style={{ color: "#5f6f80", fontSize: 14, maxWidth: 360, margin: "0 auto" }}>
            Your account is not linked to an organization. Create a new account with an org name, or accept a team invite.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      {error && <div className="auth-error">{error}</div>}

      {/* Invite panel — owners/admins only */}
      {canManage && (
        <section className="panel">
          <div className="panel-header"><UserPlus size={16} /> Invite team member</div>
          <form onSubmit={handleInvite} style={{ padding: "16px 18px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
              <label style={{ fontSize: 13, color: "#5f6f80" }}>Email address</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "#5f6f80" }}>Role</label>
              <select className="input" value={role} onChange={e => setRole(e.target.value as Role)} style={{ height: 38 }}>
                {ROLES.map(r => (
                  <option key={r} value={r} style={{ textTransform: "capitalize" }}>{r}</option>
                ))}
              </select>
            </div>
            <button className="button" type="submit" disabled={sending || !email.trim()} style={{ height: 38 }}>
              <Plus size={15} /> {sending ? "Sending…" : "Send invite"}
            </button>
          </form>

          {inviteError && <div style={{ margin: "0 18px 16px" }} className="auth-error">{inviteError}</div>}

          {newInvite && (
            <div style={{ margin: "0 18px 18px", padding: "14px 16px", background: "#eaf6ef", border: "1px solid #c0e8d0", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontWeight: 600, color: "#1f8a5b", fontSize: 14 }}>
                <Link2 size={15} /> Invite link ready — share this with {newInvite.email}
              </div>
              <CopyableLink url={newInvite.invite_url} />
              <div style={{ marginTop: 8, fontSize: 12, color: "#5f6f80" }}>
                Expires in 7 days. The recipient must visit this link and log in or create an account to join.
              </div>
            </div>
          )}
        </section>
      )}

      {/* Members list */}
      <section className="panel">
        <div className="panel-header">
          <Users size={16} /> Members ({members.length})
        </div>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : members.length === 0 ? (
          <div className="empty">No members yet. Invite your team above.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  {canManage && <th style={{ width: 160 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 500 }}>
                      {m.name}
                      {m.id === user?.id && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "#9aa8b6" }}>(you)</span>
                      )}
                    </td>
                    <td style={{ color: "#5f6f80", fontSize: 13 }}>{m.email}</td>
                    <td>
                      {canManage && m.id !== user?.id ? (
                        <select
                          className="input"
                          value={m.role}
                          onChange={e => void handleRoleChange(m.id, e.target.value)}
                          style={{ height: 30, fontSize: 12, padding: "0 8px", minWidth: 110 }}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "#9aa8b6" }}>{new Date(m.created_at).toLocaleDateString()}</td>
                    {canManage && (
                      <td>
                        {m.id !== user?.id && (
                          <button
                            className="button secondary"
                            style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                            onClick={() => { if (confirm(`Remove ${m.name} from the team?`)) void handleRemove(m.id); }}
                          >
                            <UserMinus size={13} /> Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending invites */}
      {canManage && invites.length > 0 && (
        <section className="panel">
          <div className="panel-header"><Shield size={16} /> Pending Invites ({invites.filter(i => !i.accepted_at).length})</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Invite link</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invites.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 500 }}>{inv.email}</td>
                    <td><RoleBadge role={inv.role} /></td>
                    <td>
                      {inv.accepted_at ? (
                        <span style={{ fontSize: 12, color: "#27ae60", fontWeight: 600 }}>Accepted</span>
                      ) : new Date(inv.expires_at) < new Date() ? (
                        <span style={{ fontSize: 12, color: "#e74c3c", fontWeight: 600 }}>Expired</span>
                      ) : (
                        <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>Pending</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "#9aa8b6" }}>{new Date(inv.expires_at).toLocaleDateString()}</td>
                    <td>
                      {inv.invite_url && !inv.accepted_at && (
                        <button
                          className="button secondary"
                          style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                          onClick={() => { void navigator.clipboard.writeText(inv.invite_url!); }}
                          type="button"
                        >
                          <Copy size={12} /> Copy link
                        </button>
                      )}
                    </td>
                    <td>
                      {!inv.accepted_at && (
                        <button
                          className="button secondary"
                          style={{ height: 28, fontSize: 12, color: "#e74c3c", borderColor: "#fecaca", padding: "0 10px" }}
                          onClick={() => void handleRevokeInvite(inv.id)}
                        >
                          <Trash2 size={12} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Role guide */}
      <section className="panel">
        <div className="panel-header"><Shield size={16} /> Role permissions</div>
        <div style={{ padding: "14px 18px" }}>
          <table style={{ fontSize: 13, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingBottom: 8, color: "#5f6f80" }}>Role</th>
                <th style={{ textAlign: "left", paddingBottom: 8, color: "#5f6f80" }}>Can do</th>
              </tr>
            </thead>
            <tbody>
              {[
                { role: "viewer", desc: "Read runs, view analytics, download exports" },
                { role: "researcher", desc: "All viewer rights + submit runs, create projects, manage own API keys" },
                { role: "admin", desc: "All researcher rights + invite members, change roles, manage webhooks" },
                { role: "owner", desc: "All admin rights + remove members, manage billing, delete org" },
              ].map(({ role: r, desc }) => (
                <tr key={r} style={{ borderTop: "1px solid #f0f3f7" }}>
                  <td style={{ padding: "8px 0", paddingRight: 24, whiteSpace: "nowrap" }}><RoleBadge role={r} /></td>
                  <td style={{ padding: "8px 0", color: "#374151" }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
