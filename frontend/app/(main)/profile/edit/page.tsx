"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Save, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../../../lib/auth";

const API_PREFIX = "/qlab-api";
function apiUrl(path: string) { return `${API_PREFIX}${path}`; }

interface ProfileInput {
  display_name: string;
  title: string;
  institution: string;
  department: string;
  bio: string;
  research_interests: string[];
  orcid_id: string;
  google_scholar_url: string;
  github_username: string;
  website_url: string;
  location: string;
  public_profile: boolean;
  show_run_count: boolean;
  show_health_scores: boolean;
  show_recent_circuits: boolean;
}

const EMPTY_FORM: ProfileInput = {
  display_name: "",
  title: "",
  institution: "",
  department: "",
  bio: "",
  research_interests: [],
  orcid_id: "",
  google_scholar_url: "",
  github_username: "",
  website_url: "",
  location: "",
  public_profile: true,
  show_run_count: true,
  show_health_scores: true,
  show_recent_circuits: true,
};

function authHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "#5f6f80" }}>{hint}</div>}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--input-bg, #0d1b2a)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "8px 12px",
        color: "var(--text)",
        fontSize: 14,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
      }}
    />
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        cursor: "pointer",
        padding: "12px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 42,
          height: 22,
          borderRadius: 11,
          background: value ? "#38bdf8" : "#334155",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.2s",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 3,
            left: value ? 22 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.2s",
          }}
        />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{description}</div>
      </div>
    </label>
  );
}

