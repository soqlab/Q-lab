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

const ROLE_COLORS: Record<string, string> = {
  phd_student: "bg-sky-900/60 text-sky-300",
  postdoc: "bg-indigo-900/60 text-indigo-300",
  faculty: "bg-purple-900/60 text-purple-300",
  industry: "bg-emerald-900/60 text-emerald-300",
};

const JOB_TYPE_COLORS: Record<string, string> = {
  full_time: "bg-emerald-900/60 text-emerald-300",
  part_time: "bg-amber-900/60 text-amber-300",
  internship: "bg-sky-900/60 text-sky-300",
  contract: "bg-rose-900/60 text-rose-300",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${ROLE_COLORS[role] ?? "bg-gray-800 text-gray-400"}`}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function JobTypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${JOB_TYPE_COLORS[type] ?? "bg-gray-800 text-gray-400"}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

function SkillChip({ skill }: { skill: string }) {
  return (
    <span className="inline-block bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full">
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <RoleBadge role={profile.role} />
        {profile.open_to_opportunities && (
          <span className="text-xs bg-emerald-900/40 text-emerald-400 px-2 py-0.5 rounded-full">
            Open to Opportunities
          </span>
        )}
      </div>
      <h3 className="text-gray-100 font-semibold text-sm">{profile.name}</h3>
      <p className="text-gray-500 text-xs mb-1">{profile.institution}</p>
      <p className="text-gray-500 text-xs mb-3">
        h-index: {profile.h_index} &middot; {profile.publications} publications
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {profile.expertise.slice(0, 4).map((e) => (
          <SkillChip key={e} skill={e} />
        ))}
        {profile.expertise.length > 4 && (
          <span className="text-xs text-gray-600">+{profile.expertise.length - 4}</span>
        )}
      </div>
      <button
        onClick={onFindMatches}
        disabled={loadingMatches}
        className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-1.5 rounded-lg transition-colors font-medium"
      >
        {loadingMatches ? "Finding Matches…" : "Find Job Matches"}
      </button>
      {matches !== null && (
        <div className="mt-3 space-y-2">
          {matches.length === 0 ? (
            <p className="text-xs text-gray-600">No matches found.</p>
          ) : (
            matches.map((m) => (
              <div key={m.job_id} className="bg-gray-800 rounded-lg p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 font-mono">{m.job_id}</span>
                  <span className="text-xs font-bold text-indigo-400">{(m.match_score * 100).toFixed(0)}%</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.matching_skills.map((s) => (
                    <span key={s} className="text-xs bg-indigo-900/40 text-indigo-300 px-1.5 py-0.5 rounded">
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <JobTypeBadge type={job.type} />
        {job.deadline && (
          <span className="text-xs text-gray-500 flex-shrink-0">
            Deadline: {new Date(job.deadline).toLocaleDateString()}
          </span>
        )}
      </div>
      <h3 className="text-gray-100 font-semibold text-sm mb-0.5">{job.title}</h3>
      <p className="text-gray-400 text-xs mb-0.5">{job.institution}</p>
      <p className="text-gray-500 text-xs mb-2">{job.location}</p>
      {job.salary_range && (
        <p className="text-emerald-400 text-xs font-medium mb-2">{job.salary_range}</p>
      )}
      <p className="text-gray-500 text-xs mb-3 line-clamp-2">{job.description}</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {job.required_skills.slice(0, 4).map((s) => (
          <SkillChip key={s} skill={s} />
        ))}
        {job.required_skills.length > 4 && (
          <span className="text-xs text-gray-600">+{job.required_skills.length - 4} more</span>
        )}
      </div>
      <div className="relative">
        <button
          onClick={() => setShowContact(!showContact)}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          Apply
        </button>
        {showContact && (
          <div className="absolute bottom-8 left-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-indigo-300 whitespace-nowrap z-10 shadow-lg">
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

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500";

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Quantum Talent Board</h1>
        <p className="text-gray-500 text-sm mt-1">Connect researchers and opportunities in quantum computing.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Researchers Tab */}
      {activeTab === "Researchers" && (
        <div>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
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
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-52"
            />
            <button
              onClick={loadResearchers}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Search
            </button>
          </div>
          {researchersError && (
            <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
              {researchersError}
            </div>
          )}
          {researchersLoading ? (
            <div className="text-gray-500 text-sm py-8 text-center">Loading researchers…</div>
          ) : researchers.length === 0 ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              No profiles found.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={jobTypeFilter}
              onChange={(e) => setJobTypeFilter(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
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
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-52"
            />
            <button
              onClick={loadJobs}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Search
            </button>
          </div>
          {jobsError && (
            <div className="mb-4 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
              {jobsError}
            </div>
          )}
          {jobsLoading ? (
            <div className="text-gray-500 text-sm py-8 text-center">Loading jobs…</div>
          ) : jobs.length === 0 ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              No job listings found.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobs.map((job) => (
                <JobCard key={job.job_id} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Post Tab */}
      {activeTab === "Post" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Post Profile */}
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Post Your Profile</h2>
            <form onSubmit={handlePostProfile} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Name</label>
                  <input value={ppName} onChange={(e) => setPpName(e.target.value)} placeholder="Alice Smith" className={inputCls} required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Email</label>
                  <input type="email" value={ppEmail} onChange={(e) => setPpEmail(e.target.value)} placeholder="alice@university.edu" className={inputCls} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Institution</label>
                  <input value={ppInstitution} onChange={(e) => setPpInstitution(e.target.value)} placeholder="MIT" className={inputCls} required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Role</label>
                  <select value={ppRole} onChange={(e) => setPpRole(e.target.value)} className={inputCls}>
                    <option value="phd_student">PhD Student</option>
                    <option value="postdoc">Postdoc</option>
                    <option value="faculty">Faculty</option>
                    <option value="industry">Industry</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Expertise (comma-separated)</label>
                <input value={ppExpertise} onChange={(e) => setPpExpertise(e.target.value)} placeholder="VQE, Error Correction, Qiskit" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Publications</label>
                  <input type="number" min={0} value={ppPublications} onChange={(e) => setPpPublications(Number(e.target.value))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">h-index</label>
                  <input type="number" min={0} value={ppHIndex} onChange={(e) => setPpHIndex(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Bio</label>
                <textarea value={ppBio} onChange={(e) => setPpBio(e.target.value)} rows={3} placeholder="Research interests and background…" className={`${inputCls} resize-none`} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="openTo" checked={ppOpenTo} onChange={(e) => setPpOpenTo(e.target.checked)} className="accent-indigo-500" />
                <label htmlFor="openTo" className="text-sm text-gray-300">Open to Opportunities</label>
              </div>
              {ppError && <p className="text-red-400 text-sm">{ppError}</p>}
              {ppSuccess && <p className="text-emerald-400 text-sm">Profile posted successfully!</p>}
              <button type="submit" disabled={ppSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors text-sm">
                {ppSubmitting ? "Posting…" : "Post Profile"}
              </button>
            </form>
          </div>

          {/* Post Job */}
          <div>
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Post a Job Listing</h2>
            <form onSubmit={handlePostJob} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Job Title</label>
                  <input value={pjTitle} onChange={(e) => setPjTitle(e.target.value)} placeholder="Quantum Research Engineer" className={inputCls} required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Institution</label>
                  <input value={pjInstitution} onChange={(e) => setPjInstitution(e.target.value)} placeholder="IBM Research" className={inputCls} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Location</label>
                  <input value={pjLocation} onChange={(e) => setPjLocation(e.target.value)} placeholder="New York, NY" className={inputCls} required />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Type</label>
                  <select value={pjType} onChange={(e) => setPjType(e.target.value)} className={inputCls}>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="internship">Internship</option>
                    <option value="contract">Contract</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Description</label>
                <textarea value={pjDescription} onChange={(e) => setPjDescription(e.target.value)} rows={3} placeholder="Role responsibilities and requirements…" className={`${inputCls} resize-none`} required />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Required Skills (comma-separated)</label>
                <input value={pjRequired} onChange={(e) => setPjRequired(e.target.value)} placeholder="Qiskit, Python, Linear Algebra" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Preferred Skills (comma-separated)</label>
                <input value={pjPreferred} onChange={(e) => setPjPreferred(e.target.value)} placeholder="Cirq, Quantum Error Correction" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Salary Range</label>
                  <input value={pjSalary} onChange={(e) => setPjSalary(e.target.value)} placeholder="$120k – $160k" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Deadline</label>
                  <input type="date" value={pjDeadline} onChange={(e) => setPjDeadline(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wide">Contact Email</label>
                <input type="email" value={pjContact} onChange={(e) => setPjContact(e.target.value)} placeholder="careers@ibm.com" className={inputCls} required />
              </div>
              {pjError && <p className="text-red-400 text-sm">{pjError}</p>}
              {pjSuccess && <p className="text-emerald-400 text-sm">Job listing posted successfully!</p>}
              <button type="submit" disabled={pjSubmitting} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors text-sm">
                {pjSubmitting ? "Posting…" : "Post Job Listing"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
