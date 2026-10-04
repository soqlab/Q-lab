"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Department {
  id: string;
  name: string;
  description: string;
  parent_org_id: string;
  parent_dept_id: string | null;
  head_researcher: string | null;
  color: string;
  icon: string;
  member_ids: string[];
  created_at: string;
  metadata: Record<string, unknown>;
  children?: Department[];
}

interface DeptAnalytics {
  dept_id: string;
  dept_name: string;
  member_count: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_health_score: number | null;
  total_shots: number;
  estimated_qpu_seconds: number;
  by_month: { month: string; runs: number }[];
}

interface TreeData {
  org_id: string;
  departments: Department[];
  total: number;
}

interface CreateForm {
  name: string;
  description: string;
  parent_org_id: string;
  parent_dept_id: string;
  head_researcher: string;
  color: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

const PRESET_ICONS = ["ðŸ”¬", "âš›ï¸", "ðŸ§ ", "ðŸ–¥ï¸", "ðŸ“¡", "ðŸ”­", "ðŸ’¡", "ðŸ§ª"];

const DEFAULT_FORM: CreateForm = {
  name: "",
  description: "",
  parent_org_id: "org_default",
  parent_dept_id: "",
  head_researcher: "",
  color: "#6366f1",
  icon: "ðŸ”¬",
};

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function HealthDot({ score }: { score: number | null }) {
  const color =
    score === null ? "#9ca3af"
    : score >= 70 ? "#10b981"
    : score >= 40 ? "#f59e0b"
    : "#ef4444";
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 4 }} />
  );
}

function ColorBadge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
      background: `${color}22`, color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Department card (tree node)
// ---------------------------------------------------------------------------

