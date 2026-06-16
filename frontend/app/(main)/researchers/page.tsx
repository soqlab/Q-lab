"use client";

import { useEffect, useState } from "react";
import { Search, Users, MapPin, ExternalLink, Activity, Award } from "lucide-react";

const API_PREFIX = "/qlab-api";
function apiUrl(path: string) { return `${API_PREFIX}${path}`; }

interface ResearcherProfile {
  profile_id: string;
  username: string;
  display_name: string;
  title?: string;
  institution?: string;
  department?: string;
  bio?: string;
  research_interests: string[];
  orcid_id?: string;
  github_username?: string;
  location?: string;
  public_profile: boolean;
  total_runs?: number;
  public_runs?: number;
  avg_health_score?: number;
  top_backends?: string[];
  top_algorithms?: string[];
  created_at: string;
  updated_at: string;
}

const INTEREST_FILTERS = [
  "VQE", "QAOA", "Grover", "Error Correction", "Tomography",
  "Benchmarking", "Noise Adaptation", "Quantum Chemistry", "Entanglement",
];

function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    "#1d6f8f", "#2d7f5f", "#7f3f8f", "#8f5f1f", "#1f4f8f",
    "#8f1f3f", "#3f6f1f", "#1f6f6f", "#6f1f1f", "#3f3f8f",
  ];
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: colors[hash % colors.length],
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: "#fff", flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <span
      style={{
        background: color + "22", color, border: `1px solid ${color}55`,
        borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700,
      }}
    >
      {score.toFixed(1)}
    </span>
  );
}

function ProfileCard({ profile }: { profile: ResearcherProfile }) {
  return (
    <div
      style={{
        background: "var(--card, #0f1e30)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#38bdf855"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--line)"; }}
    >
      {/* Header */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Avatar name={profile.display_name} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--strong, #e2e8f0)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {profile.display_name}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>@{profile.username}</div>
          {profile.title && (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>
              {profile.title}
              {profile.institution && <> · <span style={{ color: "#38bdf8" }}>{profile.institution}</span></>}
            </div>
          )}
          {profile.location && (
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
              <MapPin size={10} /> {profile.location}
            </div>
          )}
        </div>
      </div>

      {/* Research interests (top 2) */}
      {profile.research_interests.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {profile.research_interests.slice(0, 2).map((ri) => {
            const hash = ri.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
            const hues = ["#1d6f8f", "#2d7f5f", "#7f3f8f", "#8f5f1f", "#8f1f3f"];
            const col = hues[hash % hues.length];
            return (
              <span
                key={ri}
                style={{
                  background: col + "22", border: `1px solid ${col}55`,
                  color: "#cbd5e1", borderRadius: 20, padding: "3px 9px", fontSize: 11, fontWeight: 600,
                }}
              >
                {ri}
              </span>
            );
          })}
          {profile.research_interests.length > 2 && (
            <span style={{ fontSize: 11, color: "#64748b", padding: "3px 0" }}>
              +{profile.research_interests.length - 2} more
            </span>
          )}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          paddingTop: 10,
          borderTop: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <Activity size={13} style={{ color: "#64748b" }} />
          <span style={{ color: "#94a3b8" }}>
            {profile.total_runs != null ? (
              <><strong style={{ color: "var(--strong, #e2e8f0)" }}>{profile.total_runs}</strong> runs</>
            ) : "—"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <Award size={13} style={{ color: "#64748b" }} />
          {profile.avg_health_score != null ? (
            <HealthBadge score={profile.avg_health_score} />
          ) : (
            <span style={{ color: "#64748b" }}>—</span>
          )}
        </div>
      </div>

      {/* View Profile link */}
      <a
        href={`/profile/${profile.username}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          justifyContent: "center",
          color: "#38bdf8",
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 600,
          background: "#1d6f8f22",
          border: "1px solid #1d6f8f55",
          borderRadius: 8,
          padding: "8px 0",
        }}
      >
        View Profile <ExternalLink size={12} />
      </a>
    </div>
  );
}

export default function ResearchersPage() {
  const [profiles, setProfiles] = useState<ResearcherProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeInterest, setActiveInterest] = useState<string | null>(null);
  const [sort, setSort] = useState<"most_runs" | "best_health" | "newest">("newest");

  useEffect(() => {
    void load();
  }, [activeInterest, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort });
      if (activeInterest) params.set("research_interest", activeInterest);
      const res = await fetch(apiUrl(`/api/v1/profiles/?${params}`), { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load researchers");
      const data = await res.json() as { profiles: ResearcherProfile[]; total: number };
      setProfiles(data.profiles ?? []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const filtered = profiles.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.display_name.toLowerCase().includes(q) ||
      (p.institution ?? "").toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q) ||
      p.research_interests.some((ri) => ri.toLowerCase().includes(q))
    );
  });

  return (
    <main className="page">
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={20} style={{ color: "#38bdf8" }} />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Researcher Directory</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {total} public researcher{total !== 1 ? "s" : ""} on Q-Lab
          </p>
        </div>
        <a
          href="/profile/edit"
          style={{
            background: "#1d6f8f",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 8,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Edit My Profile
        </a>
      </div>

      {/* Search + Sort controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, institution, or interest…"
            style={{
              width: "100%",
              background: "var(--input-bg, #0d1b2a)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "9px 12px 9px 32px",
              color: "var(--text)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          style={{
            background: "var(--input-bg, #0d1b2a)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "9px 14px",
            color: "var(--text)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <option value="newest">Newest</option>
          <option value="most_runs">Most Runs</option>
          <option value="best_health">Best Health</option>
        </select>
      </div>

      {/* Interest filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          onClick={() => setActiveInterest(null)}
          style={{
            background: activeInterest === null ? "#1d6f8f" : "transparent",
            border: "1px solid " + (activeInterest === null ? "#1d6f8f" : "var(--line)"),
            color: activeInterest === null ? "#fff" : "var(--muted)",
            borderRadius: 20,
            padding: "4px 12px",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: activeInterest === null ? 700 : 400,
          }}
        >
          All
        </button>
        {INTEREST_FILTERS.map((ri) => (
          <button
            key={ri}
            onClick={() => setActiveInterest(activeInterest === ri ? null : ri)}
            style={{
              background: activeInterest === ri ? "#1d6f8f22" : "transparent",
              border: "1px solid " + (activeInterest === ri ? "#1d6f8f" : "var(--line)"),
              color: activeInterest === ri ? "#38bdf8" : "var(--muted)",
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: activeInterest === ri ? 700 : 400,
            }}
          >
            {ri}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#ef444422", border: "1px solid #ef444455", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading researchers…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {search || activeInterest ? "No researchers match your filters." : "No public profiles yet."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((p) => (
            <ProfileCard key={p.profile_id} profile={p} />
          ))}
        </div>
      )}
    </main>
  );
}
