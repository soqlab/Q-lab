"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createResearcherProfile,
  listResearcherProfiles,
  createJobListing,
  listJobListings,
  getTalentMatches,
  type ResearcherProfile,
  type TalentJobListing,
  type TalentMatch,
} from "@/lib/api";

type MainTab = "Researchers" | "Jobs" | "Post";
const MAIN_TABS: MainTab[] = ["Researchers", "Jobs", "Post"];

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  phd_student: { background: "rgba(12,74,110,0.6)", color: "#7dd3fc" },
  postdoc: { background: "rgba(49,46,129,0.6)", color: "var(--strong)" },
  faculty: { background: "rgba(88,28,135,0.6)", color: "#d8b4fe" },
  industry: { background: "rgba(6,78,59,0.6)", color: "var(--ok)" },
};

const JOB_TYPE_STYLES: Record<string, React.CSSProperties> = {
  full_time: { background: "rgba(6,78,59,0.6)", color: "var(--ok)" },
  part_time: { background: "rgba(120,53,15,0.6)", color: "#fcd34d" },
  internship: { background: "rgba(12,74,110,0.6)", color: "#7dd3fc" },
  contract: { background: "rgba(136,19,55,0.6)", color: "#fca5a5" },
};

const badgeBaseStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  textTransform: "capitalize",
};

const defaultBadgeExtras: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--text)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const filterSelectStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--text)",
};