function DeptCard({
  dept,
  depth,
  allDepts,
  onSelect,
  selectedId,
  analytics,
}: {
  dept: Department;
  depth: number;
  allDepts: Department[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  analytics: Record<string, DeptAnalytics>;
}) {
  const isSelected = selectedId === dept.id;
  const an = analytics[dept.id];

  return (
    <div style={{ marginLeft: depth * 24 }}>
      {/* Connector line for non-root */}
      {depth > 0 && (
        <div style={{
          marginLeft: -16,
          borderLeft: "2px solid var(--line, #e2e8f0)",
          borderBottom: "2px solid var(--line, #e2e8f0)",
          width: 16, height: 20,
          display: "inline-block",
          verticalAlign: "top",
          marginTop: 8,
          marginRight: 0,
        }} />
      )}

      <div
        className="panel"
        style={{
          cursor: "pointer",
          border: isSelected ? `2px solid ${dept.color}` : "1px solid var(--line, #e2e8f0)",
          marginBottom: 8,
          transition: "box-shadow 0.15s",
          display: "inline-block",
          width: depth > 0 ? `calc(100% - ${depth * 24 + 4}px)` : "100%",
        }}
        onClick={() => onSelect(dept.id)}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)")}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "")}
      >
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 22 }}>{dept.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: dept.color }}>
                {dept.name}
              </div>
              {dept.description && (
                <div style={{ fontSize: 12, color: "var(--muted, #6b7280)", marginTop: 2 }}>
                  {dept.description}
                </div>
              )}
            </div>
            <ColorBadge color={dept.color} label={`${dept.member_ids.length} members`} />
          </div>

          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted, #6b7280)" }}>
            {dept.head_researcher && (
              <span>Head: <strong style={{ color: "var(--fg, #111)" }}>{dept.head_researcher}</strong></span>
            )}
            {an && (
              <>
                <span>
                  <HealthDot score={an.avg_health_score} />
                  Health: <strong>{an.avg_health_score ?? "â€”"}</strong>
                </span>
                <span>Runs: <strong>{an.total_runs}</strong></span>
              </>
            )}
            <span style={{ marginLeft: "auto", opacity: 0.6 }}>
              {new Date(dept.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Expanded detail */}
        {isSelected && an && (
          <div style={{
            borderTop: `1px solid ${dept.color}33`,
            padding: "12px 16px",
            background: `${dept.color}08`,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 8 }}>
              {[
                ["Total Runs", an.total_runs],
                ["Completed", an.completed_runs],
                ["Avg Health", an.avg_health_score ?? "â€”"],
                ["QPU Est.", `${an.estimated_qpu_seconds.toFixed(1)}s`],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: dept.color }}>{String(value)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>{String(label)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted, #6b7280)", display: "flex", gap: 8 }}>
              <span>{an.member_count} members</span>
              <span>Â·</span>
              <span>Success rate: {(an.success_rate * 100).toFixed(1)}%</span>
              <span>Â·</span>
              <span>{an.total_shots.toLocaleString()} shots</span>
            </div>
          </div>
        )}
      </div>

      {/* Children */}
      {dept.children && dept.children.map(child => (
        <DeptCard
          key={child.id}
          dept={child}
          depth={depth + 1}
          allDepts={allDepts}
          onSelect={onSelect}
          selectedId={selectedId}
          analytics={analytics}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Department Modal
// ---------------------------------------------------------------------------

function CreateModal({
  allDepts,
  onClose,
  onCreated,
  token,
}: {
  allDepts: Department[];
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [form, setForm] = useState<CreateForm>({ ...DEFAULT_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        parent_org_id: form.parent_org_id || "org_default",
        parent_dept_id: form.parent_dept_id || null,
        head_researcher: form.head_researcher.trim() || null,
        color: form.color,
        icon: form.icon,
      };
      const res = await fetch("/qlab-api/api/v1/departments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create department");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div className="panel" style={{ width: 520, maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
        <div className="panel-header" style={{ padding: "16px 20px" }}>
          <h2 style={{ fontSize: 16 }}>Create Department</h2>
          <button
            className="button secondary"
            style={{ padding: "4px 12px", fontSize: 13 }}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Name */}
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Name *
            <input
              className="input"
              style={{ marginTop: 4, display: "block", width: "100%" }}
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder="e.g. Quantum Computing Lab"
              required
            />
          </label>

          {/* Description */}
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Description
            <textarea
              className="input"
              style={{ marginTop: 4, display: "block", width: "100%", minHeight: 72, resize: "vertical" }}
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Brief description of this departmentâ€¦"
            />
          </label>

          {/* Parent department */}
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Parent Department (optional)
            <select
              className="input"
              style={{ marginTop: 4, display: "block", width: "100%" }}
              value={form.parent_dept_id}
              onChange={e => set("parent_dept_id", e.target.value)}
            >
              <option value="">â€” None (top level) â€”</option>
              {allDepts.map(d => (
                <option key={d.id} value={d.id}>{d.icon} {d.name}</option>
              ))}
            </select>
          </label>

          {/* Head researcher */}
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Head Researcher (user ID or name)
            <input
              className="input"
              style={{ marginTop: 4, display: "block", width: "100%" }}
              value={form.head_researcher}
              onChange={e => set("head_researcher", e.target.value)}
              placeholder="e.g. 42 or dr.alice"
            />
          </label>

          {/* Color picker */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Color</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set("color", c)}
                  style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: c, border: form.color === c ? "3px solid #111" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={e => set("color", e.target.value)}
                style={{ width: 28, height: 28, padding: 0, border: "none", borderRadius: 6, cursor: "pointer" }}
                title="Custom color"
              />
            </div>
          </div>

          {/* Icon */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Icon</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRESET_ICONS.map(ic => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => set("icon", ic)}
                  style={{
                    fontSize: 20, padding: "4px 8px", borderRadius: 6,
                    background: form.icon === ic ? `${form.color}22` : "var(--surface, #f8fafc)",
                    border: form.icon === ic ? `2px solid ${form.color}` : "1px solid var(--line, #e2e8f0)",
                    cursor: "pointer",
                  }}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", color: "#dc2626", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
              {error}
            </div>
          )}

          <button className="button" type="submit" disabled={saving} style={{ alignSelf: "flex-end" }}>
            {saving ? "Creatingâ€¦" : "Create Department"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cross-department analytics table
// ---------------------------------------------------------------------------

function AnalyticsTable({ depts, analytics }: { depts: Department[]; analytics: Record<string, DeptAnalytics> }) {
  if (!depts.length) return null;
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Cross-Department Analytics</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Members</th>
              <th>Total Runs</th>
              <th>Completed</th>
              <th>Avg Health Score</th>
              <th>Success Rate</th>
              <th>Est. QPU Time</th>
            </tr>
          </thead>
          <tbody>
            {depts.map(d => {
              const an = analytics[d.id];
              return (
                <tr key={d.id}>
                  <td>
                    <span style={{ marginRight: 6 }}>{d.icon}</span>
                    <span style={{ color: d.color, fontWeight: 600 }}>{d.name}</span>
                  </td>
                  <td>{d.member_ids.length}</td>
                  <td>{an ? an.total_runs : "â€”"}</td>
                  <td>{an ? an.completed_runs : "â€”"}</td>
                  <td>
                    {an ? (
                      <>
                        <HealthDot score={an.avg_health_score} />
                        {an.avg_health_score ?? "â€”"}
                      </>
                    ) : "â€”"}
                  </td>
                  <td>{an ? `${(an.success_rate * 100).toFixed(1)}%` : "â€”"}</td>
                  <td>{an ? `${an.estimated_qpu_seconds.toFixed(1)}s` : "â€”"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DepartmentsPage() {
  const { token, user } = useAuth();
  const router = useRouter();

  const [tree, setTree] = useState<TreeData | null>(null);
  const [allDepts, setAllDepts] = useState<Department[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, DeptAnalytics>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const canManage = user?.role === "owner" || user?.role === "admin";

  const authHeaders = useCallback((): HeadersInit => {
    const tok = token ?? localStorage.getItem("qlab_token");
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  }, [token]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [treeRes, listRes] = await Promise.all([
        fetch("/qlab-api/api/v1/departments/tree", { headers: authHeaders() }),
        fetch("/qlab-api/api/v1/departments", { headers: authHeaders() }),
      ]);
      if (!treeRes.ok) throw new Error(`Tree fetch failed: ${treeRes.status}`);
      if (!listRes.ok) throw new Error(`List fetch failed: ${listRes.status}`);
      const treeData: TreeData = await treeRes.json();
      const deptList: Department[] = await listRes.json();
      setTree(treeData);
      setAllDepts(deptList);

      // Load analytics for each department in parallel
      const analyticsResults = await Promise.allSettled(
        deptList.map(d =>
          fetch(`/qlab-api/api/v1/departments/${d.id}/analytics`, { headers: authHeaders() })
            .then(r => r.ok ? r.json() as Promise<DeptAnalytics> : null)
        )
      );
      const an: Record<string, DeptAnalytics> = {};
      deptList.forEach((d, i) => {
        const res = analyticsResults[i];
        if (res.status === "fulfilled" && res.value) {
          an[d.id] = res.value;
        }
      });
      setAnalytics(an);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) {
      router.push("/login");
      return;
    }
    void loadData();
  }, [token, router, loadData]);

  if (loading) return <main className="page"><div className="empty">Loading departmentsâ€¦</div></main>;
  if (error) return <main className="page"><div className="empty" style={{ color: "var(--danger, #dc2626)" }}>{error}</div></main>;

  const rootDepts = tree?.departments ?? [];

  return (
    <main className="page">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
            ðŸ› Department Hierarchy
          </h1>
          <div style={{ fontSize: 13, color: "var(--muted, #6b7280)" }}>
            {allDepts.length} department{allDepts.length !== 1 ? "s" : ""} in your institution
          </div>
        </div>
        {canManage && (
          <button className="button" onClick={() => setShowCreate(true)} type="button">
            + Add Department
          </button>
        )}
      </div>

      {/* Tree */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Organization Tree</h2>
          <span style={{ fontSize: 12, color: "var(--muted, #6b7280)" }}>
            Click a department to expand details
          </span>
        </div>
        <div style={{ padding: "16px 18px" }}>
          {rootDepts.length === 0 ? (
            <div className="empty" style={{ paddingBlock: 32 }}>
              No departments yet.{canManage && " Click \"Add Department\" to create the first one."}
            </div>
          ) : (
            rootDepts.map(dept => (
              <DeptCard
                key={dept.id}
                dept={dept}
                depth={0}
                allDepts={allDepts}
                onSelect={id => setSelectedId(prev => prev === id ? null : id)}
                selectedId={selectedId}
                analytics={analytics}
              />
            ))
          )}
          {canManage && (
            <button
              className="button secondary"
              style={{ marginTop: 12, fontSize: 13 }}
              onClick={() => setShowCreate(true)}
              type="button"
            >
              + Add Department
            </button>
          )}
        </div>
      </section>

      {/* Cross-dept analytics */}
      <AnalyticsTable depts={allDepts} analytics={analytics} />

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          allDepts={allDepts}
          onClose={() => setShowCreate(false)}
          onCreated={() => void loadData()}
          token={token ?? localStorage.getItem("qlab_token") ?? ""}
        />
      )}
    </main>
  );
}