export default function EditProfilePage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<ProfileInput>(EMPTY_FORM);
  const [interestInput, setInterestInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { router.push("/login"); return; }

    fetch(apiUrl("/api/v1/profiles/me"), {
      cache: "no-store",
      headers: authHeaders(token),
    })
      .then(async (res) => {
        if (res.status === 404) {
          // No profile yet — prefill display_name from user
          const body = await res.json() as { message: string; username: string };
          setUsername(body.username);
          setForm({ ...EMPTY_FORM, display_name: user?.name ?? "" });
        } else if (res.ok) {
          const data = await res.json() as ProfileInput & { username: string };
          setUsername(data.username);
          setForm({
            display_name: data.display_name ?? "",
            title: data.title ?? "",
            institution: data.institution ?? "",
            department: data.department ?? "",
            bio: data.bio ?? "",
            research_interests: data.research_interests ?? [],
            orcid_id: data.orcid_id ?? "",
            google_scholar_url: data.google_scholar_url ?? "",
            github_username: data.github_username ?? "",
            website_url: data.website_url ?? "",
            location: data.location ?? "",
            public_profile: data.public_profile ?? true,
            show_run_count: data.show_run_count ?? true,
            show_health_scores: data.show_health_scores ?? true,
            show_recent_circuits: data.show_recent_circuits ?? true,
          });
        }
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, [token, user, router]);

  function set<K extends keyof ProfileInput>(key: K, val: ProfileInput[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function addInterest() {
    const trimmed = interestInput.trim();
    if (trimmed && !form.research_interests.includes(trimmed)) {
      set("research_interests", [...form.research_interests, trimmed]);
    }
    setInterestInput("");
  }

  function removeInterest(ri: string) {
    set("research_interests", form.research_interests.filter((x) => x !== ri));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(apiUrl("/api/v1/profiles/me"), {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? "Save failed");
      }
      const saved = await res.json() as { username: string };
      setUsername(saved.username);
      setSuccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="page"><div className="empty">Loading profile…</div></main>;

  return (
    <main className="page">
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Edit Researcher Profile</h2>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Create your public research profile — like a GitHub profile, but for quantum experiments.
          </p>
        </div>
        {username && (
          <a
            href={`/profile/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#38bdf8",
              fontSize: 13,
              textDecoration: "none",
              background: "#1d6f8f22",
              border: "1px solid #1d6f8f55",
              borderRadius: 6,
              padding: "6px 14px",
            }}
          >
            <Eye size={14} /> View Public Profile <ExternalLink size={12} />
          </a>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "#ef444422",
            border: "1px solid #ef444455",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#fca5a5",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            background: "#22c55e22",
            border: "1px solid #22c55e55",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#86efac",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Profile saved successfully!{" "}
          {username && (
            <a href={`/profile/${username}`} target="_blank" rel="noopener noreferrer" style={{ color: "#86efac" }}>
              View it here →
            </a>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {/* Basic Info */}
        <section className="panel">
          <div className="panel-header"><h2>Basic Information</h2></div>
          <div style={{ padding: "16px 18px", display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Display Name *">
                <Input value={form.display_name} onChange={(v) => set("display_name", v)} placeholder="Dr. Jane Smith" />
              </Field>
              <Field label="Title">
                <Input value={form.title} onChange={(v) => set("title", v)} placeholder="PhD Candidate, Research Scientist…" />
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Institution">
                <Input value={form.institution} onChange={(v) => set("institution", v)} placeholder="MIT, Oxford, IBM Quantum…" />
              </Field>
              <Field label="Department">
                <Input value={form.department} onChange={(v) => set("department", v)} placeholder="Physics, Computer Science…" />
              </Field>
            </div>
            <Field label="Location">
              <Input value={form.location} onChange={(v) => set("location", v)} placeholder="Cambridge, MA" />
            </Field>
            <Field label="Bio" hint={`${form.bio.length}/500 characters`}>
              <textarea
                value={form.bio}
                onChange={(e) => set("bio", e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Brief description of your research focus and interests…"
                style={{
                  background: "var(--input-bg, #0d1b2a)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  color: "var(--text)",
                  fontSize: 14,
                  resize: "vertical",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </Field>
          </div>
        </section>

        {/* Research Interests */}
        <section className="panel">
          <div className="panel-header"><h2>Research Interests</h2></div>
          <div style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={interestInput}
                onChange={(e) => setInterestInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }}
                placeholder="e.g. VQE, QAOA, Error Correction…"
                style={{
                  flex: 1,
                  background: "var(--input-bg, #0d1b2a)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  color: "var(--text)",
                  fontSize: 14,
                }}
              />
              <button
                onClick={addInterest}
                style={{
                  background: "#1d6f8f",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Add
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {form.research_interests.map((ri) => (
                <span
                  key={ri}
                  style={{
                    background: "#1d6f8f22",
                    border: "1px solid #1d6f8f55",
                    color: "#7dd3f5",
                    borderRadius: 20,
                    padding: "4px 10px",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {ri}
                  <button
                    onClick={() => removeInterest(ri)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#7dd3f5",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {form.research_interests.length === 0 && (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>No interests added yet.</span>
              )}
            </div>
          </div>
        </section>

        {/* External Links */}
        <section className="panel">
          <div className="panel-header"><h2>Links &amp; Identifiers</h2></div>
          <div style={{ padding: "16px 18px", display: "grid", gap: 16 }}>
            <Field label="ORCID ID" hint="Format: 0000-0000-0000-000X">
              <Input value={form.orcid_id} onChange={(v) => set("orcid_id", v)} placeholder="0000-0001-2345-6789" />
            </Field>
            <Field label="Google Scholar URL">
              <Input value={form.google_scholar_url} onChange={(v) => set("google_scholar_url", v)} placeholder="https://scholar.google.com/citations?user=…" />
            </Field>
            <Field label="GitHub Username">
              <Input value={form.github_username} onChange={(v) => set("github_username", v)} placeholder="your-github-handle" />
            </Field>
            <Field label="Website URL">
              <Input value={form.website_url} onChange={(v) => set("website_url", v)} placeholder="https://your-lab-website.edu" />
            </Field>
          </div>
        </section>

        {/* Privacy Settings */}
        <section className="panel">
          <div className="panel-header">
            <h2>Privacy Settings</h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Control what visitors can see on your public profile
            </span>
          </div>
          <div style={{ padding: "0 18px 8px" }}>
            <Toggle
              label="Public Profile"
              description="When enabled, anyone can view your profile. When disabled, only logged-in users can find it."
              value={form.public_profile}
              onChange={(v) => set("public_profile", v)}
            />
            <Toggle
              label="Show Run Count"
              description="Display total runs and public runs count on your profile."
              value={form.show_run_count}
              onChange={(v) => set("show_run_count", v)}
            />
            <Toggle
              label="Show Health Scores"
              description="Show average health scores and health trends publicly."
              value={form.show_health_scores}
              onChange={(v) => set("show_health_scores", v)}
            />
            <Toggle
              label="Show Recent Circuits"
              description="Display your last 5 public experiments on your profile page."
              value={form.show_recent_circuits}
              onChange={(v) => set("show_recent_circuits", v)}
            />
          </div>
        </section>

        {/* Save button */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          {username && (
            <a
              href={`/profile/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--muted)",
                fontSize: 13,
                textDecoration: "none",
                padding: "10px 20px",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
            >
              <EyeOff size={14} /> View Public Profile
            </a>
          )}
          <button
            onClick={() => void save()}
            disabled={saving || !form.display_name.trim()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: saving ? "#334155" : "#1d6f8f",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            <Save size={15} /> {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
    </main>
  );
}
