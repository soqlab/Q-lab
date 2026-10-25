"use client";

import { use, useEffect, useState } from "react";
import { ExternalLink, MapPin, BookOpen, Globe, Award } from "lucide-react";
import GithubIcon from "../../../components/GithubIcon";

const API_PREFIX = "/qlab-api";

function apiUrl(path: string) {
  return `${API_PREFIX}${path}`;
}

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
  google_scholar_url?: string;
  github_username?: string;
  website_url?: string;
  location?: string;
  public_profile: boolean;
  show_run_count: boolean;
  show_health_scores: boolean;
  show_recent_circuits: boolean;
  total_runs?: number;
  public_runs?: number;
  avg_health_score?: number;
  top_backends?: string[];
  top_algorithms?: string[];
  recent_circuits?: string[];
  algorithm_distribution?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

interface PublicRun {
  run_id: string;
  circuit_name?: string;
  backend?: string;
  health_score?: number;
  created_at?: string;
  share_token?: string;
}

function Avatar({ name, size = 64 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const colors = [
    "#1d6f8f", "#2d7f5f", "#7f3f8f", "#8f5f1f", "#1f4f8f",
    "#8f1f3f", "#3f6f1f", "#1f6f6f", "#6f1f1f", "#3f3f8f",
  ];
  const bg = colors[hash % colors.length];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
        letterSpacing: "-1px",
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
        background: color + "22",
        color,
        border: `1px solid ${color}55`,
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {score.toFixed(1)}
    </span>
  );
}