const filterInputStyle: React.CSSProperties = {
  ...filterSelectStyle,
  width: 208,
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span style={{ ...badgeBaseStyle, ...(ROLE_STYLES[role] ?? defaultBadgeExtras) }}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function JobTypeBadge({ type }: { type: string }) {
  return (
    <span style={{ ...badgeBaseStyle, ...(JOB_TYPE_STYLES[type] ?? defaultBadgeExtras) }}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function SkillChip({ skill }: { skill: string }) {
  return (
    <span style={{
      display: "inline-block",
      background: "var(--line)",
      color: "var(--text)",
      fontSize: 12,
      padding: "2px 8px",
      borderRadius: 999,
    }}>
      {skill}
    </span>
  );
}

function ResearcherCard({
  profile,
  onFindMatches,
  loadingMatches,
  matches,
}: {
  profile: ResearcherProfile;
  onFindMatches: () => void;
  loadingMatches: boolean;
  matches: TalentMatch[] | null;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <RoleBadge role={profile.role} />
        {profile.open_to_opportunities && (
          <span style={{ fontSize: 12, background: "rgba(16,185,129,0.1)", color: "var(--ok)", padding: "2px 8px", borderRadius: 999 }}>
            Open to Opportunities
          </span>
        )}
      </div>
      <h3 style={{ color: "var(--text)", fontWeight: 600, fontSize: 13, margin: 0 }}>{profile.name}</h3>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0, marginBottom: 4 }}>{profile.institution}</p>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        h-index: {profile.h_index} &middot; {profile.publications} publications
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {(profile.expertise ?? []).slice(0, 4).map((e) => (
          <SkillChip key={e} skill={e} />
        ))}
        {(profile.expertise ?? []).length > 4 && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>+{(profile.expertise ?? []).length - 4}</span>
        )}
      </div>
      <button
        onClick={onFindMatches}
        disabled={loadingMatches}
        style={{
          width: "100%",
          fontSize: 12,
          background: "var(--strong)",
          color: "#fff",
          padding: "6px 0",
          borderRadius: 8,
          fontWeight: 500,
          border: "none",
          cursor: loadingMatches ? "not-allowed" : "pointer",
          opacity: loadingMatches ? 0.5 : 1,
        }}
      >
        {loadingMatches ? "Finding Matches…" : "Find Job Matches"}
      </button>
      {matches !== null && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {matches.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>No matches found.</p>
          ) : (
            matches.map((m) => (
              <div key={m.job_id} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 8, padding: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{m.job_id}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--strong)" }}>{(m.match_score * 100).toFixed(0)}%</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(m.matching_skills ?? []).map((s) => (
                    <span key={s} style={{ fontSize: 12, background: "rgba(99,102,241,0.2)", color: "var(--strong)", padding: "2px 6px", borderRadius: 4 }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function JobCard({ job }: { job: TalentJobListing }) {
  const [showContact, setShowContact] = useState(false);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <JobTypeBadge type={job.type} />
        {job.deadline && (
          <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
            Deadline: {new Date(job.deadline).toLocaleDateString()}
          </span>
        )}
      </div>
      <h3 style={{ color: "var(--text)", fontWeight: 600, fontSize: 13, margin: "0 0 2px 0" }}>{job.title}</h3>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 2px 0" }}>{job.institution}</p>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 8px 0" }}>{job.location}</p>
      {job.salary_range && (
        <p style={{ color: "var(--ok)", fontSize: 12, fontWeight: 500, margin: "0 0 8px 0" }}>{job.salary_range}</p>
      )}
      <p style={{
        color: "var(--muted)",
        fontSize: 12,
        marginBottom: 12,
        marginTop: 0,
        WebkitLineClamp: 2,
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>{job.description}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {(job.required_skills ?? []).slice(0, 4).map((s) => (
          <SkillChip key={s} skill={s} />
        ))}
        {(job.required_skills ?? []).length > 4 && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>+{(job.required_skills ?? []).length - 4} more</span>
        )}
      </div>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowContact(!showContact)}
          style={{
            fontSize: 12,
            background: "var(--line)",
            color: "var(--text)",
            padding: "6px 12px",
            borderRadius: 8,
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        {showContact && (
          <div style={{
            position: "absolute",
            bottom: 32,
            left: 0,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--strong)",
            whiteSpace: "nowrap",
            zIndex: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}>
            Contact: {job.contact_email}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TalentPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("Researchers");

  // Researchers state
  const [researchers, setResearchers] = useState<ResearcherProfile[]>([]);
  const [researchersLoading, setResearchersLoading] = useState(false);
  const [researchersError, setResearchersError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("all");
  const [expertiseFilter, setExpertiseFilter] = useState("");
  const [profileMatches, setProfileMatches] = useState<Record<string, TalentMatch[] | null>>({});
  const [loadingMatchId, setLoadingMatchId] = useState<string | null>(null);

  // Jobs state
  const [jobs, setJobs] = useState<TalentJobListing[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("");

  // Post Profile form
  const [ppName, setPpName] = useState("");
  const [ppEmail, setPpEmail] = useState("");
  const [ppInstitution, setPpInstitution] = useState("");
  const [ppRole, setPpRole] = useState("phd_student");
  const [ppExpertise, setPpExpertise] = useState("");
  const [ppPublications, setPpPublications] = useState(0);
  const [ppHIndex, setPpHIndex] = useState(0);
  const [ppOpenTo, setPpOpenTo] = useState(false);
  const [ppBio, setPpBio] = useState("");
  const [ppSubmitting, setPpSubmitting] = useState(false);
  const [ppError, setPpError] = useState<string | null>(null);
  const [ppSuccess, setPpSuccess] = useState(false);

  // Post Job form
  const [pjTitle, setPjTitle] = useState("");
  const [pjInstitution, setPjInstitution] = useState("");
  const [pjLocation, setPjLocation] = useState("");
  const [pjType, setPjType] = useState("full_time");
  const [pjDescription, setPjDescription] = useState("");
  const [pjRequired, setPjRequired] = useState("");
  const [pjPreferred, setPjPreferred] = useState("");
  const [pjSalary, setPjSalary] = useState("");
  const [pjDeadline, setPjDeadline] = useState("");
  const [pjContact, setPjContact] = useState("");
  const [pjSubmitting, setPjSubmitting] = useState(false);
  const [pjError, setPjError] = useState<string | null>(null);
  const [pjSuccess, setPjSuccess] = useState(false);

  const loadResearchers = useCallback(async () => {
    setResearchersLoading(true);
    setResearchersError(null);
    try {
      const params: { role?: string; expertise?: string } = {};
      if (roleFilter !== "all") params.role = roleFilter;
      if (expertiseFilter.trim()) params.expertise = expertiseFilter.trim();
      const data = await listResearcherProfiles(params);
      setResearchers(data);
    } catch {
      setResearchersError("Failed to load researcher profiles.");
    } finally {
      setResearchersLoading(false);
    }
  }, [roleFilter, expertiseFilter]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const params: { type?: string; location?: string } = {};
      if (jobTypeFilter !== "all") params.type = jobTypeFilter;
      if (locationFilter.trim()) params.location = locationFilter.trim();
      const data = await listJobListings(params);
      setJobs(data);
    } catch {
      setJobsError("Failed to load job listings.");
    } finally {
      setJobsLoading(false);
    }
  }, [jobTypeFilter, locationFilter]);

  useEffect(() => {
    if (activeTab === "Researchers") void loadResearchers();
  }, [activeTab, loadResearchers]);

  useEffect(() => {
    if (activeTab === "Jobs") void loadJobs();
  }, [activeTab, loadJobs]);

  async function handleFindMatches(profileId: string) {
    setLoadingMatchId(profileId);
    try {
      const matches = await getTalentMatches(profileId);
      setProfileMatches((prev) => ({ ...prev, [profileId]: matches }));
    } catch {
      setProfileMatches((prev) => ({ ...prev, [profileId]: [] }));
    } finally {
      setLoadingMatchId(null);
    }
  }

  async function handlePostProfile(e: React.FormEvent) {
    e.preventDefault();
    setPpSubmitting(true);
    setPpError(null);
    setPpSuccess(false);
    try {
      await createResearcherProfile({
        name: ppName,
        email: ppEmail,
        institution: ppInstitution,
        role: ppRole,
        expertise: ppExpertise.split(",").map((s) => s.trim()).filter(Boolean),
        publications: ppPublications,
        h_index: ppHIndex,
        open_to_opportunities: ppOpenTo,
        bio: ppBio,
      });
      setPpSuccess(true);
      setPpName(""); setPpEmail(""); setPpInstitution(""); setPpExpertise(""); setPpBio("");
    } catch (err) {
      setPpError(err instanceof Error ? err.message : "Failed to create profile.");
    } finally {
      setPpSubmitting(false);
    }
  }

  async function handlePostJob(e: React.FormEvent) {
    e.preventDefault();
    setPjSubmitting(true);
    setPjError(null);
    setPjSuccess(false);
    try {
      await createJobListing({
        title: pjTitle,
        institution: pjInstitution,
        location: pjLocation,
        type: pjType,
        description: pjDescription,
        required_skills: pjRequired.split(",").map((s) => s.trim()).filter(Boolean),
        preferred_skills: pjPreferred.split(",").map((s) => s.trim()).filter(Boolean),
        salary_range: pjSalary || undefined,
        deadline: pjDeadline || undefined,
        contact_email: pjContact,
      });
      setPjSuccess(true);
      setPjTitle(""); setPjInstitution(""); setPjLocation(""); setPjDescription("");
      setPjRequired(""); setPjPreferred(""); setPjSalary(""); setPjDeadline(""); setPjContact("");
    } catch (err) {
      setPjError(err instanceof Error ? err.message : "Failed to post job.");
    } finally {
      setPjSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", color: "var(--text)", padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>Quantum Talent Board</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>Connect researchers and opportunities in quantum computing.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "var(--surface)", borderRadius: 8, padding: 4, width: "fit-content" }}>
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              background: activeTab === tab ? "var(--strong)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--muted)",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Researchers Tab */}
      {activeTab === "Researchers" && (
        <div>
          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={filterSelectStyle}
            >
              <option value="all">All Roles</option>
              <option value="phd_student">PhD Student</option>
              <option value="postdoc">Postdoc</option>
              <option value="faculty">Faculty</option>
              <option value="industry">Industry</option>
            </select>
            <input
              value={expertiseFilter}
              onChange={(e) => setExpertiseFilter(e.target.value)}
              placeholder="Search expertise…"
              style={filterInputStyle}
            />
            <button
              onClick={loadResearchers}
              style={{
                background: "var(--strong)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
              }}
            >
              Search
            </button>
          </div>
          {researchersError && (
            <div style={{ marginBottom: 16, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
              {researchersError}
            </div>
          )}
          {researchersLoading ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading researchers…</div>
          ) : researchers.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
              No profiles found.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
              {researchers.map((profile) => (
                <ResearcherCard
                  key={profile.profile_id}
                  profile={profile}
                  onFindMatches={() => handleFindMatches(profile.profile_id)}
                  loadingMatches={loadingMatchId === profile.profile_id}
                  matches={profileMatches[profile.profile_id] ?? null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === "Jobs" && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <select
              value={jobTypeFilter}
              onChange={(e) => setJobTypeFilter(e.target.value)}
              style={filterSelectStyle}
            >
              <option value="all">All Types</option>
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="internship">Internship</option>
              <option value="contract">Contract</option>
            </select>
            <input
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="Filter by location…"
              style={filterInputStyle}
            />
            <button
              onClick={loadJobs}
              style={{
                background: "var(--strong)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
              }}
            >
              Search
            </button>
          </div>
          {jobsError && (
            <div style={{ marginBottom: 16, background: "rgba(239,68,68,0.1)", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
              {jobsError}
            </div>
          )}
          {jobsLoading ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading jobs…</div>
          ) : jobs.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "32px 0", textAlign: "center", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--line)" }}>
              No job listings found.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
              {jobs.map((job) => (
                <JobCard key={job.job_id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Post Tab */}
      {activeTab === "Post" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 32 }}>
          {/* Post Profile */}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginTop: 0, marginBottom: 16 }}>Post Your Profile</h2>
            <form onSubmit={handlePostProfile} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Name</label>
                  <input value={ppName} onChange={(e) => setPpName(e.target.value)} placeholder="Alice Smith" style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input type="email" value={ppEmail} onChange={(e) => setPpEmail(e.target.value)} placeholder="alice@university.edu" style={inputStyle} required />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Institution</label>
                  <input value={ppInstitution} onChange={(e) => setPpInstitution(e.target.value)} placeholder="MIT" style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>Role</label>
                  <select value={ppRole} onChange={(e) => setPpRole(e.target.value)} style={inputStyle}>
                    <option value="phd_student">PhD Student</option>
                    <option value="postdoc">Postdoc</option>
                    <option value="faculty">Faculty</option>
                    <option value="industry">Industry</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Expertise (comma-separated)</label>
                <input value={ppExpertise} onChange={(e) => setPpExpertise(e.target.value)} placeholder="VQE, Error Correction, Qiskit" style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Publications</label>
                  <input type="number" min={0} value={ppPublications} onChange={(e) => setPpPublications(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>h-index</label>
                  <input type="number" min={0} value={ppHIndex} onChange={(e) => setPpHIndex(Number(e.target.value))} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Bio</label>
                <textarea value={ppBio} onChange={(e) => setPpBio(e.target.value)} rows={3} placeholder="Research interests and background…" style={{ ...inputStyle, resize: "none" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" id="openTo" checked={ppOpenTo} onChange={(e) => setPpOpenTo(e.target.checked)} style={{ accentColor: "var(--strong)" }} />
                <label htmlFor="openTo" style={{ fontSize: 13, color: "var(--text)" }}>Open to Opportunities</label>
              </div>
              {ppError && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{ppError}</p>}
              {ppSuccess && <p style={{ color: "var(--ok)", fontSize: 13, margin: 0 }}>Profile posted successfully!</p>}
              <button
                type="submit"
                disabled={ppSubmitting}
                style={{
                  width: "100%",
                  background: "var(--strong)",
                  color: "#fff",
                  fontWeight: 500,
                  padding: "8px 0",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "none",
                  cursor: ppSubmitting ? "not-allowed" : "pointer",
                  opacity: ppSubmitting ? 0.5 : 1,
                }}
              >
                {ppSubmitting ? "Posting…" : "Post Profile"}
              </button>
            </form>
          </div>

          {/* Post Job */}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginTop: 0, marginBottom: 16 }}>Post a Job Listing</h2>
            <form onSubmit={handlePostJob} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Job Title</label>
                  <input value={pjTitle} onChange={(e) => setPjTitle(e.target.value)} placeholder="Quantum Research Engineer" style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>Institution</label>
                  <input value={pjInstitution} onChange={(e) => setPjInstitution(e.target.value)} placeholder="IBM Research" style={inputStyle} required />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Location</label>
                  <input value={pjLocation} onChange={(e) => setPjLocation(e.target.value)} placeholder="New York, NY" style={inputStyle} required />
                </div>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={pjType} onChange={(e) => setPjType(e.target.value)} style={inputStyle}>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="internship">Internship</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={pjDescription} onChange={(e) => setPjDescription(e.target.value)} rows={3} placeholder="Role responsibilities and requirements…" style={{ ...inputStyle, resize: "none" }} required />
              </div>
              <div>
                <label style={labelStyle}>Required Skills (comma-separated)</label>
                <input value={pjRequired} onChange={(e) => setPjRequired(e.target.value)} placeholder="Qiskit, Python, Linear Algebra" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Preferred Skills (comma-separated)</label>
                <input value={pjPreferred} onChange={(e) => setPjPreferred(e.target.value)} placeholder="Cirq, Quantum Error Correction" style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Salary Range</label>
                  <input value={pjSalary} onChange={(e) => setPjSalary(e.target.value)} placeholder="$120k – $160k" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Deadline</label>
                  <input type="date" value={pjDeadline} onChange={(e) => setPjDeadline(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Contact Email</label>
                <input type="email" value={pjContact} onChange={(e) => setPjContact(e.target.value)} placeholder="careers@ibm.com" style={inputStyle} required />
              </div>
              {pjError && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{pjError}</p>}
              {pjSuccess && <p style={{ color: "var(--ok)", fontSize: 13, margin: 0 }}>Job listing posted successfully!</p>}
              <button
                type="submit"
                disabled={pjSubmitting}
                style={{
                  width: "100%",
                  background: "var(--strong)",
                  color: "#fff",
                  fontWeight: 500,
                  padding: "8px 0",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "none",
                  cursor: pjSubmitting ? "not-allowed" : "pointer",
                  opacity: pjSubmitting ? 0.5 : 1,
                }}
              >
                {pjSubmitting ? "Posting…" : "Post Job Listing"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
