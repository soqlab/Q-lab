"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FlaskConical, Plus, Trash2, CheckCircle, Clock, XCircle, PauseCircle } from "lucide-react";
import { listCampaigns, createCampaign, type CampaignSummary, type GridAxis } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  running:   { icon: Clock,         color: "#1d6f8f", bg: "#ebf5fb" },
  completed: { icon: CheckCircle,   color: "#1f8a5b", bg: "#eaf6ef" },
  cancelled: { icon: XCircle,       color: "#e74c3c", bg: "#fdecea" },
  paused:    { icon: PauseCircle,   color: "#e67e22", bg: "#fef9ec" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { icon: Clock, color: "#888", bg: "#f4f4f4" };
  const Icon = cfg.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      <Icon size={12} /> {status}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const color = pct >= 100 ? "#27ae60" : "#1d6f8f";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#e8ecf0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 12, color: "#5f6f80", flexShrink: 0, width: 60, textAlign: "right" }}>
        {done}/{total}
      </span>
    </div>
  );
}

function CampaignCard({ c }: { c: CampaignSummary }) {
  const done = c.total_combinations - (c.total_combinations - Math.round(c.completion_rate * c.total_combinations));
  return (
    <Link href={`/campaigns/${c.campaign_id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      <div className="panel" style={{ cursor: "pointer", transition: "box-shadow 0.15s" }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)")}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "")}
      >
        <div style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{c.name}</div>
              {c.description && <div style={{ fontSize: 13, color: "#5f6f80", lineHeight: 1.4 }}>{c.description}</div>}
            </div>
            <StatusBadge status={c.status} />
          </div>

          <ProgressBar done={Math.round(c.completion_rate * c.total_combinations)} total={c.total_combinations} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1d6f8f" }}>{c.total_combinations}</div>
              <div style={{ fontSize: 11, color: "#5f6f80" }}>combinations</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{c.run_count}</div>
              <div style={{ fontSize: 11, color: "#5f6f80" }}>runs</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.avg_health != null ? (c.avg_health >= 70 ? "#27ae60" : c.avg_health >= 40 ? "#e67e22" : "#e74c3c") : "#bbb" }}>
                {c.avg_health != null ? c.avg_health.toFixed(0) : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#5f6f80" }}>avg health</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{c.grid_spec?.grid?.length ?? 0}</div>
              <div style={{ fontSize: 11, color: "#5f6f80" }}>axes</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {(c.grid_spec?.grid ?? []).map(ax => (
              <span key={ax.name} style={{ fontSize: 11, background: "#ebf5fb", color: "#1d6f8f", padding: "2px 8px", borderRadius: 999 }}>
                {ax.name} ({ax.values.length})
              </span>
            ))}
            {c.project && (
              <span style={{ fontSize: 11, background: "#f4f4f4", color: "#5f6f80", padding: "2px 8px", borderRadius: 999 }}>
                {c.project}
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
            {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}

function NewAxisRow({ axis, index, onChange, onRemove }: {
  axis: GridAxis; index: number;
  onChange: (i: number, field: "name" | "values_raw", val: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <input className="input" placeholder="Parameter name" value={axis.name}
        onChange={e => onChange(index, "name", e.target.value)}
        style={{ width: 180, flexShrink: 0 }} />
      <input className="input" placeholder='Values (comma-separated, e.g. 100,500,1000 or "ibm_kyoto","ibm_osaka")'
        value={(axis as GridAxis & { _raw?: string })._raw ?? axis.values.join(", ")}
        onChange={e => onChange(index, "values_raw", e.target.value)}
        style={{ flex: 1 }} />
      <button className="button secondary" type="button" onClick={() => onRemove(index)}
        style={{ height: 36, padding: "0 10px", flexShrink: 0 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function parseValues(raw: string): (string | number)[] {
  return raw.split(",").map(v => {
    const s = v.trim().replace(/^["']|["']$/g, "");
    const n = Number(s);
    return isNaN(n) || s === "" ? s : n;
  }).filter(v => v !== "");
}

export default function CampaignsPage() {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [axes, setAxes] = useState<Array<GridAxis & { _raw: string }>>([
    { name: "backend", values: [], _raw: "" },
    { name: "shots", values: [], _raw: "" },
  ]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ campaign_id: string; combinations: number; snippet: string } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setCampaigns(await listCampaigns());
    } catch { setError("Failed to load campaigns"); }
    finally { setLoading(false); }
  }

  function updateAxis(i: number, field: "name" | "values_raw", val: string) {
    setAxes(prev => prev.map((ax, idx) => {
      if (idx !== i) return ax;
      if (field === "name") return { ...ax, name: val };
      return { ...ax, _raw: val, values: parseValues(val) };
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const validAxes = axes.filter(ax => ax.name.trim() && ax.values.length > 0);
    if (validAxes.length === 0) { setError("Add at least one axis with values"); return; }
    setCreating(true);
    setError(null);
    try {
      const result = await createCampaign({
        name,
        description: description || undefined,
        project: project || undefined,
        grid: validAxes.map(ax => ({ name: ax.name, values: ax.values })),
      });
      setCreated({ campaign_id: result.campaign_id, combinations: result.total_combinations, snippet: result.sdk_snippet });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally { setCreating(false); }
  }

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><FlaskConical size={17} /> Experiment Campaigns</h2>
          <button className="button" onClick={() => { setShowCreate(s => !s); setCreated(null); }}>
            <Plus size={15} /> New Campaign
          </button>
        </div>

        {showCreate && (
          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border, #dfe4ea)" }}>
            {created ? (
              <div>
                <div style={{ background: "#eaf6ef", border: "1px solid #c0e8d0", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: "#1f8a5b", marginBottom: 4 }}>
                    Campaign created — {created.combinations} combinations
                  </div>
                  <code style={{ fontSize: 12 }}>{created.campaign_id}</code>
                </div>
                <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>SDK snippet</div>
                <pre style={{ fontSize: 12, background: "var(--panel-2, #f7f8fa)", padding: "12px 14px", borderRadius: 6, overflow: "auto", margin: "0 0 12px" }}>
                  {created.snippet}
                </pre>
                <Link className="button" href={`/campaigns/${created.campaign_id}`}>Open Campaign →</Link>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={{ fontSize: 13, color: "var(--muted, #5f6f80)", display: "block", marginBottom: 4 }}>Campaign name *</label>
                    <input className="input" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. QAOA depth sweep" style={{ width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: "var(--muted, #5f6f80)", display: "block", marginBottom: 4 }}>Project (optional)</label>
                    <input className="input" value={project} onChange={e => setProject(e.target.value)} placeholder="project-slug" style={{ width: "100%" }} />
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 13, color: "var(--muted, #5f6f80)", display: "block", marginBottom: 4 }}>Description</label>
                    <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What are you testing?" style={{ width: "100%" }} />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Parameter Grid</span>
                    <button type="button" className="button secondary" style={{ height: 28, fontSize: 12 }}
                      onClick={() => setAxes(prev => [...prev, { name: "", values: [], _raw: "" }])}>
                      <Plus size={12} /> Add Axis
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {axes.map((ax, i) => (
                      <NewAxisRow key={i} axis={ax} index={i} onChange={updateAxis} onRemove={idx => setAxes(prev => prev.filter((_, j) => j !== idx))} />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>
                    Total combinations: <strong>{axes.filter(a => a.values.length > 0).reduce((p, a) => p * a.values.length, 1)}</strong>
                  </div>
                </div>

                {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}
                <button className="button" type="submit" disabled={creating || !name}>
                  <FlaskConical size={15} /> {creating ? "Creating…" : "Create Campaign"}
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      {loading ? (
        <div className="empty">Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="empty">No campaigns yet. Create one to track parameter sweeps across multiple backends and configurations.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {campaigns.map(c => <CampaignCard key={c.campaign_id} c={c} />)}
        </div>
      )}
    </main>
  );
}