function InterestChip({ label }: { label: string }) {
  const hash = label.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palettes = [
    { bg: "#1d6f8f22", border: "#1d6f8f55", text: "#7dd3f5" },
    { bg: "#2d7f5f22", border: "#2d7f5f55", text: "#6ee7b7" },
    { bg: "#7f3f8f22", border: "#7f3f8f55", text: "#d8b4fe" },
    { bg: "#8f5f1f22", border: "#8f5f1f55", text: "#fcd34d" },
    { bg: "#8f1f3f22", border: "#8f1f3f55", text: "#fca5a5" },
  ];
  const p = palettes[hash % palettes.length];
  return (
    <span
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.text,
        borderRadius: 20,
        padding: "4px 12px",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

export default function PublicProfilePage({ params: paramsPromise }: { params: Promise<{ username: string }> }) {
  const params = use(paramsPromise);
  const { username } = params;
  const [profile, setProfile] = useState<ResearcherProfile | null>(null);
  const [runs, setRuns] = useState<PublicRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl(`/api/v1/profiles/${username}`), { cache: "no-store" }),
      fetch(apiUrl(`/api/v1/profiles/${username}/runs`), { cache: "no-store" }),
    ])
      .then(async ([profRes, runsRes]) => {
        if (!profRes.ok) throw new Error("Profile not found");
        const profData = await profRes.json() as ResearcherProfile;
        setProfile(profData);
        if (runsRes.ok) {
          const runsData = await runsRes.json() as { runs: PublicRun[] };
          setRuns(runsData.runs ?? []);
        }
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [username]);

  if (loading) {
    return (
      <div style={styles.shell}>
        <TopBar />
        <div style={{ textAlign: "center", padding: "120px 0", color: "#64748b", fontSize: 16 }}>
          Loading profile…
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={styles.shell}>
        <TopBar />
        <div style={{ textAlign: "center", padding: "120px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>404</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Profile not found</div>
          <div style={{ color: "#64748b" }}>This researcher hasn&apos;t created a public profile yet.</div>
          <a href="/" style={{ display: "inline-block", marginTop: 20, color: "#38bdf8" }}>
            Go to Q-Lab →
          </a>
        </div>
      </div>
    );
  }

  const algDist = profile.algorithm_distribution ?? {};
  const algEntries = Object.entries(algDist).sort((a, b) => b[1] - a[1]);

  return (
    <div style={styles.shell}>
      <TopBar />

      <main style={styles.main}>
        {/* ---- HERO ---- */}
        <div style={styles.hero}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Avatar name={profile.display_name} size={80} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#f1f5f9" }}>
                {profile.display_name}
              </h1>
              <div style={{ color: "#94a3b8", fontSize: 14, marginTop: 4 }}>@{profile.username}</div>
              {profile.title && (
                <div style={{ color: "#cbd5e1", fontSize: 15, marginTop: 6, fontWeight: 500 }}>
                  {profile.title}
                  {profile.institution && (
                    <> · <span style={{ color: "#38bdf8" }}>{profile.institution}</span></>
                  )}
                  {profile.department && <> / {profile.department}</>}
                </div>
              )}
              {profile.location && (
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <MapPin size={13} /> {profile.location}
                </div>
              )}
            </div>
          </div>

          {/* Bio */}
          {profile.bio && (
            <p style={{ marginTop: 18, color: "#cbd5e1", fontSize: 14, lineHeight: 1.6, maxWidth: 680 }}>
              {profile.bio}
            </p>
          )}

          {/* Links bar */}
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            {profile.orcid_id && (
              <a
                href={`https://orcid.org/${profile.orcid_id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                <Award size={14} /> ORCID {profile.orcid_id}
              </a>
            )}
            {profile.github_username && (
              <a
                href={`https://github.com/${profile.github_username}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                <GithubIcon size={14} /> {profile.github_username}
              </a>
            )}
            {profile.google_scholar_url && (
              <a
                href={profile.google_scholar_url}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                <BookOpen size={14} /> Google Scholar
              </a>
            )}
            {profile.website_url && (
              <a
                href={profile.website_url}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                <Globe size={14} /> Website
              </a>
            )}
          </div>

          {/* Research interests */}
          {profile.research_interests.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {profile.research_interests.map((ri) => (
                <InterestChip key={ri} label={ri} />
              ))}
            </div>
          )}
        </div>

        {/* ---- STATS STRIP ---- */}
        <div style={styles.statsStrip}>
          {[
            ["Total Runs", profile.total_runs != null ? profile.total_runs : "—"],
            ["Public Runs", profile.public_runs != null ? profile.public_runs : "—"],
            ["Avg Health", profile.avg_health_score != null ? profile.avg_health_score.toFixed(1) : "—"],
            ["Top Backend", (profile.top_backends?.[0]) ?? "—"],
          ].map(([label, value]) => (
            <div key={String(label)} style={styles.statItem}>
              <div style={styles.statValue}>{String(value)}</div>
              <div style={styles.statLabel}>{String(label)}</div>
            </div>
          ))}
        </div>

        <div style={styles.twoCol}>
          {/* ---- LEFT: ACTIVITY BADGE + RECENT RUNS ---- */}
          <div style={{ flex: 2, minWidth: 0 }}>
            {/* Activity heatmap */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Run Activity</div>
              <div style={{ overflowX: "auto" }}>
                <img
                  src={apiUrl(`/api/v1/profiles/${username}/badge`)}
                  alt="Run activity heatmap"
                  style={{ display: "block", borderRadius: 6 }}
                />
              </div>
            </div>

            {/* Recent public experiments */}
            {profile.show_recent_circuits && runs.length > 0 && (
              <div style={{ ...styles.card, marginTop: 16 }}>
                <div style={styles.cardTitle}>Recent Public Experiments</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {["Circuit", "Backend", "Health", "Date", ""].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "8px 10px",
                              color: "#64748b",
                              fontWeight: 600,
                              borderBottom: "1px solid #1e293b",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {runs.slice(0, 5).map((r) => (
                        <tr key={r.run_id} style={{ borderBottom: "1px solid #0f172a" }}>
                          <td style={{ padding: "9px 10px", color: "#e2e8f0", fontWeight: 500 }}>
                            {r.circuit_name ?? r.run_id.slice(0, 10)}
                          </td>
                          <td style={{ padding: "9px 10px", color: "#94a3b8" }}>
                            {r.backend ?? "—"}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            {r.health_score != null ? <HealthBadge score={r.health_score} /> : "—"}
                          </td>
                          <td style={{ padding: "9px 10px", color: "#64748b", fontSize: 12 }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td style={{ padding: "9px 10px" }}>
                            {r.share_token && (
                              <a
                                href={`/share/${r.share_token}`}
                                style={{ color: "#38bdf8", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                              >
                                View <ExternalLink size={11} />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ---- RIGHT: ALGORITHM DISTRIBUTION ---- */}
          <div style={{ flex: 1, minWidth: 200 }}>
            {algEntries.length > 0 && (
              <div style={styles.card}>
                <div style={styles.cardTitle}>Algorithm Distribution</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {algEntries.map(([algo, pct]) => (
                    <div key={algo}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                        <span style={{ color: "#cbd5e1", fontWeight: 500 }}>{algo}</span>
                        <span style={{ color: "#94a3b8" }}>{pct}%</span>
                      </div>
                      <div style={{ background: "#1e293b", borderRadius: 4, height: 6 }}>
                        <div
                          style={{
                            background: "#38bdf8",
                            borderRadius: 4,
                            height: "100%",
                            width: `${Math.min(pct, 100)}%`,
                            transition: "width 0.6s ease",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top backends */}
            {(profile.top_backends ?? []).length > 0 && (
              <div style={{ ...styles.card, marginTop: 16 }}>
                <div style={styles.cardTitle}>Top Backends</div>
                {(profile.top_backends ?? []).map((b, i) => (
                  <div
                    key={b}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "7px 0",
                      borderBottom: i < (profile.top_backends ?? []).length - 1 ? "1px solid #1e293b" : "none",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "#cbd5e1" }}>{b}</span>
                    <span style={{ color: "#64748b", fontSize: 11 }}>#{i + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer style={{ textAlign: "center", padding: "32px 0 16px", color: "#334155", fontSize: 12 }}>
          Profile on{" "}
          <a href="/" style={{ color: "#38bdf8", textDecoration: "none" }}>
            Q-Lab
          </a>{" "}
          · Last updated {new Date(profile.updated_at).toLocaleDateString()}
        </footer>
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header
      style={{
        background: "#0a0f1a",
        borderBottom: "1px solid #1e293b",
        padding: "14px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <a
          href="/"
          style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", textDecoration: "none", letterSpacing: "-0.5px" }}
        >
          Q-Lab
        </a>
        <span
          style={{
            background: "#1d6f8f33",
            color: "#38bdf8",
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 12,
            border: "1px solid #1d6f8f55",
          }}
        >
          Researcher
        </span>
      </div>
      <a
        href="/researchers"
        style={{ color: "#64748b", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}
      >
        Browse Researchers →
      </a>
    </header>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#0d1b2a",
    fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
    color: "#e2e8f0",
  } as React.CSSProperties,
  main: {
    maxWidth: 1000,
    margin: "0 auto",
    padding: "28px 20px 48px",
  } as React.CSSProperties,
  hero: {
    background: "#0f1e30",
    border: "1px solid #1e293b",
    borderRadius: 14,
    padding: "28px 32px",
    marginBottom: 20,
  } as React.CSSProperties,
  statsStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  statItem: {
    background: "#0f1e30",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: "16px 20px",
    textAlign: "center" as const,
  } as React.CSSProperties,
  statValue: {
    fontSize: 24,
    fontWeight: 800,
    color: "#38bdf8",
  } as React.CSSProperties,
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
    fontWeight: 500,
  } as React.CSSProperties,
  twoCol: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap" as const,
    alignItems: "flex-start",
  } as React.CSSProperties,
  card: {
    background: "#0f1e30",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: "18px 20px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: 14,
  } as React.CSSProperties,
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "#94a3b8",
    textDecoration: "none",
    fontSize: 13,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "4px 10px",
    transition: "color 0.15s",
  } as React.CSSProperties,
};
