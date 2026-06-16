"use client";

import { useEffect, useState } from "react";
import {
  createSocialProfile,
  followResearcher,
  discoverResearchers,
  getSocialFeed,
  type QuantumProfile,
} from "@/lib/api";

type FeedItem = {
  type: string;
  actor: string;
  description: string;
  date: string;
  link?: string;
};

function typeBadge(type: string) {
  const cfg: Record<string, { bg: string; color: string }> = {
    experiment: { bg: "rgba(99,102,241,0.15)", color: "#818cf8" },
    replication: { bg: "rgba(34,211,238,0.12)", color: "#22d3ee" },
    paper: { bg: "rgba(250,204,21,0.12)", color: "#facc15" },
  };
  const s = cfg[type] ?? { bg: "rgba(161,161,170,0.15)", color: "#a1a1aa" };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {type}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export default function SocialPage() {
  const [profile, setProfile] = useState<QuantumProfile | null>(null);
  const [myUsername, setMyUsername] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [suggestions, setSuggestions] = useState<QuantumProfile[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());

  // Profile form
  const [formUsername, setFormUsername] = useState("");
  const [formInstitution, setFormInstitution] = useState("");
  const [formAreas, setFormAreas] = useState("");
  const [formBio, setFormBio] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Discover loading
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(false);

  useEffect(() => {
    void discoverResearchers()
      .then((r) => setSuggestions(r.suggestions))
      .catch(() => {})
      .finally(() => setDiscoverLoading(false));
  }, []);

  async function handleCreateProfile(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const p = await createSocialProfile({
        username: formUsername,
        institution: formInstitution,
        research_areas: formAreas.split(",").map((s) => s.trim()).filter(Boolean),
        bio: formBio || undefined,
      });
      setProfile(p);
      setMyUsername(formUsername);
      // Load feed after profile creation
      setFeedLoading(true);
      try {
        const feedData = await getSocialFeed(formUsername);
        setFeed(feedData.feed);
      } catch {
        // Feed may be empty
      } finally {
        setFeedLoading(false);
      }
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setCreating(false);
    }
  }

  async function handleFollow(suggestion: QuantumProfile) {
    if (!myUsername) return;
    try {
      await followResearcher({ follower: myUsername, following: suggestion.username });
      setFollowing((prev) => new Set([...prev, suggestion.username]));
    } catch {
      // ignore
    }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Quantum Social Graph</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          Follow researchers, share experiments, and stay on top of the quantum community.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr 260px",
          gap: 14,
          alignItems: "start",
        }}
      >
        {/* Left Sidebar — My Profile */}
        <aside>
          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600, fontSize: 14 }}>My Profile</h3>
            </div>

            {!profile ? (
              <form
                onSubmit={(e) => { void handleCreateProfile(e); }}
                style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    Username
                  </label>
                  <input
                    className="input"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="quantum_alice"
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    Institution
                  </label>
                  <input
                    className="input"
                    value={formInstitution}
                    onChange={(e) => setFormInstitution(e.target.value)}
                    placeholder="MIT"
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    Research Areas (comma-separated)
                  </label>
                  <input
                    className="input"
                    value={formAreas}
                    onChange={(e) => setFormAreas(e.target.value)}
                    placeholder="VQE, QAOA, error correction"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                    Bio
                  </label>
                  <textarea
                    className="input"
                    value={formBio}
                    onChange={(e) => setFormBio(e.target.value)}
                    placeholder="Short bio..."
                    rows={2}
                    style={{ resize: "vertical" }}
                  />
                </div>
                {createError && (
                  <div style={{ fontSize: 12, color: "#f87171" }}>{createError}</div>
                )}
                <button className="button" type="submit" disabled={creating} style={{ width: "100%" }}>
                  {creating ? "Creating…" : "Create Profile"}
                </button>
              </form>
            ) : (
              <div style={{ padding: "14px 16px" }}>
                {/* Avatar */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: "rgba(99,102,241,0.2)",
                      border: "2px solid rgba(99,102,241,0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#818cf8",
                      flexShrink: 0,
                    }}
                  >
                    {initials(profile.username)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>@{profile.username}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{profile.institution}</div>
                  </div>
                </div>
                {profile.bio && (
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{profile.bio}</p>
                )}
                <div style={{ display: "flex", gap: 16, fontSize: 12, marginBottom: 12 }}>
                  <div>
                    <span style={{ fontWeight: 700, color: "var(--strong)" }}>{profile.followers}</span>{" "}
                    <span style={{ color: "var(--muted)" }}>followers</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 700, color: "var(--strong)" }}>{profile.following}</span>{" "}
                    <span style={{ color: "var(--muted)" }}>following</span>
                  </div>
                </div>
                {profile.research_areas.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {profile.research_areas.map((area) => (
                      <span
                        key={area}
                        style={{
                          background: "rgba(99,102,241,0.12)",
                          color: "#818cf8",
                          fontSize: 10,
                          padding: "2px 7px",
                          borderRadius: 999,
                          fontWeight: 600,
                        }}
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                )}
                {profile.recent_activity.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>
                      RECENT ACTIVITY
                    </div>
                    {profile.recent_activity.slice(0, 3).map((act, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          paddingBottom: 6,
                          borderBottom: i < 2 ? "1px solid var(--line)" : undefined,
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ color: "var(--strong)" }}>{act.description}</span>
                        <div style={{ marginTop: 2 }}>
                          {typeBadge(act.type)} &nbsp;{new Date(act.date).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>

        {/* Center — Activity Feed */}
        <div>
          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600, fontSize: 14 }}>Activity Feed</h3>
            </div>
            {!profile && (
              <div className="empty" style={{ fontSize: 13 }}>
                Create your profile to see your personalized feed.
              </div>
            )}
            {profile && feedLoading && (
              <div className="empty">Loading feed…</div>
            )}
            {profile && !feedLoading && feed.length === 0 && (
              <div className="empty">No activity yet. Follow some researchers!</div>
            )}
            {feed.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "14px 16px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "rgba(34,211,238,0.12)",
                    border: "1px solid rgba(34,211,238,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#22d3ee",
                    flexShrink: 0,
                  }}
                >
                  {initials(item.actor)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>@{item.actor}</span>
                    {typeBadge(item.type)}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{item.description}</p>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#818cf8", marginTop: 4, display: "inline-block" }}
                    >
                      View →
                    </a>
                  )}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                    {new Date(item.date).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </section>
        </div>

        {/* Right — Discover */}
        <aside>
          <section className="panel">
            <div className="panel-header">
              <h3 style={{ fontWeight: 600, fontSize: 14 }}>Discover Researchers</h3>
            </div>
            {discoverLoading && (
              <div className="empty" style={{ fontSize: 12 }}>Loading…</div>
            )}
            {!discoverLoading && suggestions.length === 0 && (
              <div className="empty" style={{ fontSize: 12 }}>No suggestions available.</div>
            )}
            {suggestions.map((s) => (
              <div
                key={s.username}
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "rgba(250,204,21,0.12)",
                      border: "1px solid rgba(250,204,21,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 12,
                      color: "#facc15",
                      flexShrink: 0,
                    }}
                  >
                    {initials(s.username)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>@{s.username}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.institution}
                    </div>
                  </div>
                </div>
                {s.research_areas.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {s.research_areas.slice(0, 3).map((area) => (
                      <span
                        key={area}
                        style={{
                          background: "rgba(74,222,128,0.1)",
                          color: "#4ade80",
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: 999,
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {area}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  className="button secondary"
                  style={{ width: "100%", height: 28, fontSize: 11 }}
                  disabled={following.has(s.username) || !profile}
                  onClick={() => { void handleFollow(s); }}
                >
                  {following.has(s.username) ? "Following!" : "Follow"}
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
