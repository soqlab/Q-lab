"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Folder, History } from "lucide-react";
import { createProject, fetchProjects, type Project } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

function ProjectCard({ project }: { project: Project }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 18px", borderBottom: "1px solid var(--line)", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "var(--info-bg)", display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Folder size={18} color="var(--strong)" aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <Link href={`/projects/${project.slug}`} style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", textDecoration: "none" }}>
            {project.name}
          </Link>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            <code style={{ background: "var(--panel-2)", padding: "1px 5px", borderRadius: 4 }}>{project.slug}</code>
            {project.description && <> — {project.description}</>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{project.run_count}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>runs</div>
        </div>
        <Link className="button secondary" href={`/projects/${project.slug}`} style={{ fontSize: 13, height: 32, padding: "0 12px" }}>
          <Folder size={14} aria-hidden="true" /> Dashboard
        </Link>
        <Link className="button secondary" href={`/?project=${project.slug}`} style={{ fontSize: 13, height: 32, padding: "0 12px" }}>
          <History size={14} aria-hidden="true" /> Runs
        </Link>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { token } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setProjects(await fetchProjects());
    } catch {
      setError("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !name.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      await createProject(token!, { slug: slug.trim(), name: name.trim(), description: description.trim() || undefined });
      setSlug(""); setName(""); setDescription("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  function handleSlugInput(value: string) {
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-"));
    if (!name) setName(value);
  }

  return (
    <main className="page">
      <section className="summary-grid" aria-label="Project overview">
        <div className="metric">
          <div className="metric-label">Total Projects</div>
          <div className="metric-value">{projects.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Total Runs</div>
          <div className="metric-value">{projects.reduce((s, p) => s + p.run_count, 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Avg Runs / Project</div>
          <div className="metric-value">
            {projects.length ? (projects.reduce((s, p) => s + p.run_count, 0) / projects.length).toFixed(1) : "—"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Most Active</div>
          <div className="metric-value" style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projects.length ? (projects.reduce((a, b) => a.run_count >= b.run_count ? a : b)).name : "—"}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Projects ({projects.length})</h2>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Created automatically when a run specifies a project slug</span>
        </div>
        {loading && <div className="empty">Loading…</div>}
        {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}
        {!loading && !error && projects.length === 0 && (
          <div className="empty">
            {"No projects yet. Set "}
            <code>{"project=\"my-project\""}</code>
            {" in "}
            <code>qlab.init()</code>
            {" to create one automatically."}
          </div>
        )}
        {projects.map(p => <ProjectCard key={p.slug} project={p} />)}
      </section>

      {token && (
        <section className="panel">
          <div className="panel-header"><h2>Create Project</h2></div>
          <form onSubmit={handleCreate} style={{ padding: "16px 18px", display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "var(--muted)" }}>Slug <span style={{ color: "var(--muted)", fontWeight: 400 }}>(URL-safe, auto-formatted)</span></label>
                <input className="input" value={slug} onChange={e => handleSlugInput(e.target.value)} placeholder="e.g. vqe-2026" required />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, color: "var(--muted)" }}>Display name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. VQE 2026" required />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, color: "var(--muted)" }}>Description <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description of this project" />
            </div>
            {formError && <div className="auth-error">{formError}</div>}
            <div>
              <button className="button" type="submit" disabled={creating || !slug || !name}>
                <Plus size={16} aria-hidden="true" /> {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
