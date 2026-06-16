// ------------------------------------------------------------------
// AI Insights
// ------------------------------------------------------------------

export type InsightRecommendation = {
  action: string;
  why: string;
  expected_impact: string;
  priority: "critical" | "high" | "medium" | "low";
};

export type RunInsights = {
  cached: boolean;
  model: string;
  created_at: string;
  summary: string;
  performance_grade: string;
  grade_rationale: string;
  key_findings: string[];
  primary_bottleneck: string;
  error_budget_narrative: string;
  recommendations: InsightRecommendation[];
  next_experiment: string;
  publication_note: string;
  confidence: "high" | "medium" | "low";
};

export async function fetchInsights(runId: string): Promise<RunInsights> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/insights`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error(res.status === 404 ? "not_generated" : "fetch_failed");
  return res.json();
}

export async function generateInsights(runId: string, force = false): Promise<RunInsights> {
  const url = apiUrl(`/api/v1/runs/${runId}/insights/generate${force ? "?force=true" : ""}`);
  const res = await fetch(url, { method: "POST", cache: "no-store", headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string,string>).detail ?? "Generation failed");
  }
  return res.json();
}

export async function checkInsightsAvailable(): Promise<{ available: boolean; model: string | null }> {
  const res = await fetch(apiUrl("/api/v1/runs/insights/status"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) return { available: false, model: null };
  return res.json();
}

// ------------------------------------------------------------------
// Deep Circuit Analysis
// ------------------------------------------------------------------

export interface CircuitInsight {
  algorithm_type: string;
  gate_efficiency_score: number;
  gate_efficiency_rationale: string;
  depth_coherence_ratio: string;
  entanglement_structure: string;
  gate_optimizations: Array<{
    optimization: string;
    gates_saved: string;
    priority: "high" | "medium" | "low";
  }>;
  run_id: string;
  model: string;
  generated_at: string;
}

export async function getCircuitInsights(runId: string): Promise<CircuitInsight> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/insights/circuit`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Circuit analysis failed");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Literature / arXiv suggestions
// ------------------------------------------------------------------

export interface LiteraturePaper {
  title: string;
  authors: string[];
  abstract_snippet: string;
  arxiv_id: string;
  url: string;
  relevance_reason: string;
}

export async function getRunLiterature(runId: string): Promise<{ papers: LiteraturePaper[]; error?: string; search_terms?: string[]; detected_algorithms?: string[] }> {
  try {
    const res = await fetch(apiUrl(`/api/v1/runs/${runId}/literature`), {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!res.ok) return { papers: [], error: "Literature endpoint unavailable" };
    return res.json();
  } catch {
    return { papers: [], error: "arXiv unavailable" };
  }
}

export type QLabRun = {
  run_id: string;
  circuit_name: string | null;
  qasm: string | null;
  fingerprint: {
    num_qubits?: number;
    num_clbits?: number;
    depth?: number;
    size?: number;
    gate_counts?: Record<string, number>;
    non_clifford_count?: number;
    non_clifford_ratio?: number;
    qasm_sha256?: string;
  };
  context: Record<string, unknown>;
  backend: string | null;
  parameters: Record<string, unknown>;
  execution: Record<string, unknown>;
  calibration: Record<string, unknown>;
  transpiler: Record<string, unknown>;
  timing: Record<string, unknown>;
  results: Record<string, unknown>;
  project: string | null;
  tags: string[];
  status: string;
  share_url: string | null;
  is_shared: boolean;
  share_page_url: string | null;
  benchmark_id: string | null;
  created_by_user_id: number | null;
  health_score: number | null;
  health_breakdown?: Record<string, number | null>;
  created_at: string;
  received_at?: string | null;
  dashboard_url: string;
};

export type SearchResult = {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  items: QLabRun[];
};

export type CompareResult = {
  left_run_id: string;
  right_run_id: string;
  summary: Record<string, boolean>;
  fingerprint_diff: Record<string, { left: unknown; right: unknown }>;
  parameter_diff: Record<string, { left: unknown; right: unknown }>;
  context_diff: Record<string, { left: unknown; right: unknown }>;
  timing_diff: Record<string, { left: unknown; right: unknown }>;
  calibration_diff: Record<string, { left: unknown; right: unknown }>;
  result_diff: Record<string, { left: unknown; right: unknown }>;
  qasm_diff: string;
};

export type Benchmark = {
  benchmark_id: string;
  name: string | null;
  backends: string[];
  run_ids: string[];
  status: string;
  project: string | null;
  created_at: string;
  runs?: QLabRun[];
  comparison?: Record<string, unknown>;
};

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  org_id: number | null;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

export type APIKeyInfo = {
  id: number;
  name: string;
  prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type Webhook = {
  id: number;
  name: string;
  url: string;
  events: string[];
  project_slug: string | null;
  is_active: boolean;
  last_triggered_at: string | null;
  last_status_code: number | null;
  created_at: string;
};

export type AuditLogEntry = {
  id: number;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  user_id: number | null;
  org_id: number | null;
  ip_address: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

const API_PREFIX = "/qlab-api";

function apiUrl(path: string): string {
  return `${API_PREFIX}${path}`;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("qlab_token");
}

function authHeaders(token?: string | null): Record<string, string> {
  const t = token ?? getStoredToken();
  if (!t) return {};
  return { Authorization: `Bearer ${t}` };
}

// ------------------------------------------------------------------
// Runs
// ------------------------------------------------------------------

export async function fetchRuns(filters?: {
  backend?: string;
  status?: string;
  project?: string;
  benchmark_id?: string;
}): Promise<QLabRun[]> {
  const params = new URLSearchParams();
  if (filters?.backend) params.set("backend", filters.backend);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.project) params.set("project", filters.project);
  if (filters?.benchmark_id) params.set("benchmark_id", filters.benchmark_id);
  const res = await fetch(apiUrl(`/api/v1/runs?${params}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load runs");
  return res.json();
}

export async function fetchRun(runId: string): Promise<QLabRun> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load run");
  return res.json();
}

export async function searchRuns(params: Record<string, string | number | boolean>): Promise<SearchResult> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const res = await fetch(apiUrl(`/api/v1/search/runs?${sp}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function deleteRun(token: string, runId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to delete run");
  }
}

export async function updateRunTags(token: string, runId: string, tags: string[]): Promise<QLabRun> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error("Failed to update tags");
  return res.json();
}

export async function fetchRunHealth(runId: string): Promise<Record<string, number | null>> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/health`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load health");
  return res.json();
}

// ------------------------------------------------------------------
// Compare
// ------------------------------------------------------------------

export async function compareRuns(leftRunId: string, rightRunId: string): Promise<CompareResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/compare/${leftRunId}/${rightRunId}/json`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to compare runs");
  return res.json();
}

// ------------------------------------------------------------------
// Benchmarks
// ------------------------------------------------------------------

export async function fetchBenchmarks(project?: string): Promise<Benchmark[]> {
  const params = project ? `?project=${encodeURIComponent(project)}` : "";
  const res = await fetch(apiUrl(`/api/v1/benchmarks${params}`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load benchmarks");
  return res.json();
}

export async function fetchBenchmark(benchmarkId: string): Promise<Benchmark> {
  const res = await fetch(apiUrl(`/api/v1/benchmarks/${benchmarkId}`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load benchmark");
  return res.json();
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------

export async function register(email: string, name: string, password: string, orgName?: string): Promise<AuthResponse> {
  const res = await fetch(apiUrl("/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password, org_name: orgName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Registration failed");
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Login failed");
  }
  return res.json();
}

export async function fetchMe(token?: string): Promise<AuthUser> {
  const res = await fetch(apiUrl("/auth/me"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function refreshToken(token: string): Promise<AuthResponse> {
  const res = await fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}

// ------------------------------------------------------------------
// Password
// ------------------------------------------------------------------

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(apiUrl("/api/v1/users/me/password"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to change password");
  }
}

// ------------------------------------------------------------------
// API Keys
// ------------------------------------------------------------------

export async function createAPIKey(token: string, name: string, expiresDays?: number): Promise<{ key: string } & APIKeyInfo> {
  const res = await fetch(apiUrl("/api/v1/users/me/api-keys"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name, expires_days: expiresDays }),
  });
  if (!res.ok) throw new Error("Failed to create key");
  return res.json();
}

export async function listAPIKeys(token?: string): Promise<APIKeyInfo[]> {
  const res = await fetch(apiUrl("/api/v1/users/me/api-keys"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to list keys");
  return res.json();
}

export async function deleteAPIKey(token: string, keyId: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/users/me/api-keys/${keyId}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to revoke key");
}

// ------------------------------------------------------------------
// Webhooks
// ------------------------------------------------------------------

export async function fetchWebhooks(token: string): Promise<Webhook[]> {
  const res = await fetch(apiUrl("/api/v1/webhooks"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load webhooks");
  return res.json();
}

export async function createWebhook(
  token: string,
  payload: { name: string; url: string; events: string[]; project_slug?: string; sign?: boolean },
): Promise<Webhook & { secret?: string }> {
  const res = await fetch(apiUrl("/api/v1/webhooks"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to create webhook");
  }
  return res.json();
}

export async function updateWebhook(
  token: string,
  id: number,
  payload: { is_active?: boolean; name?: string; url?: string; events?: string[] },
): Promise<Webhook> {
  const res = await fetch(apiUrl(`/api/v1/webhooks/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update webhook");
  return res.json();
}

export async function deleteWebhook(token: string, id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/webhooks/${id}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to delete webhook");
}

// ------------------------------------------------------------------
// Projects
// ------------------------------------------------------------------

export type Project = {
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  run_count: number;
};

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(apiUrl("/api/v1/projects"), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json();
}

export async function createProject(
  token: string,
  payload: { slug: string; name: string; description?: string },
): Promise<Project> {
  const res = await fetch(apiUrl("/api/v1/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to create project");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Team management
// ------------------------------------------------------------------

export type TeamMember = {
  id: number;
  email: string;
  name: string;
  role: string;
  created_at: string;
};

export type OrgInvite = {
  id: number;
  email: string;
  role: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  invite_url: string | null;
  token: string | null;
};

export type InviteResult = {
  invite_token: string;
  invite_url: string;
  email: string;
  role: string;
  expires_at: string;
};

export type InviteInfo = {
  email: string;
  role: string;
  org_name: string;
  expires_at: string;
};

export async function fetchTeamMembers(token: string): Promise<TeamMember[]> {
  const res = await fetch(apiUrl("/api/v1/team/members"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load team members");
  return res.json();
}

export async function fetchTeamInvites(token: string): Promise<OrgInvite[]> {
  const res = await fetch(apiUrl("/api/v1/team/invites"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load invites");
  return res.json();
}

export async function inviteMember(token: string, email: string, role: string): Promise<InviteResult> {
  const res = await fetch(apiUrl("/api/v1/team/invite"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to send invite");
  }
  return res.json();
}

export async function revokeInvite(token: string, inviteId: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/team/invites/${inviteId}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to revoke invite");
}

export async function changeMemberRole(token: string, userId: number, role: string): Promise<{ id: number; role: string }> {
  const res = await fetch(apiUrl(`/api/v1/team/members/${userId}/role`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to change role");
  }
  return res.json();
}

export async function removeMember(token: string, userId: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/team/members/${userId}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to remove member");
}

export async function validateInvite(inviteToken: string): Promise<InviteInfo> {
  const res = await fetch(apiUrl(`/api/v1/team/invite/validate?token=${encodeURIComponent(inviteToken)}`));
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Invalid invite");
  }
  return res.json();
}

export async function acceptInvite(authToken: string, inviteToken: string): Promise<{ joined: boolean; org_id: number; role: string }> {
  const res = await fetch(apiUrl(`/api/v1/team/invite/accept?token=${encodeURIComponent(inviteToken)}`), {
    method: "POST",
    headers: authHeaders(authToken),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to accept invite");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Analytics
// ------------------------------------------------------------------

export type TimeseriesPoint = {
  date: string;
  total: number;
  completed: number;
  failed: number;
  submitted: number;
  avg_health: number | null;
};

export type RunMetrics = {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  submitted_runs: number;
  runs_with_results: number;
  runs_with_calibration: number;
  completion_rate: number;
  failure_rate: number;
  result_capture_rate: number;
  calibration_capture_rate: number;
  max_depth: number;
  max_qubits: number;
  average_non_clifford_ratio: number;
  average_success_probability: number | null;
  by_backend: Record<string, number>;
  by_status: Record<string, number>;
  by_project: Record<string, number>;
  gate_counts: Record<string, number>;
};

export async function fetchAnalyticsTimeseries(
  token: string | null,
  params?: { project?: string; backend?: string; days?: number },
): Promise<TimeseriesPoint[]> {
  const sp = new URLSearchParams();
  if (params?.project) sp.set("project", params.project);
  if (params?.backend) sp.set("backend", params.backend);
  if (params?.days) sp.set("days", String(params.days));
  const res = await fetch(apiUrl(`/api/v1/analytics/timeseries?${sp}`), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load analytics");
  return res.json();
}

export async function fetchRunMetrics(
  token: string | null,
  params?: { project?: string; backend?: string },
): Promise<RunMetrics> {
  const sp = new URLSearchParams();
  if (params?.project) sp.set("project", params.project);
  if (params?.backend) sp.set("backend", params.backend);
  const res = await fetch(apiUrl(`/api/v1/metrics/runs?${sp}`), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load metrics");
  return res.json();
}

// ------------------------------------------------------------------
// Public share
// ------------------------------------------------------------------

export async function generateShareLink(token: string, runId: string): Promise<{ share_token: string; share_url: string }> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/share`), {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to generate share link");
  return res.json();
}

export async function fetchPublicRun(shareToken: string): Promise<QLabRun> {
  const res = await fetch(apiUrl(`/api/v1/runs/public/${shareToken}`), { cache: "no-store" });
  if (!res.ok) throw new Error("Shared run not found");
  return res.json();
}

// ------------------------------------------------------------------
// Run Metrics
// ------------------------------------------------------------------

export type MetricPoint = {
  id: number;
  name: string;
  value: number;
  step: number | null;
  logged_at: string;
};

export type RunMetricsResponse = {
  run_id: string;
  metrics: Record<string, MetricPoint[]>;
  summary: Record<string, number>;
  total_points: number;
};

export async function fetchRunMetricsData(runId: string): Promise<RunMetricsResponse> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/metrics`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load metrics");
  return res.json();
}

export async function logMetric(runId: string, name: string, value: number, step?: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/metrics`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ metrics: [{ name, value, step: step ?? null }] }),
  });
  if (!res.ok) throw new Error("Failed to log metric");
}

// ------------------------------------------------------------------
// Run Notes
// ------------------------------------------------------------------

export type RunNote = {
  id: number;
  run_id: string;
  content: string;
  user_id: number | null;
  author_name: string;
  author_email: string | null;
  created_at: string;
  updated_at: string;
};

export async function listRunNotes(runId: string): Promise<RunNote[]> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/notes`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load notes");
  return res.json();
}

export async function createRunNote(token: string, runId: string, content: string): Promise<RunNote> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/notes`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to create note");
  }
  return res.json();
}

export async function updateRunNote(token: string, noteId: number, content: string): Promise<RunNote> {
  const res = await fetch(apiUrl(`/api/v1/notes/${noteId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to update note");
  }
  return res.json();
}

export async function deleteRunNote(token: string, noteId: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/notes/${noteId}`), {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error("Failed to delete note");
}

// ------------------------------------------------------------------
// Root Cause Analysis
// ------------------------------------------------------------------

export type RCACause = {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: number;
  category: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  suggestions: string[];
};

export type RCAResult = {
  run_id: string;
  backend: string | null;
  status: string;
  analyzed_at: string;
  has_calibration: boolean;
  circuit_time_us: number | null;
  two_qubit_gate_count: number;
  overall_prognosis: "healthy" | "notice" | "warning" | "degraded" | "critical";
  cause_count: number;
  causes: RCACause[];
};

export async function fetchRCA(runId: string): Promise<RCAResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/rca`), { cache: "no-store" });
  if (!res.ok) throw new Error("RCA unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Error Budget
// ------------------------------------------------------------------

export type ErrorBudgetComponent = {
  source: string;
  label: string;
  error_contribution: number;
  pct_of_total: number;
  color: string;
  detail: string;
  available: boolean;
};

export type ErrorBudget = {
  run_id: string;
  has_calibration: boolean;
  num_qubits: number;
  gate_count: number;
  two_qubit_gate_count: number;
  single_qubit_gate_count: number;
  circuit_time_us: number;
  combined_fidelity: number;
  total_error_budget: number;
  dominant_source: string | null;
  components: ErrorBudgetComponent[];
  calibration_used: {
    avg_t1_us: number | null;
    avg_t2_us: number | null;
    avg_gate_error: number | null;
    avg_readout_error: number | null;
  };
};

export async function fetchErrorBudget(runId: string): Promise<ErrorBudget> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/error-budget`), { cache: "no-store" });
  if (!res.ok) throw new Error("Error budget unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Project Stats
// ------------------------------------------------------------------

export type ProjectTimelinePoint = {
  run_id: string;
  circuit_name: string | null;
  backend: string | null;
  status: string;
  created_at: string;
  depth: number | null;
  num_qubits: number | null;
  health_score: number | null;
};

export type ProjectStats = {
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  total_runs: number;
  completion_rate: number;
  by_status: Record<string, number>;
  by_backend: Record<string, number>;
  avg_health: number | null;
  max_health: number | null;
  min_health: number | null;
  timeline: ProjectTimelinePoint[];
};

export async function fetchProjectStats(slug: string): Promise<ProjectStats> {
  const res = await fetch(apiUrl(`/api/v1/projects/${encodeURIComponent(slug)}/stats`), { cache: "no-store" });
  if (!res.ok) throw new Error("Project not found");
  return res.json();
}

// ------------------------------------------------------------------
// Shadow Simulation
// ------------------------------------------------------------------

export type ShadowSimData = {
  run_id: string;
  has_shadow: boolean;
  sim_counts: Record<string, number>;
  real_counts: Record<string, number>;
  tvd: number;
  tvd_interpretation: string;
  tvd_level: "ok" | "warn" | "danger";
  noise_model_summary: Record<string, number>;
  shots: number | null;
  sim_backend: string | null;
};

export async function fetchShadowSim(runId: string): Promise<ShadowSimData> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/shadow`), { cache: "no-store" });
  if (!res.ok) throw new Error("No shadow simulation data");
  return res.json();
}

// ------------------------------------------------------------------
// Resource Estimator
// ------------------------------------------------------------------

export type ResourceEstimate = {
  run_id: string;
  backend: string | null;
  has_calibration: boolean;
  circuit: {
    num_qubits: number;
    depth: number;
    gate_count: number;
    two_qubit_gate_count: number;
    single_qubit_gate_count: number;
    rotation_gate_count: number;
    non_clifford_ratio: number | null;
  };
  fidelity_estimate: {
    gate_fidelity: number | null;
    readout_fidelity: number | null;
    combined_fidelity: number | null;
    dominant_error_source: string | null;
    bottleneck_gate: string | null;
  } | null;
  shots_recommendation: {
    for_1pct_precision: number;
    for_0_5pct_precision: number;
    for_0_1pct_precision: number;
    note: string;
  } | null;
  timing_estimate: {
    estimated_circuit_time_us: number;
    two_qubit_gate_count: number;
    single_qubit_gate_count: number;
    note: string;
  } | null;
  warnings: string[];
};

export async function fetchResourceEstimate(runId: string): Promise<ResourceEstimate> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/estimate`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch estimate");
  return res.json();
}

// ------------------------------------------------------------------
// Calibration Drift
// ------------------------------------------------------------------

export type DriftPoint = { t: string; v: number; run_id: string };

export type CalibrationDrift = {
  backend: string;
  total_runs: number;
  runs_with_calibration: number;
  series: {
    avg_t1_us?: DriftPoint[];
    avg_t2_us?: DriftPoint[];
    avg_gate_error?: DriftPoint[];
    avg_readout_error?: DriftPoint[];
  };
  trends: Record<string, number>;
  latest: Record<string, number | null>;
  warnings: string[];
};

export async function fetchCalibrationDrift(backend: string): Promise<CalibrationDrift> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/drift`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch calibration drift");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Assertions
// ------------------------------------------------------------------

export type RunAssertionResult = {
  id: number;
  run_id: string;
  label: string | null;
  assertion_type: string;
  state: string | null;
  expected_min: number | null;
  expected_max: number | null;
  actual_value: number | null;
  passed: boolean | null;
  message: string | null;
  created_at: string;
};

export type RunAssertionsResponse = {
  run_id: string;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  overall: string;
  assertions: RunAssertionResult[];
};

export async function fetchRunAssertions(runId: string): Promise<RunAssertionsResponse> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/assertions`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch assertions");
  return res.json();
}

// ------------------------------------------------------------------
// Noise Robustness Sweep
// ------------------------------------------------------------------

export type RobustnessSweepPoint = {
  error_multiplier: number;
  fidelity: number;
  gate_fidelity: number;
  coherence_fidelity: number;
  readout_fidelity: number;
  effective_1q_error: number;
  effective_2q_error: number;
};

export type RobustnessResult = {
  run_id: string;
  has_calibration: boolean;
  baseline_fidelity: number;
  robustness_score: number;
  robustness_label: "robust" | "moderate" | "fragile";
  fidelity_at_half_noise: number;
  fidelity_at_double_noise: number;
  noise_tolerance_multiplier: number | null;
  sensitivity_per_unit_noise: number;
  sweep: RobustnessSweepPoint[];
  circuit: {
    single_qubit_gates: number;
    two_qubit_gates: number;
    num_qubits: number;
    circuit_time_us: number;
  };
  calibration_used: {
    avg_gate_error: number;
    avg_2q_error: number;
    avg_t1_us: number | null;
    avg_t2_us: number | null;
    avg_readout_error: number;
  };
};

export async function fetchRobustness(runId: string): Promise<RobustnessResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/robustness`), { cache: "no-store" });
  if (!res.ok) throw new Error("Robustness data unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Parameter Sweep Analysis
// ------------------------------------------------------------------

export type SweepPoint = {
  run_id: string;
  circuit_name: string | null;
  x: number;
  y: number;
  status: string;
  backend: string | null;
  created_at: string;
};

export type SweepResult = {
  project: string;
  x_param: string;
  y_metric: string;
  total_runs: number;
  matched_points: number;
  points: SweepPoint[];
  available_x_params: string[];
  available_y_metrics: string[];
};

export type SweepParamsResult = {
  project: string;
  run_count: number;
  available_x_params: string[];
  available_y_metrics: string[];
};

export async function fetchSweep(
  project: string,
  xParam: string,
  yMetric: string,
): Promise<SweepResult> {
  const sp = new URLSearchParams({ project, x_param: xParam, y_metric: yMetric });
  const res = await fetch(apiUrl(`/api/v1/sweeps/analyze?${sp}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Sweep analysis failed");
  return res.json();
}

export async function fetchSweepParams(project: string): Promise<SweepParamsResult> {
  const res = await fetch(apiUrl(`/api/v1/sweeps/projects/${encodeURIComponent(project)}/params`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load sweep params");
  return res.json();
}

// ------------------------------------------------------------------
// Convergence Analysis
// ------------------------------------------------------------------

export type ConvergenceSeriesStats = {
  initial: number | null;
  final: number | null;
  best: number;
  worst: number;
  improvement: number | null;
  improvement_pct: number | null;
  variance: number;
  total_steps: number;
  convergence_rate_per_step: number | null;
};

export type ConvergenceSeries = {
  name: string;
  is_energy: boolean;
  steps: number[];
  values: number[];
  smoothed: number[];
  stats: ConvergenceSeriesStats;
  convergence: {
    converged: boolean;
    verdict: string;
    plateau_step: number | null;
    spread?: number;
  };
};

export type ConvergenceResult = {
  run_id: string;
  has_convergence_data: boolean;
  message?: string;
  algorithm_hint: string | null;
  total_steps: number;
  prognosis: string;
  best_energy: number | null;
  total_improvement: number | null;
  series: ConvergenceSeries[];
};

export async function fetchConvergence(runId: string): Promise<ConvergenceResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/convergence`), { cache: "no-store" });
  if (!res.ok) throw new Error("Convergence data unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Error Mitigation Advisor
// ------------------------------------------------------------------

export type MitigationRec = {
  method: string;
  title: string;
  confidence: number;
  priority: number;
  reasoning: string;
  suggested_parameters: Record<string, unknown>;
  expected_tvd_reduction_pct: number;
  docs_hint: string;
};

export type MitigationAdvice = {
  run_id: string;
  backend: string | null;
  overall_severity: "critical" | "high" | "moderate" | "low";
  has_calibration: boolean;
  has_shadow_simulation: boolean;
  recommendation_count: number;
  top_recommendation: string | null;
  recommendations: MitigationRec[];
  context: Record<string, unknown>;
};

export async function fetchMitigationAdvice(runId: string): Promise<MitigationAdvice> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/mitigation-advice`), { cache: "no-store" });
  if (!res.ok) throw new Error("Mitigation advice unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Policy
// ------------------------------------------------------------------

export type PolicyResult = {
  name: string;
  description: string;
  rules: Record<string, unknown>;
  rule_docs: Record<string, string>;
  active: boolean;
  id?: number;
  created_at?: string;
};

export async function fetchPolicy(): Promise<PolicyResult> {
  const res = await fetch(apiUrl("/api/v1/policy"), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load policy");
  return res.json();
}

export async function savePolicy(name: string, description: string, rules: Record<string, unknown>): Promise<{ saved: boolean }> {
  const res = await fetch(apiUrl("/api/v1/policy"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, description, rules }),
  });
  if (!res.ok) throw new Error("Failed to save policy");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Volume
// ------------------------------------------------------------------

export type QVSweepPoint = {
  d: number;
  gate_fidelity: number;
  coherence_fidelity: number;
  combined_fidelity: number;
  above_threshold: boolean;
};

export type QuantumVolumeResult = {
  run_id: string;
  has_calibration: boolean;
  backend: string | null;
  num_qubits: number;
  estimated_qv: number;
  log2_qv: number;
  grade: "excellent" | "good" | "moderate" | "limited";
  note: string;
  fidelity_threshold: number;
  max_reliable_depth: number;
  sweep: QVSweepPoint[];
  calibration_used: {
    avg_gate_1q_error: number;
    avg_gate_2q_error: number;
    avg_t1_us: number | null;
    avg_t2_us: number | null;
    avg_readout_error: number;
  };
};

export async function fetchQuantumVolume(runId: string): Promise<QuantumVolumeResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/quantum-volume`), { cache: "no-store" });
  if (!res.ok) throw new Error("QV data unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Citations
// ------------------------------------------------------------------

export type Citation = {
  id: number;
  run_id: string;
  arxiv_id: string | null;
  doi: string | null;
  title: string | null;
  authors: string | null;
  journal: string | null;
  year: number | null;
  note: string | null;
  created_at: string;
  arxiv_url: string | null;
  doi_url: string | null;
  bibtex: string;
};

export type CitationsResponse = {
  run_id: string;
  count: number;
  citations: Citation[];
};

export async function fetchCitations(runId: string): Promise<CitationsResponse> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/citations`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load citations");
  return res.json();
}

export async function addCitation(
  runId: string,
  payload: { arxiv_id?: string; doi?: string; title?: string; authors?: string; journal?: string; year?: number; note?: string },
): Promise<Citation> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/citations`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? "Failed to add citation");
  }
  return res.json();
}

export async function deleteCitation(runId: string, citationId: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/citations/${citationId}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete citation");
}

// ------------------------------------------------------------------
// Admin
// ------------------------------------------------------------------

export async function fetchAuditLogs(token: string, params?: Record<string, string>): Promise<{ total: number; items: AuditLogEntry[] }> {
  const sp = new URLSearchParams(params || {});
  const res = await fetch(apiUrl(`/api/v1/admin/audit-logs?${sp}`), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load audit logs");
  return res.json();
}

export async function fetchSystemStats(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl("/api/v1/admin/stats"), { headers: authHeaders(token) });
  if (!res.ok) throw new Error("Failed to load stats");
  return res.json();
}

// ------------------------------------------------------------------
// SSE
// ------------------------------------------------------------------

export function createRunStream(
  onEvent: (type: string, data: QLabRun) => void,
  project?: string,
): () => void {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  const token = getStoredToken();
  if (token) params.set("token", token);
  const url = apiUrl(`/api/v1/runs/stream?${params}`);
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data as string) as { type: string; data: QLabRun };
      if (type !== "connected") onEvent(type, data);
    } catch {
      // ignore malformed events
    }
  };
  return () => es.close();
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Anomaly Detection
// ------------------------------------------------------------------

export type AnomalyFlag = {
  metric: string;
  label: string;
  z_score: number;
  percentile: number;
  severity: "critical" | "warning";
  direction: "high" | "low";
  message: string;
};

export type AnomalyResult = {
  run_id: string;
  backend: string | null;
  peer_count: number;
  sufficient_peers: boolean;
  is_anomaly: boolean;
  anomaly_score: number;
  z_scores: Record<string, number>;
  percentiles: Record<string, number>;
  flags: AnomalyFlag[];
};

export async function fetchAnomaly(runId: string): Promise<AnomalyResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/anomaly`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load anomaly data");
  return res.json();
}

// ------------------------------------------------------------------
// Health Trend
// ------------------------------------------------------------------

export type HealthTrendPoint = {
  date: string;
  avg_health: number;
  min_health: number;
  max_health: number;
  run_count: number;
  p25: number;
  p75: number;
};

export type HealthTrendResult = {
  backend: string | null;
  project: string | null;
  days: number;
  granularity: string;
  total_runs: number;
  points: HealthTrendPoint[];
  trend_slope: number | null;
  trend_direction: "improving" | "degrading" | "stable";
};

export async function fetchHealthTrend(params?: { backend?: string; project?: string; days?: number; granularity?: string }): Promise<HealthTrendResult> {
  const p = new URLSearchParams();
  if (params?.backend) p.set("backend", params.backend);
  if (params?.project) p.set("project", params.project);
  if (params?.days) p.set("days", String(params.days));
  if (params?.granularity) p.set("granularity", params.granularity);
  const res = await fetch(apiUrl(`/api/v1/analytics/health-trend?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load health trend");
  return res.json();
}

// ------------------------------------------------------------------
// Parameter Landscape
// ------------------------------------------------------------------

export type LandscapeSeries = {
  name: string;
  x_values: number[];
  y_values: number[];
  x_label: string;
  y_label: string;
  min_value: number;
  min_at_step: number;
  point_count: number;
  x_range: [number, number];
  y_range: [number, number];
};

export type LandscapeGrid2D = {
  param_name: string;
  energy_name: string;
  points: { step: number; param: number; energy: number }[];
  min_energy: number;
  min_param: number;
};

export type LandscapeResult = {
  run_id: string;
  has_landscape_data: boolean;
  series: LandscapeSeries[];
  param_names: string[];
  grid_2d: LandscapeGrid2D | null;
};

export async function fetchLandscape(runId: string): Promise<LandscapeResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/landscape`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load landscape");
  return res.json();
}

// ------------------------------------------------------------------
// Qubit Map
// ------------------------------------------------------------------

export type MappedPair = {
  logical: number;
  physical: number;
  T1_us: number | null;
  readout_error: number | null;
};

export type RoutingOverhead = {
  depth_before: number | null;
  depth_after: number | null;
  depth_overhead_pct: number | null;
  size_before: number | null;
  size_after: number | null;
  swap_count: number;
};

export type QubitMapResult = {
  run_id: string;
  num_qubits: number;
  has_layout: boolean;
  layout: Record<string, number>;
  mapped_pairs: MappedPair[];
  coupling_edges: [number, number][];
  routing_overhead: RoutingOverhead;
  transpiler_duration_ms: number | null;
  transpiler_version: string | null;
};

export async function fetchQubitMap(runId: string): Promise<QubitMapResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/qubit-map`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load qubit map");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Diff
// ------------------------------------------------------------------

export type GateHistogramEntry = { a: number; b: number; delta: number };

export type CircuitDiffResult = {
  run_a: { run_id: string; circuit_name: string | null; gate_count: number };
  run_b: { run_id: string; circuit_name: string | null; gate_count: number };
  similarity: number;
  diff_stats: { added: number; removed: number; unchanged: number };
  gate_histogram_delta: Record<string, GateHistogramEntry>;
  fingerprint_delta: Record<string, { a: unknown; b: unknown }>;
  unified_diff: string[];
  diff_lines_truncated: boolean;
};

export async function fetchCircuitDiff(runId: string, otherId: string): Promise<CircuitDiffResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/diff/${otherId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load circuit diff");
  return res.json();
}

// ------------------------------------------------------------------
// Hardware Recommendation
// ------------------------------------------------------------------

export type CircuitSpec = {
  num_qubits: number;
  depth: number;
  size: number;
  two_qubit_gate_count: number;
  circuit_time_us: number;
  non_clifford_ratio: number;
};

export type BackendRecommendation = {
  backend: string;
  score: number;
  grade: string;
  ineligible: boolean;
  ineligible_reason: string | null;
  reasons: string[];
  warnings: string[];
  calibration_summary: Record<string, number | null>;
  calibration_age_days: number | null;
  total_runs_on_backend: number;
  has_calibration: boolean;
};

export type HardwareRecResult = {
  circuit_spec: CircuitSpec;
  backend_count: number;
  eligible_count: number;
  recommendation: string | null;
  backends: BackendRecommendation[];
};

export type BackendInfo = {
  backend: string;
  run_count: number;
  latest_run: string | null;
  has_calibration: boolean;
  avg_ge_2q: number | null;
  avg_t1_us: number | null;
  avg_ro: number | null;
};

export async function fetchHardwareRec(spec: CircuitSpec): Promise<HardwareRecResult> {
  const res = await fetch(apiUrl("/api/v1/hardware/recommend"), {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error("Failed to get hardware recommendation");
  return res.json();
}

export async function fetchBackends(): Promise<BackendInfo[]> {
  const res = await fetch(apiUrl("/api/v1/hardware/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load backends");
  const data = await res.json();
  return data.backends;
}

// ------------------------------------------------------------------
// Statistical Comparison
// ------------------------------------------------------------------

export type StatsCompareRequest = {
  group_a: string[];
  group_b: string[];
  metric: string;
};

export type GroupInfo = {
  run_ids: string[];
  missing: string[];
  usable_n: number;
};

export type Descriptive = {
  n: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
};

export type StatsCompareResult = {
  metric: string;
  group_a: GroupInfo;
  group_b: GroupInfo;
  descriptive: {
    group_a: Descriptive;
    group_b: Descriptive;
    mean_difference: number;
    direction: string;
  };
  welch_t_test: { t: number | null; df: number | null; p_value: number | null };
  effect_size: { cohens_d: number | null; magnitude: string };
  bootstrap_ci_95: { lower: number; upper: number; contains_zero: boolean };
  verdict: string;
  interpretation: string;
};

export async function runStatsCompare(body: StatsCompareRequest): Promise<StatsCompareResult> {
  const res = await fetch(apiUrl("/api/v1/stats/compare"), {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Comparison failed");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Campaigns
// ------------------------------------------------------------------

export type GridAxis = {
  name: string;
  values: (string | number | boolean)[];
};

export type SweepRow = {
  params: Record<string, unknown>;
  runs: Array<{ run_id: string; status: string; health_score: number | null; created_at: string | null; backend: string | null }>;
  run_count: number;
  best_health: number | null;
  status: string;
};

export type CampaignSummary = {
  campaign_id: string;
  name: string;
  description: string | null;
  project: string | null;
  grid_spec: { grid: GridAxis[] };
  tags: string[];
  status: string;
  created_at: string | null;
  completed_at: string | null;
  total_combinations: number;
  run_count: number;
  completion_rate: number;
  avg_health: number | null;
  max_health: number | null;
  by_status: Record<string, number>;
  by_backend: Record<string, number>;
};

export type CampaignDetail = CampaignSummary & {
  grid: GridAxis[];
  combinations_total: number;
  combinations_pending: number;
  combinations_done: number;
  sweep_rows: SweepRow[];
  runs: Array<{
    run_id: string;
    circuit_name: string | null;
    backend: string | null;
    status: string;
    parameters: Record<string, unknown>;
    health_score: number | null;
    created_at: string | null;
  }>;
};

export type CampaignCreateResult = {
  campaign_id: string;
  name: string;
  total_combinations: number;
  combinations: Record<string, unknown>[];
  created_at: string;
  sdk_snippet: string;
};

export async function listCampaigns(project?: string): Promise<CampaignSummary[]> {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  const res = await fetch(apiUrl(`/api/v1/campaigns?${params}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load campaigns");
  return res.json();
}

export async function getCampaign(campaignId: string): Promise<CampaignDetail> {
  const res = await fetch(apiUrl(`/api/v1/campaigns/${campaignId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Campaign not found");
  return res.json();
}

export async function createCampaign(body: {
  name: string;
  grid: GridAxis[];
  description?: string;
  project?: string;
  tags?: string[];
}): Promise<CampaignCreateResult> {
  const res = await fetch(apiUrl("/api/v1/campaigns"), {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Failed to create campaign");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Semantic Circuit Search
// ------------------------------------------------------------------

export type SimilarRunResult = {
  run_id: string;
  circuit_name: string | null;
  backend: string | null;
  project: string | null;
  status: string;
  created_at: string | null;
  similarity: number;
  embedding_method: "wl_gnn" | "structural" | "mixed";
  health_score: number | null;
  has_qasm: boolean;
  tags: string[];
  fingerprint_delta: {
    depth: number;
    size: number;
    num_qubits: number;
    nc_ratio: number;
  };
};

export type SimilarRunsResponse = {
  anchor_run_id: string;
  anchor_circuit_name: string | null;
  anchor_backend: string | null;
  anchor_has_qasm: boolean;
  anchor_fingerprint: Record<string, unknown>;
  embedding_source: "wl_gnn" | "structural" | "qasm" | "fingerprint";
  candidates_scanned: number;
  result_count: number;
  results: SimilarRunResult[];
};

export type EmbedAllResponse = {
  total_checked: number;
  already_embedded: number;
  wl_gnn_cached: number;
  queued: number;
};

export type UnitaryFidelityResult = {
  run_id: string;
  other_run_id: string;
  num_qubits?: number;
  fidelity: number;
  equivalent: boolean;
  method?: string;
  note?: string;
};

export async function checkUnitaryFidelity(runId: string, otherId: string): Promise<UnitaryFidelityResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/unitary-fidelity/${otherId}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Unitary check failed");
  }
  return res.json();
}

export async function findSimilarRuns(
  runId: string,
  params?: { n?: number; min_sim?: number; project?: string; backend?: string; same_qubits?: boolean },
): Promise<SimilarRunsResponse> {
  const p = new URLSearchParams();
  if (params?.n) p.set("n", String(params.n));
  if (params?.min_sim !== undefined) p.set("min_sim", String(params.min_sim));
  if (params?.project) p.set("project", params.project);
  if (params?.backend) p.set("backend", params.backend);
  if (params?.same_qubits) p.set("same_qubits", "true");
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/similar?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Similar search failed");
  return res.json();
}

export async function embedAllRuns(limit = 500): Promise<EmbedAllResponse> {
  const res = await fetch(apiUrl(`/api/v1/circuits/embed-all?limit=${limit}`), {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Embed failed");
  return res.json();
}

// ------------------------------------------------------------------
// Multi-Run AI Chat
// ------------------------------------------------------------------

export type AskRequest = {
  question: string;
  project?: string;
  backend?: string;
  days?: number;
  max_runs?: number;
};

export type AskResponse = {
  answer: string;
  cited_run_ids: string[];
  run_count: number;
  model: string;
};

export type AskStatus = {
  available: boolean;
  model: string | null;
};

export async function askQuestion(body: AskRequest): Promise<AskResponse> {
  const res = await fetch(apiUrl("/api/v1/ask"), {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Ask failed");
  }
  return res.json();
}

export async function fetchAskStatus(): Promise<AskStatus> {
  const res = await fetch(apiUrl("/api/v1/ask/status"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) return { available: false, model: null };
  return res.json();
}

export function createAskStream(
  body: AskRequest,
  onMeta: (meta: { run_count: number; run_ids: string[] }) => void,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  let aborted = false;
  (async () => {
    try {
      const res = await fetch(apiUrl("/api/v1/ask/stream"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        onError("Request failed");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const raw = part.slice(6).trim();
          if (raw === "[DONE]") { onDone(); return; }
          try {
            const ev = JSON.parse(raw) as Record<string, unknown>;
            if (ev.meta) onMeta(ev.meta as { run_count: number; run_ids: string[] });
            else if (ev.token !== undefined) onToken(ev.token as string);
            else if (ev.error) { onError(ev.error as string); return; }
          } catch { /* skip */ }
        }
      }
      onDone();
    } catch (e) {
      if (!aborted) onError(String(e));
    }
  })();
  return () => { aborted = true; };
}

// ------------------------------------------------------------------
// Noise Model Simulator
// ------------------------------------------------------------------

export type NoiseBudget = {
  gate_errors: number;
  coherence: number;
  readout: number;
};

export type AnalyticalNoise = {
  method: string;
  estimated_tvd: number;
  estimated_success_probability: number;
  noise_budget: NoiseBudget;
  noise_budget_absolute: {
    gate_errors: number;
    coherence: number;
    readout: number;
    total_infidelity: number;
  };
  parameters_used: {
    avg_ge_1q: number | null;
    avg_ge_2q: number | null;
    avg_ro: number | null;
    avg_t1_us: number | null;
    avg_t2_us: number | null;
    estimated_circuit_time_us: number;
  };
};

export type QubitNoiseSummary = {
  qubit: number;
  t1?: number;
  t2?: number;
  readout_error?: number;
  gate_error_1q?: number;
};

export type NoiseSimResult = {
  run_id: string;
  has_calibration: boolean;
  has_qasm: boolean;
  analytical: AnalyticalNoise;
  aer_simulation: { counts: Record<string, number>; shots: number } | null;
  aer_tvd: number | null;
  real_hardware_tvd: number | null;
  comparison: { noisy_sim_vs_real_tvd: number; verdict: string } | null;
  qubit_noise_summary: QubitNoiseSummary[];
  dominant_noise_source: string | null;
};

export async function fetchNoiseSim(runId: string): Promise<NoiseSimResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/noise-sim`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Noise simulation unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Alerts
// ------------------------------------------------------------------

export type AlertRule = {
  id: number;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  project: string | null;
  backend: string | null;
  webhook_url: string | null;
  is_slack: boolean;
  active: boolean;
  created_at: string;
  fired_count: number;
};

export type AlertRuleCreate = {
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  project?: string;
  backend?: string;
  webhook_url?: string;
  is_slack?: boolean;
  active?: boolean;
};

export type AlertDigest = {
  period_days: number;
  project: string | null;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  completion_rate: number;
  avg_health: number | null;
  best_run: { run_id: string; circuit_name: string | null; backend: string | null; health_score: number } | null;
  worst_run: { run_id: string; circuit_name: string | null; backend: string | null; health_score: number } | null;
  by_status: Record<string, number>;
  by_backend: Record<string, number>;
  by_project: Record<string, number>;
  generated_at: string;
  ai_summary: string | null;
};

export async function listAlertRules(): Promise<AlertRule[]> {
  const res = await fetch(apiUrl("/api/v1/alerts/rules"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load alert rules");
  return res.json();
}

export async function createAlertRule(body: AlertRuleCreate): Promise<AlertRule> {
  const res = await fetch(apiUrl("/api/v1/alerts/rules"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Failed to create rule");
  }
  return res.json();
}

export async function deleteAlertRule(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/alerts/rules/${id}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to delete rule");
}

export async function toggleAlertRule(id: number): Promise<AlertRule> {
  const res = await fetch(apiUrl(`/api/v1/alerts/rules/${id}/toggle`), { method: "PATCH", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to toggle rule");
  return res.json();
}

export async function fetchAlertDigest(days = 7, project?: string): Promise<AlertDigest> {
  const p = new URLSearchParams({ days: String(days) });
  if (project) p.set("project", project);
  const res = await fetch(apiUrl(`/api/v1/alerts/digest?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load digest");
  return res.json();
}

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

export function qlabApiPath(path: string): string {
  return apiUrl(path);
}

export function healthColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#aaa";
  if (score >= 70) return "#27ae60";
  if (score >= 40) return "#e67e22";
  return "#e74c3c";
}

// ------------------------------------------------------------------
// Feature #4: Calibration-Gated Dispatch Queue
// ------------------------------------------------------------------

export type DispatchThresholds = {
  min_t1_us?: number | null;
  min_t2_us?: number | null;
  max_gate_error_1q?: number | null;
  max_gate_error_2q?: number | null;
  max_readout_error?: number | null;
};

export type DispatchEntry = {
  id: string;
  circuit_name: string;
  backend: string;
  run_id: string | null;
  thresholds: DispatchThresholds;
  webhook_url: string | null;
  notes: string | null;
  status: "pending" | "released" | "cancelled";
  queued_at: string;
  released_at: string | null;
  release_reason: string | null;
  calibration_at_release: Record<string, unknown> | null;
};

export type DispatchQueueResponse = {
  total: number;
  pending: number;
  released: number;
  entries: DispatchEntry[];
};

export type EnqueueResult = {
  entry_id: string;
  status: "pending" | "released";
  queued_at: string;
  released_at: string | null;
  release_reason: string | null;
  calibration_failures: string[];
};

export type CheckQueueResult = {
  checked: number;
  released: number;
  released_ids: string[];
  still_pending: number;
};

export async function enqueueDispatch(body: {
  circuit_name: string;
  backend: string;
  run_id?: string;
  thresholds?: DispatchThresholds;
  webhook_url?: string;
  notes?: string;
}): Promise<EnqueueResult> {
  const res = await fetch(apiUrl("/api/v1/dispatch/queue"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Enqueue failed");
  }
  return res.json();
}

export async function listDispatchQueue(params?: {
  backend?: string;
  status?: "pending" | "released" | "cancelled";
}): Promise<DispatchQueueResponse> {
  const p = new URLSearchParams();
  if (params?.backend) p.set("backend", params.backend);
  if (params?.status) p.set("status", params.status);
  const res = await fetch(apiUrl(`/api/v1/dispatch/queue?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load dispatch queue");
  return res.json();
}

export async function checkDispatchQueue(): Promise<CheckQueueResult> {
  const res = await fetch(apiUrl("/api/v1/dispatch/check"), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to check dispatch queue");
  return res.json();
}

export async function cancelDispatchEntry(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/dispatch/queue/${id}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to cancel entry");
}

export async function releaseDispatchEntry(id: string): Promise<{ entry_id: string; status: string }> {
  const res = await fetch(apiUrl(`/api/v1/dispatch/queue/${id}/release`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to release entry");
  return res.json();
}

// ------------------------------------------------------------------
// Feature #5: Bayesian Calibration Forecasting
// ------------------------------------------------------------------

export type BayesCalForecastPoint = {
  time: string;
  predicted: number;
  lower: number;
  upper: number;
};

export type MetricForecast = {
  insufficient_data?: boolean;
  data_points: number;
  required?: number;
  last_value?: number;
  trend_per_hour?: number;
  std?: number;
  trend_direction?: "improving" | "degrading" | "stable";
  forecast_points?: BayesCalForecastPoint[];
  cal_key: string;
};

export type CalibrationForecastResult = {
  backend: string;
  run_count: number;
  horizon_hours: number;
  metrics: {
    t1?: MetricForecast;
    t2?: MetricForecast;
    gate_error?: MetricForecast;
    readout?: MetricForecast;
  };
  generated_at: string;
};

export async function fetchCalibrationForecast(
  backend: string,
  hours = 24,
  metrics = "t1,t2,gate_error,readout"
): Promise<CalibrationForecastResult> {
  const p = new URLSearchParams({ hours: String(hours), metrics });
  const res = await fetch(apiUrl(`/api/v1/backends/${backend}/calibration-forecast?${p}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load calibration forecast");
  return res.json();
}

// ------------------------------------------------------------------
// Feature #6: ZX-Calculus Simplification
// ------------------------------------------------------------------

export type ZXSimplifyResult = {
  run_id: string;
  has_qasm: boolean;
  error?: string;
  method?: "pyzx_full_reduce" | "qiskit_transpiler_opt3";
  simplified_qasm?: string | null;
  original_t_count?: number;
  simplified_t_count?: number;
  t_count_reduction?: number;
  reduction_pct?: number;
  original_gate_count?: number;
  simplified_gate_count?: number;
  saved_to_run: boolean;
};

export async function zxSimplify(runId: string): Promise<ZXSimplifyResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/zx-simplify`), {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "ZX simplification failed");
  }
  return res.json();
}

// ------------------------------------------------------------------
// Feature #7: Observable Estimation (Shadow Tomography)
// ------------------------------------------------------------------

export type ShadowTomoResult = {
  run_id: string;
  n_qubits: number;
  n_shots: number;
  method: string;
  z_expectations: number[];
  zz_correlations: Record<string, number>;
  global_parity: number;
  renyi2_entropy: number;
  entanglement_indicator: number;
  most_probable_state: string;
  most_probable_probability: number;
  success_probability: number;
  note: string;
};

export async function fetchShadowTomo(runId: string): Promise<ShadowTomoResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/shadow-tomo`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Failed to compute observables");
  }
  return res.json();
}

// ------------------------------------------------------------------
// QOET-lite: Observer Effect Telemetry
// ------------------------------------------------------------------

export type QOETelemetryPoint = {
  index: number;
  label: string;
  depth: number;
  shots: number;
  n_qubits: number;
  purity: number;
  entropy: number;
  coherence_proxy: number;
  correlation_signal: number;
  dominant_state: string;
  dominant_probability: number;
  z_expectations: number[];
};

export type QOETelemetryResult = {
  run_id: string;
  source: string;
  confidence: "low" | "medium" | "high";
  snapshot_count: number;
  coherence_trend: "single_snapshot" | "decaying" | "recovering" | "stable";
  purity_trend: "single_snapshot" | "decaying" | "recovering" | "stable";
  correlation_trend: "single_snapshot" | "decaying" | "recovering" | "stable";
  initial_coherence: number;
  final_coherence: number;
  coherence_drop: number;
  points: QOETelemetryPoint[];
  note: string;
};

export async function fetchQOETelemetry(runId: string): Promise<QOETelemetryResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/qoe-telemetry`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "QOET telemetry unavailable");
  }
  return res.json();
}

// ------------------------------------------------------------------
// UAF-CPT + AEMD
// ------------------------------------------------------------------

export type UAFTargetScore = {
  target: string;
  family: string;
  portability_score: number;
  estimated_fidelity_score: number;
  combined_score: number;
  translation_overhead_gates: number;
  connectivity_penalty: number;
  unsupported_gates: string[];
  estimated_circuit_time_us: number;
  basis_translation: {
    native_gates: string[];
    translated_two_qubit_gate_count: number;
  };
};

export type UAFCPTResult = {
  run_id: string;
  algorithmic_fingerprint: {
    semantic_hash: string;
    n_qubits: number;
    depth: number;
    size: number;
    two_qubit_gate_count: number;
    parametric_gate_count: number;
    non_clifford_count: number;
    interaction_density: number;
    interaction_edges: { edge: string; count: number }[];
  };
  best_target: string | null;
  portability_grade: string;
  targets: UAFTargetScore[];
  note: string;
};

export async function fetchUAFCPT(runId: string): Promise<UAFCPTResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/uaf-cpt`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("UAF-CPT unavailable");
  return res.json();
}

export type AEMDComponent = {
  source: string;
  label: string;
  error: number;
  detail: string;
  pct_of_physical: number;
};

export type AEMDResult = {
  run_id: string;
  verdict: "hardware_limited" | "algorithm_limited" | "mixed";
  observed_success: number;
  observed_success_source: string;
  predicted_success_from_hardware: number;
  hardware_error: number;
  algorithmic_residual_error: number;
  hardware_attribution_pct: number;
  algorithmic_attribution_pct: number;
  unexplained_hardware_margin: number;
  dominant_hardware_source: string | null;
  components: AEMDComponent[];
  logical_signals: string[];
  calibration_used: Record<string, number | null>;
  note: string;
};

export async function fetchAEMD(runId: string): Promise<AEMDResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/aemd`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("AEMD unavailable");
  return res.json();
}

// ------------------------------------------------------------------
// Feature #8: Non-Stabilizerness (Magic) Tracker
// ------------------------------------------------------------------

export type MagicResult = {
  run_id: string;
  backend: string | null;
  n_qubits: number;
  total_gates: number;
  t_count: number;
  nc_count: number;
  clifford_fraction: number;
  magic_score: number;
  stabilizer_rank_bound: number;
  classical_simulation_cost: "polynomial" | "sub-exponential (t-sim)" | "exponential";
  quantum_advantage_regime: boolean;
  t_count_interpretation: string;
};

export async function fetchMagic(runId: string): Promise<MagicResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/magic`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load magic analysis");
  return res.json();
}

// ------------------------------------------------------------------
// Feature #9: Circuit Topology (Persistent Homology)
// ------------------------------------------------------------------

export type TopologyInteraction = { q1: number; q2: number; weight: number };
export type PersistencePoint = { birth: number; death: number; lifetime: number };

export type CircuitTopologyResult = {
  run_id: string;
  n_qubits: number;
  source: "qasm" | "fingerprint_chain_approximation";
  n_interactions: number;
  betti_0: number;
  betti_1: number;
  connected_components: number;
  independent_cycles: number;
  persistence_diagram: PersistencePoint[];
  topological_complexity: number;
  connectivity_entropy: number;
  most_connected_qubit: number | null;
  interaction_graph: TopologyInteraction[];
};

export async function fetchCircuitTopology(runId: string): Promise<CircuitTopologyResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/topology`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load circuit topology");
  return res.json();
}

// ------------------------------------------------------------------
// Calibration Intelligence Network (Feature #1)
// ------------------------------------------------------------------

export type NetworkConfig = {
  opt_in: boolean;
  instance_id: string;
  node_label: string;
  joined_at: string | null;
};

export type NetworkPeer = {
  id: string;
  url: string;
  label: string;
  added_at: string;
};

export type PeerProbeResult = {
  id: string;
  url: string;
  label: string;
  reachable: boolean;
  status: NetworkStatus | null;
};

export type NetworkStatus = {
  instance_id: string;
  node_label: string;
  opt_in: boolean;
  backends: { backend: string; n_snapshots: number }[];
  queried_at: string;
};

export type MetricStat = {
  n: number;
  mean: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
};

export type CalibrationSnapshot = {
  instance_id: string;
  node_label: string;
  backend: string;
  n_snapshots: number;
  date_range: { from: string | null; to: string | null };
  last_updated: string;
  metrics: Record<string, MetricStat>;
};

export type AggregateResult = {
  backend: string;
  sources: number;
  total_snapshots: number;
  network_summary: string;
  global_metrics: Record<string, MetricStat>;
  per_source: CalibrationSnapshot[];
  source_status: {
    instance_id: string;
    label: string;
    source: "local" | "peer";
    peer_url?: string;
    n_snapshots?: number;
    last_updated?: string;
    reachable: boolean;
  }[];
  aggregated_at: string;
};

export type NetworkBackendsResult = {
  backends: string[];
  peers: { url: string; label: string; reachable: boolean; backends: string[] }[];
  queried_at: string;
};

export async function fetchNetworkConfig(): Promise<NetworkConfig> {
  const res = await fetch(apiUrl("/api/v1/network/config"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load network config");
  return res.json();
}

export async function patchNetworkConfig(body: { opt_in?: boolean; node_label?: string }): Promise<NetworkConfig> {
  const res = await fetch(apiUrl("/api/v1/network/config"), {
    method: "PATCH",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to update network config");
  return res.json();
}

export async function listNetworkPeers(): Promise<{ peers: NetworkPeer[] }> {
  const res = await fetch(apiUrl("/api/v1/network/peers"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load peers");
  return res.json();
}

export async function addNetworkPeer(url: string, label?: string): Promise<{ peer: NetworkPeer; reachable: boolean; peer_status: NetworkStatus | null }> {
  const res = await fetch(apiUrl("/api/v1/network/peers"), {
    method: "POST",
    cache: "no-store",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ url, label }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Failed to add peer");
  }
  return res.json();
}

export async function removeNetworkPeer(peerId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/network/peers/${peerId}`), {
    method: "DELETE",
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to remove peer");
}

export async function probeNetworkPeers(): Promise<{ peers: PeerProbeResult[]; total: number; reachable: number }> {
  const res = await fetch(apiUrl("/api/v1/network/peers/probe"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to probe peers");
  return res.json();
}

export async function fetchNetworkBackends(): Promise<NetworkBackendsResult> {
  const res = await fetch(apiUrl("/api/v1/network/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load network backends");
  return res.json();
}

export async function fetchAggregateCalibration(backend: string): Promise<AggregateResult> {
  const res = await fetch(apiUrl(`/api/v1/network/aggregate/${encodeURIComponent(backend)}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to aggregate calibration");
  return res.json();
}

// ------------------------------------------------------------------
// Pauli Noise Learning (Feature #2)
// ------------------------------------------------------------------

export type PauliNoiseResult = {
  run_id: string;
  backend: string | null;
  circuit_name: string | null;
  analyzed_at: string;
  n_qubits: number;
  total_shots: number;
  unique_outcomes: number;
  renyi2_entropy: number;
  max_entropy: number;
  entropy_fraction: number;
  effective_depolarizing_rate: number;
  noise_tier: "low" | "moderate" | "high" | "very_high";
  noise_interpretation: string;
  mean_flip_rate: number;
  noisiest_qubit: number | null;
  cleanest_qubit: number | null;
  qubit_flip_rates: number[];
  qubit_polarizations: number[];
  heavy_output_fraction: number;
  quantum_advantage_indicator: boolean;
  dominant_bitstring: string;
  dominant_probability: number;
  calibration_context: {
    calibration_readout_error?: number;
    calibration_gate_error?: number;
    readout_vs_noise?: string;
  };
};

export type PauliNoisePoint = {
  run_id: string;
  circuit_name: string | null;
  created_at: string;
  n_qubits: number;
  effective_depolarizing_rate: number;
  mean_flip_rate: number;
  renyi2_entropy: number;
  entropy_fraction: number;
  heavy_output_fraction: number;
  noise_tier: string;
  total_shots: number;
  cal_t1_us: number | null;
  cal_gate_error: number | null;
};

export type PauliNoiseHistoryResult = {
  backend: string;
  n_runs_analyzed: number;
  noise_trend: "improving" | "degrading" | "stable";
  mean_dep_rate: number | null;
  points: PauliNoisePoint[];
  analyzed_at: string;
};

export async function fetchPauliNoise(runId: string): Promise<PauliNoiseResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/pauli-noise`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load Pauli noise analysis");
  return res.json();
}

export async function fetchPauliNoiseHistory(backend: string, limit = 50): Promise<PauliNoiseHistoryResult> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/pauli-noise-history?limit=${limit}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load Pauli noise history");
  return res.json();
}

// ------------------------------------------------------------------
// Ansatz Discovery Engine (Feature #3)
// ------------------------------------------------------------------

export type AnsatzRecommendation = {
  name: string;
  family: string;
  score: number;
  description: string;
  recommended_reps: number;
  parameter_count: number;
  entangler: string;
  connectivity: string;
  expressibility: number;
  trainability_ceiling_qubits: number;
  best_for: string[];
  expected_fidelity_range: { low: number; high: number };
};

export type AnsatzDiscoveryResult = {
  run_id: string;
  backend: string | null;
  circuit_family: string;
  circuit_info: {
    family: string;
    n_qubits: number;
    depth: number;
    cx_count: number;
    nc_ratio: number;
    entanglement_density: number;
    layers_per_qubit: number;
  };
  top_recommendation: AnsatzRecommendation;
  all_recommendations: AnsatzRecommendation[];
  barren_plateau_warning: string | null;
  justification: string;
  analyzed_at: string;
};

export async function fetchAnsatzDiscovery(runId: string): Promise<AnsatzDiscoveryResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/ansatz-discovery`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load ansatz discovery");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Advantage Oracle (Feature #4)
// ------------------------------------------------------------------

export type StrategyDetail = {
  log10_flops: number;
  human: string;
  tier: "easy" | "moderate" | "hard" | "intractable";
};

export type AdvantageOracleResult = {
  run_id: string;
  backend: string | null;
  n_qubits: number;
  depth: number;
  t_count: number;
  cx_count: number;
  entanglement_width: number;
  hardness_tier: "easy" | "moderate" | "hard" | "intractable";
  hardness_label: string;
  best_classical_strategy: string;
  best_classical_cost_log10: number;
  best_classical_cost_human: string;
  limiting_factor: string;
  strategies: Record<string, StrategyDetail>;
  heavy_output_fraction: number | null;
  advantage_score: number;
  contributing_factors: string[];
  narrative: string;
  analyzed_at: string;
};

export async function fetchAdvantageOracle(runId: string): Promise<AdvantageOracleResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/advantage-oracle`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load advantage oracle");
  return res.json();
}

// ------------------------------------------------------------------
// Hardware Drift Changepoint Detection (Feature #5)
// ------------------------------------------------------------------

export type MetricShift = {
  before_mean: number;
  after_mean: number;
  pct_change: number;
  direction: "improvement" | "degradation";
};

export type Changepoint = {
  index: number;
  votes: number;
  confidence: number;
  affected_metrics: string[];
  timestamp: string | null;
  run_id: string | null;
  runs_before: number;
  runs_after: number;
  metric_shifts: Record<string, MetricShift>;
};

export type MetricTimeSeries = {
  label: string;
  higher_is_better: boolean;
  n_points: number;
  mean: number;
  std: number;
  trend: "increasing" | "decreasing" | "stable";
  changepoint_indices: number[];
  values: number[];
};

export type DriftChangepointResult = {
  backend: string;
  n_runs_analysed: number;
  date_range: { from: string | null; to: string | null };
  n_changepoints: number;
  changepoints: Changepoint[];
  metrics: Record<string, MetricTimeSeries>;
  trust_window: {
    from_index: number;
    n_runs: number;
    run_ids: string[];
    description: string;
  };
  narrative: string;
  analyzed_at: string;
};

export async function fetchDriftChangepoints(backend: string, limit = 100, sensitivity = 1.0): Promise<DriftChangepointResult> {
  const params = new URLSearchParams({ limit: String(limit), sensitivity: String(sensitivity) });
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/drift-changepoints?${params}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load drift changepoints");
  return res.json();
}

// ------------------------------------------------------------------
// Cross-Backend Transfer Prediction (Feature #6)
// ------------------------------------------------------------------

export type TransferComponentScores = {
  calibration_similarity: number;
  gate_compatibility: number;
  structural_fit: number;
  noise_compatibility: number;
};

export type TransferPrediction = {
  target_backend: string;
  target_family: string;
  transfer_score: number;
  tier: "excellent" | "good" | "fair" | "poor";
  component_scores: TransferComponentScores;
  gates_needing_decomposition: string[];
  target_n_qubits: number | "unknown";
  reason: string;
  has_calibration_data: boolean;
};

export type TransferPredictionResult = {
  run_id: string;
  source_backend: string;
  n_qubits: number;
  circuit_family: string;
  top_recommendation: string;
  top_score: number;
  predictions: TransferPrediction[];
  analyzed_at: string;
};

export async function fetchTransferPrediction(runId: string): Promise<TransferPredictionResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/transfer-prediction`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load transfer prediction");
  return res.json();
}

// ------------------------------------------------------------------
// Natural Language Circuit Retrieval (Feature #7)
// ------------------------------------------------------------------

export type NLQFingerprintSummary = {
  num_qubits: number | null;
  depth: number | null;
  size: number | null;
  cx_count: number | null;
  non_clifford_ratio: number | null;
};

export type NLQResult = {
  run_id: string;
  circuit_name: string;
  backend: string | null;
  created_at: string | null;
  score: number;
  match_reasons: string[];
  fingerprint_summary: NLQFingerprintSummary;
};

export type NLQSearchResult = {
  query: string;
  parsed_features: Record<string, unknown>;
  results: NLQResult[];
  total_searched: number;
  searched_at: string;
};

export async function nlqSearch(q: string, limit = 10): Promise<NLQSearchResult> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const res = await fetch(apiUrl(`/api/v1/circuits/search?${params}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("NLQ search failed");
  return res.json();
}

// ------------------------------------------------------------------
// Evolutionary Circuit Optimizer (Feature #8)
// ------------------------------------------------------------------

export type EvoCandidate = {
  fingerprint: {
    num_qubits: number;
    depth: number;
    size: number;
    cx_count: number;
    non_clifford_ratio: number;
  };
  mutations_applied: string[];
  fitness: number;
  improvement_pct: number;
  deltas: {
    depth: number;
    size: number;
    cx_count: number;
    non_clifford_ratio: number;
  };
  summary: string;
};

export type EvoOptimizerResult = {
  run_id: string;
  n_qubits: number;
  baseline: {
    num_qubits: number;
    depth: number;
    size: number;
    cx_count: number;
    non_clifford_ratio: number;
  };
  baseline_fitness: number;
  generations: number;
  pop_size: number;
  seed: number;
  candidates: EvoCandidate[];
  narrative: string;
  optimized_at: string;
};

export async function fetchEvoOptimizer(
  runId: string,
  generations = 20,
  popSize = 8,
  seed = 42,
): Promise<EvoOptimizerResult> {
  const params = new URLSearchParams({
    generations: String(generations),
    pop_size: String(popSize),
    seed: String(seed),
  });
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/evo-optimize?${params}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Evolutionary optimizer failed");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Bug Database (Feature #9)
// ------------------------------------------------------------------

export type BugMatchedRule = {
  path: string;
  op: string;
  threshold: number;
  actual: number | null;
};

export type BugMatch = {
  id: string;
  category: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  suggested_fix: string;
  matched_rules: BugMatchedRule[];
};

export type BugDatabaseResult = {
  run_id: string;
  verdict: "critical" | "warning" | "info" | "clean";
  narrative: string;
  n_matches: number;
  n_critical: number;
  n_warnings: number;
  n_info: number;
  matches: BugMatch[];
  db_size: number;
  scanned_at: string;
};

export async function fetchBugDatabase(runId: string): Promise<BugDatabaseResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/bug-database`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Bug database scan failed");
  return res.json();
}

// ------------------------------------------------------------------
// Reproducibility Score + Fraud Detection (Feature #10)
// ------------------------------------------------------------------

export type ReproDimension = {
  score: number;
  note: string;
  weight: number;
};

export type FraudFlag = {
  code: string;
  severity: "warning" | "info";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
};

export type ReproScoreResult = {
  run_id: string;
  overall_score: number;
  overall_pct: number;
  tier: "excellent" | "good" | "fair" | "poor";
  narrative: string;
  dimensions: Record<string, ReproDimension>;
  fraud_flags: FraudFlag[];
  fraud_severity: "warning" | "info" | "clean";
  scored_at: string;
};

export async function fetchReproScore(runId: string): Promise<ReproScoreResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/repro-score`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Reproducibility score failed");
  return res.json();
}

// ------------------------------------------------------------------
// Passive Randomized Benchmarking (Novel A)
// ------------------------------------------------------------------

export type PassiveRBFit = { p: number; A: number; B: number; r2: number };
export type PassiveRBSparkline = {
  raw: { d: number; f: number }[];
  fitted: { d: number; f: number }[];
};
export type PassiveRBResult = {
  backend: string;
  n_runs_used: number;
  avg_n_qubits: number;
  fit: PassiveRBFit;
  epc: number;
  gate_fidelity: number;
  process_infidelity: number;
  trend: "improving" | "stable" | "degrading" | "insufficient_data";
  early_mean_fidelity: number;
  late_mean_fidelity: number;
  sparkline: PassiveRBSparkline;
  narrative: string;
  computed_at: string;
};
export async function fetchPassiveRB(backend: string, limit = 200): Promise<PassiveRBResult> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/passive-rb?limit=${limit}`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Passive RB failed");
  return res.json();
}

// ------------------------------------------------------------------
// Experiment Design Engine (Novel B)
// ------------------------------------------------------------------

export type ExperimentSuggestion = {
  shots: number;
  num_qubits: number;
  depth: number;
  optimization_level: number;
  predicted_health: number;
  uncertainty: number;
  expected_improvement: number;
  novelty: number;
};
export type ExperimentDesignResult = {
  project: string;
  n_training_runs: number;
  best_health_seen: number;
  length_scale: number;
  suggestions: ExperimentSuggestion[];
  feature_axes: string[];
  computed_at: string;
};
export async function fetchExperimentDesign(slug: string, n = 5): Promise<ExperimentDesignResult> {
  const res = await fetch(apiUrl(`/api/v1/projects/${encodeURIComponent(slug)}/suggest-experiment?n=${n}`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Experiment design failed");
  return res.json();
}

// ------------------------------------------------------------------
// Device Identity Fingerprinting (Novel C)
// ------------------------------------------------------------------

export type FingerprintFeature = {
  name: string; early: number; recent: number; pct_change: number; flag: boolean;
};
export type FingerprintTimeline = {
  week_start: string; n_runs: number; fingerprint: string; drift_from_baseline: number;
};
export type DeviceFingerprintResult = {
  backend: string;
  fingerprint_id: string;
  n_runs: number;
  drift_score: number;
  drift_label: "low" | "medium" | "high";
  features: FingerprintFeature[];
  feature_vector: number[];
  timeline: FingerprintTimeline[];
  narrative: string;
  computed_at: string;
};
export async function fetchDeviceFingerprint(backend: string): Promise<DeviceFingerprintResult> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/device-fingerprint`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Device fingerprint failed");
  return res.json();
}

// ------------------------------------------------------------------
// Hamiltonian Learning (Novel D)
// ------------------------------------------------------------------

export type HamiltonianCoupling = {
  i: number; j: number; J: number; strength: string; type: string;
};
export type HamiltonianResult = {
  backend: string;
  n_qubits: number;
  n_runs_used: number;
  local_fields: { qubit: number; h: number }[];
  couplings: HamiltonianCoupling[];
  coupling_matrix: number[][];
  magnetisation: number[];
  max_coupling: number;
  max_local_field: number;
  coupling_threshold: number;
  narrative: string;
  computed_at: string;
};
export async function fetchHamiltonian(backend: string, threshold = 0.02): Promise<HamiltonianResult> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/hamiltonian?coupling_threshold=${threshold}`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Hamiltonian learning failed");
  return res.json();
}

// ------------------------------------------------------------------
// Entanglement Certification (Novel E)
// ------------------------------------------------------------------

export type EntanglementPair = { i: number; j: number; mi: number; label: string };
export type EntanglementResult = {
  run_id: string;
  n_qubits: number;
  n_bitstrings: number;
  total_entropy_bits: number;
  max_entropy_bits: number;
  entanglement_score: number;
  tier: string;
  is_gme_candidate: boolean;
  min_bipartite_mi: number;
  min_cut_subsystem: number[] | null;
  schmidt_rank_lb: number;
  pairwise_mi: EntanglementPair[];
  mi_matrix: number[][];
  correlation_matrix: number[][];
  narrative: string;
  computed_at: string;
};
export async function fetchEntanglementCert(runId: string): Promise<EntanglementResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/entanglement-cert`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Entanglement certification failed");
  return res.json();
}

// ------------------------------------------------------------------
// Milestone Trajectory Prediction (Novel F)
// ------------------------------------------------------------------

export type MilestonePrediction = {
  value: number; label: string; higher_is_better: boolean;
  days: number | null; feasible: boolean; note?: string;
  predicted_date?: string; ci_low?: string; ci_high?: string; ci_days?: number;
};
export type MilestoneMetric = {
  key: string; label: string; current_value: number;
  slope_per_day: number; r2: number; trend: string; n_points: number;
  milestones: MilestonePrediction[];
  sparkline: { x: number; y: number }[];
};
export type MilestonePredictResult = {
  backend: string; observation_days: number; n_runs: number;
  metrics: MilestoneMetric[];
  computed_at: string;
};
export async function fetchMilestonePredict(backend: string): Promise<MilestonePredictResult> {
  const res = await fetch(apiUrl(`/api/v1/backends/${encodeURIComponent(backend)}/milestone-predict`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Milestone prediction failed");
  return res.json();
}

// ------------------------------------------------------------------
// Causal Discovery Engine (Novel G)
// ------------------------------------------------------------------

export type CausalEdge = {
  source: string; target: string; partial_corr: number;
  p_value: number; n_obs: number; strength: string; direction: string; separator: string[];
};
export type CausalDiscoveryResult = {
  project: string; n_runs: number; alpha: number;
  variables: string[];
  variable_labels: Record<string, string>;
  edges: CausalEdge[];
  health_score_drivers: (CausalEdge & { influence_var: string; outcome_var: string })[];
  adjacency: number[][];
  narrative: string;
  computed_at: string;
};
export async function fetchCausalGraph(slug: string, alpha = 0.05): Promise<CausalDiscoveryResult> {
  const res = await fetch(apiUrl(`/api/v1/projects/${encodeURIComponent(slug)}/causal-graph?alpha=${alpha}`), {
    cache: "no-store", headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Causal discovery failed");
  return res.json();
}

// ------------------------------------------------------------------
// Job Execution Engine
// ------------------------------------------------------------------

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobSubmission = {
  job_id: string;
  provider: string;
  provider_job_id: string | null;
  run_id: string | null;
  qasm: string | null;
  backend: string;
  shots: number;
  status: JobStatus;
  cost_credits: number | null;
  circuit_name: string | null;
  project_slug: string | null;
  error_message: string | null;
  result: Record<string, unknown> | null;
  submitted_at: string;
  completed_at: string | null;
};

export type JobSubmitRequest = {
  provider: "ibm" | "ionq" | "braket" | "simulator";
  backend: string;
  qasm: string;
  shots?: number;
  circuit_name?: string;
  project_slug?: string;
};

export type JobStats = {
  total: number;
  by_status: Record<string, number>;
  by_provider: Record<string, number>;
  total_cost_credits: number;
  avg_cost_credits: number;
};

export async function submitJob(req: JobSubmitRequest): Promise<JobSubmission> {
  const res = await fetch(apiUrl("/api/v1/jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listJobs(params?: { status?: string; provider?: string; limit?: number }): Promise<JobSubmission[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.provider) qs.set("provider", params.provider);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetch(apiUrl(`/api/v1/jobs?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to list jobs");
  return res.json();
}

export async function getJob(jobId: string): Promise<JobSubmission> {
  const res = await fetch(apiUrl(`/api/v1/jobs/${jobId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export async function cancelJob(jobId: string): Promise<{ job_id: string; status: string }> {
  const res = await fetch(apiUrl(`/api/v1/jobs/${jobId}/cancel`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Cancel failed");
  return res.json();
}

export async function syncJob(jobId: string): Promise<JobSubmission> {
  const res = await fetch(apiUrl(`/api/v1/jobs/${jobId}/sync`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}

export async function getJobStats(): Promise<JobStats> {
  const res = await fetch(apiUrl("/api/v1/jobs/stats/summary"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Stats failed");
  return res.json();
}

// ------------------------------------------------------------------
// Multi-Provider Ingest
// ------------------------------------------------------------------

export type IngestResult = {
  run_id: string;
  source_format: string;
  backend: string;
  shots: number;
  counts: Record<string, number>;
  success_probability: number;
  n_qubits: number;
  metadata: Record<string, unknown>;
};

export type IngestRequest = {
  backend?: string;
  shots?: number;
  project_slug?: string;
  tags?: string[];
  payload: Record<string, unknown>;
  qasm?: string;
};

export async function ingestAuto(req: IngestRequest): Promise<IngestResult> {
  const res = await fetch(apiUrl("/api/v1/ingest/auto"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestCirq(req: IngestRequest): Promise<IngestResult> {
  const res = await fetch(apiUrl("/api/v1/ingest/cirq"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestIonQ(req: IngestRequest): Promise<IngestResult> {
  const res = await fetch(apiUrl("/api/v1/ingest/ionq"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestBraket(req: IngestRequest): Promise<IngestResult> {
  const res = await fetch(apiUrl("/api/v1/ingest/braket"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestOpenQASM3(req: IngestRequest): Promise<IngestResult> {
  const res = await fetch(apiUrl("/api/v1/ingest/openqasm3"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// State Tomography
// ------------------------------------------------------------------

export type TomographyResult = {
  tomo_id: string;
  run_id: string;
  n_qubits: number;
  density_matrix_re: number[][];
  density_matrix_im: number[][];
  purity: number;
  fidelity_to_ideal: number | null;
  pauli_expectations: Record<string, number>;
  bloch_vector?: [number, number, number];
  concurrence?: number;
  status: string;
  created_at: string;
};

export type TomographyRequest = {
  basis_measurements?: Record<string, Record<string, number>>;
  ideal_state?: string;
};

export async function runTomographyForRun(runId: string, req?: TomographyRequest): Promise<TomographyResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/tomography`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req ?? {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTomography(runId: string): Promise<TomographyResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/tomography`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Tomography not found");
  return res.json();
}

// ------------------------------------------------------------------
// Variational Convergence Tracker
// ------------------------------------------------------------------

export type VariationalIteration = {
  iter: number;
  energy: number;
  grad_norm: number | null;
  params?: number[];
  extra?: Record<string, unknown>;
};

export type VariationalRun = {
  vrun_id: string;
  algorithm: string;
  run_id: string | null;
  project_slug: string | null;
  ansatz_type: string | null;
  n_parameters: number;
  n_qubits: number;
  hamiltonian_type: string | null;
  iterations: VariationalIteration[];
  optimal_energy: number | null;
  optimal_params: number[];
  convergence_status: "running" | "converged" | "diverged" | "stalled" | "barren_plateau";
  created_at: string;
  completed_at: string | null;
  analysis?: Record<string, unknown>;
};

export type VariationalRunCreate = {
  algorithm: "vqe" | "qaoa" | "adapt_vqe" | "other";
  run_id?: string;
  project_slug?: string;
  ansatz_type?: string;
  n_parameters?: number;
  n_qubits?: number;
  hamiltonian_type?: string;
};

export async function createVariationalRun(req: VariationalRunCreate): Promise<VariationalRun> {
  const res = await fetch(apiUrl("/api/v1/variational"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listVariationalRuns(params?: { algorithm?: string; status?: string; limit?: number }): Promise<VariationalRun[]> {
  const qs = new URLSearchParams();
  if (params?.algorithm) qs.set("algorithm", params.algorithm);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetch(apiUrl(`/api/v1/variational?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to list variational runs");
  return res.json();
}

export async function getVariationalRun(vrunId: string): Promise<VariationalRun> {
  const res = await fetch(apiUrl(`/api/v1/variational/${vrunId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Variational run not found");
  return res.json();
}

export async function addVariationalIterations(vrunId: string, iterations: VariationalIteration[]): Promise<VariationalRun> {
  const res = await fetch(apiUrl(`/api/v1/variational/${vrunId}/iterations`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ iterations }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// QPU Cost Tracker
// ------------------------------------------------------------------

export type ProviderCost = { provider: string; total_credits: number; job_count: number; avg_per_job: number };
export type ProjectCost = { project_slug: string | null; total_credits: number; job_count: number };

export type CostSummary = {
  period: string;
  total_credits: number;
  total_usd_estimate: number;
  credits_per_usd: number;
  by_provider: ProviderCost[];
  by_project: ProjectCost[];
  monthly_budget_credits: number | null;
  budget_pct_used: number | null;
  budget_status: string;
  active_alerts: number;
};

export type CostTimelineEntry = { date: string; credits: number; jobs: number };
export type CostTimeline = { period: string; resolution: string; entries: CostTimelineEntry[]; total_credits: number; total_jobs: number };

export type CostEstimate = {
  provider: string; backend: string; shots: number; depth: number;
  estimated_credits: number; estimated_usd: number; breakdown: Record<string, unknown>;
};

export type BudgetAlert = {
  alert_id: string; name: string; budget_type: string;
  project_slug: string | null; provider: string | null;
  threshold_credits: number; alert_at_pct: number;
  triggered: boolean; created_at: string;
};

export async function getCostSummary(period?: string): Promise<CostSummary> {
  const qs = period ? `?period=${period}` : "";
  const res = await fetch(apiUrl(`/api/v1/costs/summary${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Cost summary failed");
  return res.json();
}

export async function getCostTimeline(days?: number): Promise<CostTimeline> {
  const qs = days ? `?days=${days}` : "";
  const res = await fetch(apiUrl(`/api/v1/costs/timeline${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Cost timeline failed");
  return res.json();
}

export async function estimateCost(params: { provider: string; backend: string; shots: number; depth: number }): Promise<CostEstimate> {
  const qs = new URLSearchParams(params as unknown as Record<string, string>);
  const res = await fetch(apiUrl(`/api/v1/costs/estimate?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Cost estimate failed");
  return res.json();
}

export async function listBudgetAlerts(): Promise<BudgetAlert[]> {
  const res = await fetch(apiUrl("/api/v1/costs/budget"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Budget alerts failed");
  return res.json();
}

export async function createBudgetAlert(req: {
  name: string; budget_type?: string; threshold_credits: number;
  alert_at_pct?: number; project_slug?: string; provider?: string;
}): Promise<BudgetAlert> {
  const res = await fetch(apiUrl("/api/v1/costs/budget"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteBudgetAlert(alertId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/costs/budget/${alertId}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Delete failed");
}

export type RegressionGate = {
  integration_id: string;
  name: string;
  project_slug: string | null;
  baseline_run_id: string;
  fidelity_drop_threshold_pct: number;
  is_active?: boolean;
  last_triggered_at?: string | null;
  webhook_secret?: string;
};

export type RegressionCheckResult = {
  check_id: string;
  status: "passed" | "failed";
  passed: boolean;
  baseline_run_id: string;
  candidate_run_id: string;
  fidelity_drop_pct: number;
  threshold_pct: number;
  estimated_unitary_fidelity: number;
  gate_score: number;
  depth_score: number;
  qubit_score: number;
};

export async function listRegressionGates(): Promise<RegressionGate[]> {
  const res = await fetch(apiUrl("/api/v1/ci/regression-gates"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to list regression gates");
  return res.json();
}

export async function createRegressionGate(req: {
  name: string;
  repo_url?: string;
  project_slug?: string;
  baseline_run_id: string;
  fidelity_drop_threshold_pct?: number;
}): Promise<RegressionGate> {
  const res = await fetch(apiUrl("/api/v1/ci/regression-gates"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runRegressionCheck(req: {
  run_id: string;
  baseline_run_id?: string;
  commit_sha?: string;
  branch?: string;
  fidelity_drop_threshold_pct?: number;
}): Promise<RegressionCheckResult> {
  const res = await fetch(apiUrl("/api/v1/ci/regression-check"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitAdviceFeedback(req: {
  run_id: string;
  feature: "mitigation" | "rca" | "bug_database";
  item_id?: string;
  rating: "up" | "down" | "accepted";
  note?: string;
}): Promise<void> {
  const res = await fetch(apiUrl("/api/v1/feedback"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Feedback failed");
}

// ------------------------------------------------------------------
// RBAC + Audit Log
// ------------------------------------------------------------------

export type RbacRole = { name: string; rank: number; description: string; permissions: string[] };
export type RbacUser = { id: number; email: string; name: string; role: string; rank: number; permissions: string[]; is_active: boolean; created_at: string };
export type AuditLogResponse = { total: number; offset: number; limit: number; items: AuditLogEntry[] };

export async function getRbacRoles(): Promise<{ roles: RbacRole[]; total_permissions: string[] }> {
  const res = await fetch(apiUrl("/api/v1/rbac/roles"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("RBAC roles failed");
  return res.json();
}

export async function listRbacUsers(): Promise<RbacUser[]> {
  const res = await fetch(apiUrl("/api/v1/rbac/users"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("RBAC users failed");
  return res.json();
}

export async function changeUserRole(userId: number, role: string): Promise<{ user_id: number; old_role: string; new_role: string }> {
  const res = await fetch(apiUrl(`/api/v1/rbac/users/${userId}/role`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getAuditLog(params?: { action?: string; resource_type?: string; limit?: number; offset?: number }): Promise<AuditLogResponse> {
  const qs = new URLSearchParams();
  if (params?.action) qs.set("action", params.action);
  if (params?.resource_type) qs.set("resource_type", params.resource_type);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const res = await fetch(apiUrl(`/api/v1/rbac/audit-log?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Audit log failed");
  return res.json();
}

// ------------------------------------------------------------------
// CI/CD Integration
// ------------------------------------------------------------------

export type CICDIntegration = {
  integration_id: string; name: string; provider: string; repo_url: string;
  project_slug: string | null; baseline_run_id: string | null;
  auto_fail_threshold: number; checks: string[]; is_active: boolean;
  last_triggered_at: string | null; created_at: string;
};

export type CICDCheck = {
  check_id: string; integration_id: string; commit_sha: string;
  branch: string | null; status: "passed" | "failed" | "warning" | "pending";
  results: Record<string, unknown>; created_at: string; completed_at: string | null;
};

export type CICDIntegrationCreate = {
  name: string; provider?: string; repo_url: string;
  project_slug?: string; baseline_run_id?: string;
  auto_fail_threshold?: number; checks?: string[];
};

export async function createCICDIntegration(req: CICDIntegrationCreate): Promise<CICDIntegration & { webhook_secret: string; webhook_url: string }> {
  const res = await fetch(apiUrl("/api/v1/cicd/integrations"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listCICDIntegrations(): Promise<CICDIntegration[]> {
  const res = await fetch(apiUrl("/api/v1/cicd/integrations"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("CICD integrations failed");
  return res.json();
}

export async function listCICDChecks(params?: { integration_id?: string; status?: string; limit?: number }): Promise<CICDCheck[]> {
  const qs = new URLSearchParams();
  if (params?.integration_id) qs.set("integration_id", params.integration_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetch(apiUrl(`/api/v1/cicd/checks?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("CICD checks failed");
  return res.json();
}

export async function runCICDManualCheck(integrationId: string, req: { qasm: string; commit_sha?: string; branch?: string }): Promise<{ check_id: string; status: string; checks: unknown[] }> {
  const res = await fetch(apiUrl(`/api/v1/cicd/integrations/${integrationId}/check`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Versioning
// ------------------------------------------------------------------

export type DiffStats = {
  delta_depth: number; delta_gates: number; delta_cx: number;
  delta_nc_ratio: number; delta_qubits: number;
  old_stats?: Record<string, unknown>; new_stats?: Record<string, unknown>;
};

export type CircuitVersion = {
  version_id: string; circuit_family: string; version_num: number;
  parent_version_id: string | null; diff_stats: DiffStats | Record<string, unknown>;
  commit_message: string | null; tags: string[]; project_slug: string | null;
  run_ids: string[]; created_at: string; content_hash: string;
  qasm?: string; semantic_version?: string;
};

export type CircuitFamily = {
  circuit_family: string; head_version: CircuitVersion;
  version_count: number; project_slug: string | null;
};

export type CircuitDiff = {
  v1: CircuitVersion; v2: CircuitVersion;
  diff_stats: DiffStats; text_diff: string; is_identical: boolean;
};

export async function createCircuitVersion(req: {
  circuit_family: string; qasm: string;
  commit_message?: string; tags?: string[]; project_slug?: string; run_ids?: string[];
}): Promise<CircuitVersion & { created: boolean }> {
  const res = await fetch(apiUrl("/api/v1/circuits/versions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listCircuitVersions(params?: { family?: string; project?: string; tag?: string; limit?: number }): Promise<CircuitVersion[]> {
  const qs = new URLSearchParams();
  if (params?.family) qs.set("family", params.family);
  if (params?.project) qs.set("project", params.project);
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetch(apiUrl(`/api/v1/circuits/versions?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Circuit versions failed");
  return res.json();
}

export async function listCircuitFamilies(): Promise<CircuitFamily[]> {
  const res = await fetch(apiUrl("/api/v1/circuits/versions/families"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Circuit families failed");
  return res.json();
}

export async function getCircuitVersion(versionId: string): Promise<CircuitVersion> {
  const res = await fetch(apiUrl(`/api/v1/circuits/versions/${versionId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Circuit version not found");
  return res.json();
}

export async function diffCircuitVersions(v1Id: string, v2Id: string): Promise<CircuitDiff> {
  const res = await fetch(apiUrl(`/api/v1/circuits/versions/${v1Id}/diff/${v2Id}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Diff failed");
  return res.json();
}

export async function getCircuitVersionHistory(versionId: string): Promise<{ version_id: string; history: CircuitVersion[] }> {
  const res = await fetch(apiUrl(`/api/v1/circuits/versions/${versionId}/history`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("History failed");
  return res.json();
}

// ------------------------------------------------------------------
// Error Mitigation (ZNE / PEC / M3)
// ------------------------------------------------------------------

export type ZNERunResult = {
  run_id: string; backend: string;
  zne: { method: string; noise_scale_factors: number[]; scaled_values: number[]; raw_value: number; mitigated_value: number; ci_95: number; ci_low: number; ci_high: number; sampling_overhead: number; improvement: number };
  noise_params: Record<string, number>; computed_at: string;
};

export type M3Result = {
  run_id: string; backend: string; n_qubits: number; readout_error_rate: number;
  raw_counts: Record<string, number>; mitigated_probs: Record<string, number>;
  raw_success_probability: number; mitigated_success_probability: number;
  improvement: number; method: string; computed_at: string;
};

export type PECResult = {
  run_id: string; backend: string;
  pec: { method: string; raw_value: number; mitigated_value: number; sampling_overhead_gamma: number; statistical_uncertainty: number; ci_low: number; ci_high: number; improvement: number };
  noise_params: Record<string, number>; computed_at: string;
};

export async function applyZNE(runId: string): Promise<ZNERunResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/zne`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("ZNE failed");
  return res.json();
}

export async function applyM3(runId: string): Promise<M3Result> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/m3`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("M3 failed");
  return res.json();
}

export async function applyPEC(runId: string): Promise<PECResult> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/pec`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("PEC failed");
  return res.json();
}

// ------------------------------------------------------------------
// Credential Manager
// ------------------------------------------------------------------

export type ApiCredential = {
  cred_id: string; provider: string; label: string; key_hint: string;
  is_active: boolean; last_used_at: string | null;
  expires_at: string | null; created_at: string;
};

export type CredentialTestResult = {
  cred_id: string; provider: string; status: "valid" | "invalid" | "error" | "untestable";
  http_status?: number; note?: string; error?: string;
};

export async function listCredentials(provider?: string): Promise<ApiCredential[]> {
  const qs = provider ? `?provider=${provider}` : "";
  const res = await fetch(apiUrl(`/api/v1/credentials${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Credentials failed");
  return res.json();
}

export async function createCredential(req: { provider: string; label: string; api_key: string; expires_at?: string }): Promise<ApiCredential> {
  const res = await fetch(apiUrl("/api/v1/credentials"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteCredential(credId: string): Promise<void> {
  await fetch(apiUrl(`/api/v1/credentials/${credId}`), { method: "DELETE", headers: authHeaders() });
}

export async function testCredential(credId: string): Promise<CredentialTestResult> {
  const res = await fetch(apiUrl(`/api/v1/credentials/${credId}/test`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateCredential(credId: string, req: { label?: string; api_key?: string; is_active?: boolean }): Promise<ApiCredential> {
  const res = await fetch(apiUrl(`/api/v1/credentials/${credId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Notification System
// ------------------------------------------------------------------

export type NotificationChannel = {
  channel_id: string; name: string; channel_type: string;
  config: Record<string, string>; events: string[];
  is_active: boolean; last_triggered_at: string | null; created_at: string;
};

export type NotificationLog = {
  id: number; channel_id: string; event: string;
  status: string; error: string | null; sent_at: string;
};

export async function listNotificationChannels(): Promise<NotificationChannel[]> {
  const res = await fetch(apiUrl("/api/v1/notifications/channels"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Channels failed");
  return res.json();
}

export async function createNotificationChannel(req: {
  name: string; channel_type: string;
  config: Record<string, string>; events?: string[];
}): Promise<NotificationChannel> {
  const res = await fetch(apiUrl("/api/v1/notifications/channels"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateNotificationChannel(channelId: string, req: {
  name?: string; config?: Record<string, string>; events?: string[]; is_active?: boolean;
}): Promise<NotificationChannel> {
  const res = await fetch(apiUrl(`/api/v1/notifications/channels/${channelId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteNotificationChannel(channelId: string): Promise<void> {
  await fetch(apiUrl(`/api/v1/notifications/channels/${channelId}`), { method: "DELETE", headers: authHeaders() });
}

export async function testNotificationChannel(channelId: string, message?: string): Promise<{ status: string; error: string | null }> {
  const res = await fetch(apiUrl(`/api/v1/notifications/channels/${channelId}/test`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ event: "test.ping", message: message ?? "Test from Q-Lab" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getNotificationLogs(channelId?: string): Promise<NotificationLog[]> {
  const qs = channelId ? `?channel_id=${channelId}` : "";
  const res = await fetch(apiUrl(`/api/v1/notifications/logs${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Logs failed");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Volume Runner
// ------------------------------------------------------------------

export type QVTrialResult = { m: number; qv: number; mean_hop: number; ci_low: number; std: number; passed: boolean };

export type QVResult = {
  qv_id: string; backend: string; qv_achieved: number; log2_qv: number;
  n_qubits_tested: number; n_trials: number;
  heavy_output_prob: number; pass_threshold: number; passed: boolean;
  trial_results: QVTrialResult[]; created_at: string;
};

export type QVTrend = {
  backend: string; current_qv: number | null; peak_qv: number | null;
  history: { date: string; qv: number; hop: number; qv_id: string }[];
};

export async function runQV(req: {
  backend: string; max_qubits?: number; n_trials?: number;
  shots?: number; noise_level?: number; seed?: number;
}): Promise<QVResult> {
  const res = await fetch(apiUrl("/api/v1/qv-runner"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQVResults(backend?: string): Promise<QVResult[]> {
  const qs = backend ? `?backend=${encodeURIComponent(backend)}` : "";
  const res = await fetch(apiUrl(`/api/v1/qv-runner${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("QV results failed");
  return res.json();
}

export async function getQVTrend(backend: string): Promise<QVTrend> {
  const res = await fetch(apiUrl(`/api/v1/qv-runner/trend/${encodeURIComponent(backend)}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("QV trend failed");
  return res.json();
}

// ------------------------------------------------------------------
// Gate Characterization
// ------------------------------------------------------------------

export type GateCharFit = { T1_us?: number; T2_us?: number; p?: number; EPC?: number; gate_fidelity?: number; r2?: number };

export type GateCharResult = {
  char_id: string; backend: string; char_type: string;
  qubit: number | null; qubit_pair: number[] | null; gate: string | null;
  curve_data: { x: number; y: number }[];
  fit_params: GateCharFit; metric_value: number | null; metric_unit: string | null;
  run_id: string | null; created_at: string;
};

export type GateCharSummary = { backend: string; qubits: GateCharResult[] };
export type GateCharTrend = { backend: string; char_type: string; qubit: number | null; series: { date: string; value: number | null; unit: string | null; char_id: string; qubit: number | null }[] };

export async function submitGateChar(req: {
  backend: string; char_type: string; qubit?: number; gate?: string;
  curve_data: { x: number; y: number }[]; n_qubits?: number; run_id?: string;
}): Promise<GateCharResult> {
  const res = await fetch(apiUrl("/api/v1/gate-char"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listGateCharResults(params?: { backend?: string; char_type?: string; qubit?: number }): Promise<GateCharResult[]> {
  const qs = new URLSearchParams();
  if (params?.backend) qs.set("backend", params.backend);
  if (params?.char_type) qs.set("char_type", params.char_type);
  if (params?.qubit != null) qs.set("qubit", String(params.qubit));
  const res = await fetch(apiUrl(`/api/v1/gate-char?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Gate char failed");
  return res.json();
}

export async function getGateCharSummary(backend: string): Promise<GateCharSummary> {
  const res = await fetch(apiUrl(`/api/v1/gate-char/summary/${encodeURIComponent(backend)}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Summary failed");
  return res.json();
}

export async function getGateCharTrend(backend: string, charType: string, qubit?: number): Promise<GateCharTrend> {
  const qs = qubit != null ? `?qubit=${qubit}` : "";
  const res = await fetch(apiUrl(`/api/v1/gate-char/trend/${encodeURIComponent(backend)}/${charType}${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Trend failed");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Template Library
// ------------------------------------------------------------------

export type CircuitTemplate = {
  template_id: string; name: string; category: string; description: string;
  n_qubits: number; parameters: string[]; tags: string[];
  is_builtin: boolean; use_count: number; created_at: string; qasm?: string;
};

export type TemplateCategory = { category: string; count: number };

export async function listTemplates(params?: { category?: string; tag?: string; q?: string; builtin_only?: boolean }): Promise<CircuitTemplate[]> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.q) qs.set("q", params.q);
  if (params?.builtin_only) qs.set("builtin_only", "true");
  const res = await fetch(apiUrl(`/api/v1/templates?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Templates failed");
  return res.json();
}

export async function getTemplate(templateId: string): Promise<CircuitTemplate> {
  const res = await fetch(apiUrl(`/api/v1/templates/${templateId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Template not found");
  return res.json();
}

export async function createTemplate(req: {
  name: string; category?: string; description?: string;
  qasm: string; n_qubits: number; tags?: string[];
}): Promise<CircuitTemplate> {
  const res = await fetch(apiUrl("/api/v1/templates"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTemplateCategories(): Promise<TemplateCategory[]> {
  const res = await fetch(apiUrl("/api/v1/templates/categories"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Categories failed");
  return res.json();
}

// ------------------------------------------------------------------
// Backend Queue Intelligence
// ------------------------------------------------------------------

export type BackendQueueStatus = {
  name: string; status: string; queue_length: number;
  operational: boolean; n_qubits: number; estimated_wait_minutes: number; provider: string;
};

export type QueueStatusResponse = {
  backends: BackendQueueStatus[]; source: string; fetched_at: string; recommendation: string | null;
};

export type QueueRecommendation = {
  recommended: string | null; queue_length: number; estimated_wait_minutes: number;
  n_qubits: number; reason: string; candidates: BackendQueueStatus[];
};

export async function getQueueStatus(): Promise<QueueStatusResponse> {
  const res = await fetch(apiUrl("/api/v1/queue/status"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Queue status failed");
  return res.json();
}

export async function getBackendQueueStatus(backend: string): Promise<{ backend: string; queue_info: BackendQueueStatus; our_analytics: Record<string, unknown>; best_submit_hour_utc: number; worst_submit_hour_utc: number }> {
  const res = await fetch(apiUrl(`/api/v1/queue/status/${encodeURIComponent(backend)}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Queue status failed");
  return res.json();
}

export async function recommendBackend(nQubits?: number, maxQueue?: number): Promise<QueueRecommendation> {
  const qs = new URLSearchParams();
  if (nQubits) qs.set("n_qubits", String(nQubits));
  if (maxQueue) qs.set("max_queue", String(maxQueue));
  const res = await fetch(apiUrl(`/api/v1/queue/recommend?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Recommend failed");
  return res.json();
}

// ------------------------------------------------------------------
// Decoherence Alerts
// ------------------------------------------------------------------

export type DecoherenceAlert = {
  alert_id: string; backend: string; metric: string; qubit: number | null;
  threshold: number; condition: string; triggered: boolean;
  last_value: number | null; triggered_at: string | null;
  last_checked_at: string | null; notification_channel_id: string | null; created_at: string;
};

export async function listDecoherenceAlerts(backend?: string): Promise<DecoherenceAlert[]> {
  const qs = backend ? `?backend=${encodeURIComponent(backend)}` : "";
  const res = await fetch(apiUrl(`/api/v1/decoherence-alerts${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Decoherence alerts failed");
  return res.json();
}

export async function createDecoherenceAlert(req: {
  backend: string; metric: string; threshold: number; condition?: string; qubit?: number;
}): Promise<DecoherenceAlert> {
  const res = await fetch(apiUrl("/api/v1/decoherence-alerts"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkAllDecoherenceAlerts(): Promise<{ checked: number; newly_triggered: number; alerts: DecoherenceAlert[] }> {
  const res = await fetch(apiUrl("/api/v1/decoherence-alerts/check"), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Check failed");
  return res.json();
}

export async function deleteDecoherenceAlert(alertId: string): Promise<void> {
  await fetch(apiUrl(`/api/v1/decoherence-alerts/${alertId}`), { method: "DELETE", headers: authHeaders() });
}

// ------------------------------------------------------------------
// Cross-Backend Comparison
// ------------------------------------------------------------------

export type BackendTarget = { provider: string; backend: string };

export type ComparisonJob = {
  job_id: string; backend: string; provider: string; status: string;
  shots: number; success_probability: number | null; cost_credits: number | null;
  counts: Record<string, number>; error_message: string | null;
  submitted_at: string | null; completed_at: string | null;
};

export type ComparisonResult = {
  comparison_id: string; n_backends: number;
  backends: ComparisonJob[];
  winner_by_fidelity: string | null; winner_by_cost: string | null;
  metrics_table: { backend: string; provider: string; success_probability: number | null; cost_credits: number | null; top_bitstring: string | null; status: string }[];
};

export async function createComparison(req: {
  qasm: string; targets: BackendTarget[]; shots?: number; circuit_name?: string;
}): Promise<{ comparison_id: string; n_backends: number; jobs: { job_id: string; backend: string }[] }> {
  const res = await fetch(apiUrl("/api/v1/cross-backend"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getComparison(comparisonId: string): Promise<ComparisonResult> {
  const res = await fetch(apiUrl(`/api/v1/cross-backend/${comparisonId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Comparison not found");
  return res.json();
}

export async function listComparisons(): Promise<{ comparison_id: string; n_backends: number; submitted_at: string | null; circuit_name: string | null }[]> {
  const res = await fetch(apiUrl("/api/v1/cross-backend"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Comparisons failed");
  return res.json();
}

// ------------------------------------------------------------------
// Genetic Circuit Evolution Engine
// ------------------------------------------------------------------

export type FitnessPoint = { generation: number; best: number; avg: number };
export type EvolutionRun = {
  run_id: string; circuit_name: string;
  original_qasm: string; evolved_qasm: string;
  best_fitness: number; improvement: number;
  n_generations: number; population_size: number;
  n_gates_original: number; n_gates_evolved: number;
  fitness_history: FitnessPoint[];
  config: Record<string, unknown>;
  created_at: string;
};

export async function evolveCircuit(req: {
  qasm: string; circuit_name?: string;
  population_size?: number; n_generations?: number;
  shots?: number; mutation_rate?: number;
  target_bitstring?: string; seed?: number;
}): Promise<EvolutionRun> {
  const res = await fetch(apiUrl("/api/v1/evolver"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listEvolutions(): Promise<EvolutionRun[]> {
  const res = await fetch(apiUrl("/api/v1/evolver"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Evolutions failed");
  return res.json();
}

export async function getEvolution(runId: string): Promise<EvolutionRun> {
  const res = await fetch(apiUrl(`/api/v1/evolver/${runId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

// ------------------------------------------------------------------
// Predictive Hardware Health Oracle
// ------------------------------------------------------------------

export type ForecastSeries = { hours_offset: number; value: number; timestamp: string };
export type HealthMetricForecast = {
  forecast_id?: string; backend: string; metric: string;
  data_points: number; current_value: number | null;
  forecast_24h: number | null; forecast_48h: number | null; forecast_72h: number | null;
  trend_slope: number | null; trend_direction?: string;
  risk_level: string; r2: number | null; series: ForecastSeries[];
};
export type HealthForecastResponse = { backend: string; overall_risk: string; forecasts: HealthMetricForecast[] };

export async function createHealthForecast(req: { backend: string; metrics?: string[]; days?: number }): Promise<HealthForecastResponse> {
  const res = await fetch(apiUrl("/api/v1/health-forecast"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHealthForecast(backend: string, metric?: string, days?: number): Promise<HealthMetricForecast> {
  const qs = new URLSearchParams();
  if (metric) qs.set("metric", metric);
  if (days) qs.set("days", String(days));
  const res = await fetch(apiUrl(`/api/v1/health-forecast/${encodeURIComponent(backend)}?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Forecast failed");
  return res.json();
}

export async function listHealthForecasts(): Promise<HealthMetricForecast[]> {
  const res = await fetch(apiUrl("/api/v1/health-forecast"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Forecasts failed");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Advantage Detector
// ------------------------------------------------------------------

export type AdvantageDetectorResult = {
  result_id: string; problem_type: string; n_qubits: number;
  quantum_score: number; classical_score: number;
  advantage_ratio: number; quantum_time_ms: number; classical_time_ms: number;
  verdict: "quantum_wins" | "classical_wins" | "tie";
  details: Record<string, unknown>; created_at: string;
};

export type AdvantageSweepPoint = {
  n_qubits: number; advantage_ratio: number; verdict: string;
  quantum_score: number; classical_score: number;
};

export async function detectAdvantage(req: { problem_type?: string; n_qubits?: number; seed?: number }): Promise<AdvantageDetectorResult> {
  const res = await fetch(apiUrl("/api/v1/advantage"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listAdvantageResults(problemType?: string): Promise<AdvantageDetectorResult[]> {
  const qs = problemType ? `?problem_type=${problemType}` : "";
  const res = await fetch(apiUrl(`/api/v1/advantage${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Advantage results failed");
  return res.json();
}

export async function sweepAdvantage(problemType: string, maxQubits?: number): Promise<{ problem_type: string; sweep: AdvantageSweepPoint[] }> {
  const qs = maxQubits ? `?max_qubits=${maxQubits}` : "";
  const res = await fetch(apiUrl(`/api/v1/advantage/sweep/${problemType}${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Sweep failed");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Intelligence Analyzer
// ------------------------------------------------------------------

export type QubitRisk = {
  qubit: number; total_gate_time_ns: number; accumulated_gate_error: number;
  t1_decay_probability: number; estimated_qubit_error: number; risk_level: string;
};

export type CircuitAnalysis = {
  circuit_name: string; n_qubits: number; total_gates: number; circuit_depth: number;
  clifford_gates: number; non_clifford_gates: number; non_clifford_ratio: number;
  t_gate_count: number; multi_qubit_gates: number; circuit_volume: number;
  quality_score: number; avg_qubit_error: number; total_gate_time_ns: number;
  gate_counts: Record<string, number>;
  per_qubit_risk: QubitRisk[];
  optimization_suggestions: string[];
  resource_estimate: { estimated_execution_time_us: number; circuit_volume: number; magic_state_cost: number; two_qubit_gate_fraction: number };
};

export async function analyzeCircuit(qasm: string, circuitName?: string): Promise<CircuitAnalysis> {
  const res = await fetch(apiUrl("/api/v1/analyze"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ qasm, circuit_name: circuitName ?? "" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Chaos / Fault Injection
// ------------------------------------------------------------------

export type FaultResult = {
  result_id: string; circuit_name: string;
  fault_type: string; fault_rate: number; n_trials: number;
  mean_fidelity: number; min_fidelity: number; mean_tvd: number;
  resilience_score: number; grade: string; interpretation: string;
  trial_tvds: number[]; trial_fidelities: number[];
  created_at: string;
};

export type FaultSweepPoint = { fault_rate: number; resilience_score: number; mean_fidelity: number };

export async function injectFaults(req: {
  qasm: string; circuit_name?: string; fault_type?: string; fault_rate?: number;
  n_trials?: number; shots?: number; seed?: number;
}): Promise<FaultResult> {
  const res = await fetch(apiUrl("/api/v1/chaos"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function faultSweep(qasm: string, faultType?: string): Promise<{ fault_type: string; curve: FaultSweepPoint[] }> {
  const res = await fetch(apiUrl("/api/v1/chaos/sweep"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ qasm, fault_type: faultType ?? "depolarizing" }),
  });
  if (!res.ok) throw new Error("Sweep failed");
  return res.json();
}

export async function listFaultResults(): Promise<FaultResult[]> {
  const res = await fetch(apiUrl("/api/v1/chaos"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Fault results failed");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum-Certified RNG
// ------------------------------------------------------------------

export type RandomnessTestResult = { pass: boolean; [key: string]: unknown };
export type QRNGGenResult = {
  result_id: string; n_bits: number; hex_output: string;
  first_32_bits: string; chsh_value: number;
  classical_bound: number; quantum_bound: number;
  is_quantum_certified: boolean; certification_message: string;
  randomness_tests: { frequency_test: RandomnessTestResult; runs_test: RandomnessTestResult; block_frequency_test: RandomnessTestResult; overall_pass: boolean };
  created_at: string;
};

export async function generateQRNG(req: { n_bits?: number; n_chsh_shots?: number; seed?: number }): Promise<QRNGGenResult> {
  const res = await fetch(apiUrl("/api/v1/qrng"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQRNGResults(): Promise<{ result_id: string; n_bits: number; chsh_value: number; is_quantum_certified: boolean; created_at: string }[]> {
  const res = await fetch(apiUrl("/api/v1/qrng"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("QRNG results failed");
  return res.json();
}

// ------------------------------------------------------------------
// Reproducibility Engine
// ------------------------------------------------------------------

export type ReproResult = {
  result_id: string; original_run_id: string; n_reruns: number;
  mean_tvd: number; std_tvd: number; reproducibility_score: number;
  grade: string; trial_tvds: number[]; interpretation: string;
  backend: string; shots: number; created_at: string;
};

export async function checkReproducibility(req: { run_id: string; n_reruns?: number; shots?: number }): Promise<ReproResult> {
  const res = await fetch(apiUrl("/api/v1/reproducibility"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listReproducibilityResults(): Promise<ReproResult[]> {
  const res = await fetch(apiUrl("/api/v1/reproducibility"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Reproducibility results failed");
  return res.json();
}

// ------------------------------------------------------------------
// Cross-Provider Transpiler
// ------------------------------------------------------------------

export type TranspileProviderResult = {
  provider: string; native_gate_set: string; transpiled_qasm: string;
  original_gate_count: number; transpiled_gate_count: number; overhead_ratio: number; n_qubits: number;
};

export async function transpileCircuit(req: { qasm: string; providers?: string[] }): Promise<{ original_qasm: string; results: Record<string, TranspileProviderResult> }> {
  const res = await fetch(apiUrl("/api/v1/transpile"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Experiment Recommender
// ------------------------------------------------------------------

export type Suggestion = {
  type: string; reason: string;
  template?: { template_id: string; name: string; category?: string; n_qubits?: number };
  template_id?: string; name?: string;
  suggested_backend?: string; reference_backend?: string;
};

export type RecommendationResponse = {
  context: { recent_runs_analyzed: number; focus_run_id: string | null; backends_seen: string[] };
  by_popularity: Suggestion[]; by_progression: Suggestion[];
  by_backend_diversity: Suggestion[]; by_parameter_scaling: Suggestion[];
  all_suggestions: Suggestion[];
};

export async function getRecommendations(runId?: string, limit?: number): Promise<RecommendationResponse> {
  const qs = new URLSearchParams();
  if (runId) qs.set("run_id", runId);
  if (limit) qs.set("limit", String(limit));
  const res = await fetch(apiUrl(`/api/v1/recommend?${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Recommendations failed");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit DNA Fingerprinting
// ------------------------------------------------------------------

export type DNASignaturePoint = { bitstring: string; probability: number };
export type CircuitDNAResult = {
  dna_id: string; dna_hash: string; circuit_name: string;
  n_qubits: number; n_gates: number;
  distribution_signature: DNASignaturePoint[];
  total_shots_used: number; is_unique: boolean;
  functionally_equivalent: { dna_id: string; circuit_name: string; n_gates: number; created_at: string }[];
  created_at: string;
};

export type DNACompareResult = {
  circuits: { circuit_name: string; dna_hash: string; signature: DNASignaturePoint[] }[];
  equivalent_groups: { dna_hash: string; circuits: string[] }[];
  all_unique: boolean; summary: string;
};

export async function fingerprintCircuit(req: { qasm: string; circuit_name?: string; run_id?: string; seed?: number }): Promise<CircuitDNAResult> {
  const res = await fetch(apiUrl("/api/v1/dna"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function compareCircuitDNA(circuits: { qasm: string; circuit_name?: string; seed?: number }[]): Promise<DNACompareResult> {
  const res = await fetch(apiUrl("/api/v1/dna/compare"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(circuits),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listDNA(): Promise<{ dna_id: string; dna_hash: string; circuit_name: string; n_qubits: number; n_gates: number; created_at: string }[]> {
  const res = await fetch(apiUrl("/api/v1/dna"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("DNA list failed");
  return res.json();
}

// ------------------------------------------------------------------
// State Tomography
// ------------------------------------------------------------------

export type BlochVector = { qubit: number; x: number; y: number; z: number; purity: number };
export type DensityMatrix = { re: number[][]; im: number[][] };
export type TomoResult = {
  tomo_id: string;
  n_qubits: number;
  shots_per_basis: number;
  total_shots: number;
  bloch_vectors: BlochVector[];
  density_matrix: DensityMatrix;
  purity: number;
  von_neumann_entropy: number;
  is_pure: boolean;
  is_mixed: boolean;
  pauli_expectations: Record<string, number>;
  fidelity_to_target: number | null;
  target_state: string | null;
  created_at: string;
};

export async function analyzeStateTomography(req: { qasm: string; n_qubits?: number; target_state?: string; shots?: number; seed?: number }): Promise<TomoResult> {
  const res = await fetch(apiUrl("/api/v1/tomography"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// QEC Auto-Synthesizer
// ------------------------------------------------------------------

export type QECCode = { id: string; name: string; physical_per_logical: number; distance: number; corrects_errors: number; syndrome_qubits: number; description: string };
export type QECResult = {
  qec_id: string;
  code_name: string;
  code_id: string;
  description: string;
  n_logical_qubits: number;
  n_physical_qubits: number;
  n_syndrome_qubits: number;
  n_total_qubits: number;
  code_distance: number;
  corrects_n_errors: number;
  overhead_factor: number;
  n_logical_gates: number;
  estimated_physical_gates: number;
  physical_error_rate: number;
  estimated_logical_error_rate: number;
  error_suppression_factor: number;
  syndrome_rounds_per_gate: number;
  encoded_qasm: string;
  created_at: string;
};

export async function synthesizeQEC(req: { logical_qasm: string; code?: string; physical_error_rate?: number }): Promise<QECResult> {
  const res = await fetch(apiUrl("/api/v1/qec"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQECCodes(): Promise<QECCode[]> {
  const res = await fetch(apiUrl("/api/v1/qec/codes"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("QEC codes failed");
  return res.json();
}

// ------------------------------------------------------------------
// VQE Landscape Explorer
// ------------------------------------------------------------------

export type LandscapePoint = { theta1: number; theta2: number; energy: number };
export type VQELandscapeResult = {
  landscape_id: string;
  hamiltonian: string;
  n_qubits: number;
  grid_size: number;
  grid: LandscapePoint[][];
  min_energy: number;
  max_energy: number;
  energy_range: number;
  optimal_theta1: number;
  optimal_theta2: number;
  has_barren_plateau: boolean;
  landscape_roughness: number;
  gradient_variance: number;
  recommendations: string[];
  created_at: string;
};

export async function exploreLandscape(req: { qasm?: string; hamiltonian?: string; n_qubits?: number; param1_range?: number[]; param2_range?: number[]; grid_size?: number; seed?: number }): Promise<VQELandscapeResult> {
  const res = await fetch(apiUrl("/api/v1/landscape-explorer"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Entanglement Topology Animator
// ------------------------------------------------------------------

export type QubitEntanglement = { qubit: number; entropy: number; is_entangled: boolean; n_entangled_partners: number };
export type EntanglementLayer = {
  depth: number;
  gates: string[];
  qubit_entanglement: QubitEntanglement[];
  total_entropy: number;
  entangled_pairs: { q1: number; q2: number }[];
};
export type EntanglementMapResult = {
  map_id: string;
  n_qubits: number;
  n_layers: number;
  n_layers_displayed: number;
  layers: EntanglementLayer[];
  max_entropy_observed: number;
  max_possible_entropy: number;
  entanglement_fraction: number;
  final_entangled_pairs: { q1: number; q2: number }[];
  n_entangled_pairs: number;
  is_fully_entangled: boolean;
  created_at: string;
};

export async function mapEntanglement(req: { qasm: string; n_qubits?: number; seed?: number }): Promise<EntanglementMapResult> {
  const res = await fetch(apiUrl("/api/v1/entanglement-map"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Clifford + T Resource Counter
// ------------------------------------------------------------------

export type GateClassification = { gate: string; type: string; t_count: number; clifford: boolean };
export type CliffordTResult = {
  resource_id: string;
  total_gates: number;
  t_count: number;
  clifford_count: number;
  non_clifford_gate_types: string[];
  t_gate_ratio: number;
  is_clifford_only: boolean;
  estimated_magic_states: number;
  distillation_overhead_gates: number;
  recommended_code_distance: number;
  total_physical_gates_ftqc: number;
  gate_type_counts: { T_gates: number; Clifford_1Q: number; Clifford_2Q: number; Non_Clifford: number };
  gate_breakdown: GateClassification[];
  recommendations: string[];
  created_at: string;
};

export async function analyzeCliffordT(req: { qasm: string }): Promise<CliffordTResult> {
  const res = await fetch(apiUrl("/api/v1/clifford-t"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Multi-Backend Ensemble Runner
// ------------------------------------------------------------------

export type EnsembleProviderResult = {
  provider_id: string;
  provider_name: string;
  color: string;
  noise_level: number;
  fidelity_weight: number;
  distribution: Record<string, number>;
  top_bitstring: string;
  top_prob: number;
  entropy: number;
  tvd_to_ideal: number;
  estimated_fidelity: number;
};
export type EnsembleResult = {
  ensemble_id: string;
  n_providers: number;
  shots_per_provider: number;
  individual_results: EnsembleProviderResult[];
  consensus_distribution: Record<string, number>;
  consensus_top_bitstring: string;
  consensus_entropy: number;
  agreement_score: number;
  best_provider: string;
  best_provider_name: string;
  created_at: string;
};

export async function runEnsemble(req: { qasm: string; providers?: string[]; shots?: number; seed?: number }): Promise<EnsembleResult> {
  const res = await fetch(apiUrl("/api/v1/ensemble"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listEnsembleProviders(): Promise<{ id: string; name: string; noise_level: number; weight: number; color: string }[]> {
  const res = await fetch(apiUrl("/api/v1/ensemble/providers"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Providers failed");
  return res.json();
}

// ------------------------------------------------------------------
// Circuit Semantic Search
// ------------------------------------------------------------------

export type CircuitEmbedEntry = { embed_id: string; circuit_name: string; description: string; created_at: string };
export type CircuitSearchResult = {
  embed_id: string;
  circuit_name: string;
  tags: string[];
  run_id: string | null;
  similarity: number;
  description: string;
  created_at: string;
};
export type CircuitSearchResponse = {
  query_description: string;
  embedding_dim: number;
  total_indexed: number;
  results: CircuitSearchResult[];
  n_results: number;
};

export async function indexCircuit(req: { qasm: string; circuit_name?: string; tags?: string[]; run_id?: string }): Promise<{ embed_id: string; description: string; embedding_dim: number }> {
  const res = await fetch(apiUrl("/api/v1/circuit-embed/index"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function searchCircuits(req: { query_qasm: string; top_k?: number; min_similarity?: number }): Promise<CircuitSearchResponse> {
  const res = await fetch(apiUrl("/api/v1/circuit-embed/search"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listIndexedCircuits(): Promise<CircuitEmbedEntry[]> {
  const res = await fetch(apiUrl("/api/v1/circuit-embed/index"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Index list failed");
  return res.json();
}

// ------------------------------------------------------------------
// Noise-Aware Qubit Router
// ------------------------------------------------------------------

export type QubitRouteAnalysis = {
  logical_qubit: number;
  original_physical: number;
  optimized_physical: number;
  original_t1_us: number;
  optimized_t1_us: number;
  original_gate_error: number;
  optimized_gate_error: number;
  improved: boolean;
};
export type NoiseRouterResult = {
  route_id: string;
  backend: string;
  n_logical_qubits: number;
  n_physical_qubits: number;
  n_coupling_gates: number;
  original_assignment: Record<string, number>;
  optimized_assignment: Record<string, number>;
  assignment_changed: boolean;
  expected_error_reduction: number;
  expected_fidelity_gain: number;
  qubit_analysis: QubitRouteAnalysis[];
  optimized_qasm: string;
  backend_coupling_map: number[][];
  created_at: string;
};

export async function routeCircuit(req: { qasm: string; backend?: string }): Promise<NoiseRouterResult> {
  const res = await fetch(apiUrl("/api/v1/noise-router"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listRouterBackends(): Promise<{ id: string; n_qubits: number; coupling_pairs: number }[]> {
  const res = await fetch(apiUrl("/api/v1/noise-router/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Backends failed");
  return res.json();
}

// ------------------------------------------------------------------
// Natural Language → QASM Compiler
// ------------------------------------------------------------------

export type NL2QASMSuggestion = { name: string; try_saying: string };
export type NL2QASMResult = {
  compile_id: string;
  input_description: string;
  circuit_name: string;
  qasm: string;
  n_qubits: number;
  n_gates: number;
  confidence: number;
  explanation: string;
  is_exact_match: boolean;
  suggestions: NL2QASMSuggestion[];
  created_at: string;
};

export async function compileNL(req: { description: string; n_qubits_hint?: number }): Promise<NL2QASMResult> {
  const res = await fetch(apiUrl("/api/v1/nl2qasm"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listNL2QASMExamples(): Promise<{ name: string; pattern_hint: string; n_qubits: number }[]> {
  const res = await fetch(apiUrl("/api/v1/nl2qasm/examples"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Examples failed");
  return res.json();
}

// ------------------------------------------------------------------
// Quantum Volume Benchmarker
// ------------------------------------------------------------------

export type QVWidthResult = {
  n_qubits: number;
  mean_heavy_output_prob: number;
  pass_rate: number;
  pass_count: number;
  sigma_bound: number;
  certified: boolean;
  qv_at_width: number;
  trials: { trial: number; hop: number; pass: boolean }[];
};
export type QVBenchResult = {
  bench_id: string;
  backend_name: string;
  noise_profile: string;
  noise_level: number;
  n_trials_per_width: number;
  quantum_volume: number;
  qv_log2: number;
  certification_message: string;
  per_width_results: QVWidthResult[];
  pass_threshold: number;
  created_at: string;
};

export async function runQVBench(req: { max_qubits?: number; n_trials?: number; noise_profile?: string; backend_name?: string; seed?: number }): Promise<QVBenchResult> {
  const res = await fetch(apiUrl("/api/v1/qvbench"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQVNoiseProfiles(): Promise<{ id: string; noise_level: number }[]> {
  const res = await fetch(apiUrl("/api/v1/qvbench/noise-profiles"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Profiles failed");
  return res.json();
}

// ------------------------------------------------------------------
// 1. Error Mitigation Engine
// ------------------------------------------------------------------

export type ZNEMitigateResult = {
  noise_scale_factors: number[];
  noisy_expectations: number[];
  extrapolated_linear: number;
  extrapolated_richardson: number;
  best_extrapolation: string;
  best_value: number;
  improvement_pct: number;
};
export type PECMitigateResult = {
  quasi_probability_overhead: number;
  n_circuits_sampled: number;
  mitigated_expectation: number;
  variance_estimate: number;
  improvement_pct: number;
};
export type CDRResult = {
  n_training_circuits: number;
  linear_regression_slope: number;
  linear_regression_intercept: number;
  corrected_expectation: number;
  r_squared: number;
  improvement_pct: number;
};
export type ErrorMitigateResult = {
  mitigation_id: string;
  qasm_hash: string;
  n_qubits: number;
  n_gates: number;
  method_used: string;
  raw_expectation: number;
  zne_result: ZNEMitigateResult;
  pec_result: PECMitigateResult;
  cdr_result: CDRResult;
  best_method: string;
  best_mitigated_expectation: number;
  overall_improvement_pct: number;
  created_at: string;
};

export async function runErrorMitigate(req: { qasm: string; method?: string; noise_level?: number; n_zne_samples?: number }): Promise<ErrorMitigateResult> {
  const res = await fetch(apiUrl("/api/v1/error-mitigate"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listMitigationMethods(): Promise<{ id: string; name: string; description: string }[]> {
  const res = await fetch(apiUrl("/api/v1/error-mitigate/methods"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Methods failed");
  return res.json();
}

// ------------------------------------------------------------------
// 2. Circuit Synthesis from Unitary
// ------------------------------------------------------------------

export type GateStep = { gate: string; qubits: number[]; params?: number[] };
export type UnitarySynthResult = {
  synth_id: string;
  n_qubits: number;
  matrix_size: number;
  determinant_magnitude: number;
  is_unitary: boolean;
  is_special_unitary: boolean;
  gate_sequence: GateStep[];
  circuit_depth: number;
  n_gates: number;
  n_cx_gates: number;
  n_single_qubit_gates: number;
  qasm_output: string;
  synthesis_method: string;
  fidelity_to_target: number;
  t_count: number;
  basis_gates_used: string[];
  optimized: boolean;
  created_at: string;
};

export async function synthesizeUnitary(req: { matrix: number[][]; optimize?: boolean; basis_gates?: string[] }): Promise<UnitarySynthResult> {
  const res = await fetch(apiUrl("/api/v1/unitary-synth"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// 3. Randomized Benchmarking Suite
// ------------------------------------------------------------------

export type RBSuiteResult = {
  rb_id: string;
  backend: string;
  rb_type: string;
  qubit: number;
  n_qubits: number;
  sequence_lengths: number[];
  survival_probabilities: number[];
  fit_A: number;
  fit_B: number;
  fit_p: number;
  error_per_clifford: number;
  average_gate_fidelity: number;
  gate_fidelity_1q: number;
  interleaved_gate: string | null;
  interleaved_epc: number | null;
  gate_specific_fidelity: number | null;
  decay_curve: { m: number; survival: number; fit: number }[];
  quality_grade: string;
  recommendations: string[];
  created_at: string;
};

export async function runRBSuite(req: { rb_type?: string; backend?: string; qubit?: number; n_qubits?: number; sequence_lengths?: number[]; n_seeds?: number; interleaved_gate?: string }): Promise<RBSuiteResult> {
  const res = await fetch(apiUrl("/api/v1/rb-suite"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listRBBackends(): Promise<{ id: string; n_qubits: number; gate_error: number }[]> {
  const res = await fetch(apiUrl("/api/v1/rb-suite/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Backends failed");
  return res.json();
}

// ------------------------------------------------------------------
// 4. VQE Optimizer Hub
// ------------------------------------------------------------------

export type OptimizerRunResult = {
  optimizer: string;
  final_energy: number;
  n_iterations: number;
  n_function_evals: number;
  convergence_curve: number[];
  converged: boolean;
  time_ms: number;
  final_params: number[];
  energy_gap_from_true_min: number;
  improvement_pct: number;
};
export type OptimizerHubResult = {
  hub_id: string;
  hamiltonian: string;
  n_qubits: number;
  true_minimum: number;
  results: OptimizerRunResult[];
  best_optimizer: string;
  best_energy: number;
  winner_summary: string;
  created_at: string;
};

export async function runOptimizerHub(req: { hamiltonian?: string; n_qubits?: number; optimizers?: string[]; n_layers?: number; max_iter?: number }): Promise<OptimizerHubResult> {
  const res = await fetch(apiUrl("/api/v1/optimizer-hub"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listOptimizerHamiltonians(): Promise<{ id: string; display: string; n_qubits: number }[]> {
  const res = await fetch(apiUrl("/api/v1/optimizer-hub/hamiltonians"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Hamiltonians failed");
  return res.json();
}

// ------------------------------------------------------------------
// 5. Quantum Chemistry Module
// ------------------------------------------------------------------

export type BondCurvePoint = { bond_length: number; energy: number };
export type QuantumChemResult = {
  chem_id: string;
  molecule: string;
  formula: string;
  basis: string;
  n_electrons: number;
  n_qubits: number;
  bond_length_angstrom: number;
  equilibrium_bond_length: number;
  fci_energy_hartree: number;
  vqe_energy_hartree: number;
  energy_error_hartree: number;
  chemical_accuracy_achieved: boolean;
  correlation_energy_hartree: number;
  correlation_energy_pct: number;
  n_pauli_terms: number;
  n_cnot_gates: number;
  circuit_depth: number;
  bond_curve: BondCurvePoint[];
  homo_lumo_gap: number;
  point_group: string;
  created_at: string;
};

export async function runQuantumChem(req: { molecule?: string; bond_length?: number; basis?: string }): Promise<QuantumChemResult> {
  const res = await fetch(apiUrl("/api/v1/quantum-chem"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listChemMolecules(): Promise<{ id: string; formula: string; n_electrons: number; n_qubits: number }[]> {
  const res = await fetch(apiUrl("/api/v1/quantum-chem/molecules"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Molecules failed");
  return res.json();
}

// ------------------------------------------------------------------
// 6. Clifford Stabilizer Simulator
// ------------------------------------------------------------------

export type CliffordSimResult = {
  sim_id: string;
  n_qubits: number;
  n_gates_clifford: number;
  n_gates_non_clifford: number;
  is_clifford_circuit: boolean;
  is_classically_simulable: boolean;
  stabilizer_generators: string[];
  tableau_snapshot: string[][];
  magic_state_count: number;
  magic_state_positions: number[];
  pauli_expectation_z0: number;
  pauli_expectation_z1: number;
  simulation_time_us: number;
  max_simulable_qubits: number;
  created_at: string;
};

export async function runCliffordSim(req: { qasm: string }): Promise<CliffordSimResult> {
  const res = await fetch(apiUrl("/api/v1/clifford-sim"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// 7. QEC Syndrome Decoder
// ------------------------------------------------------------------

export type SyndromeDecoderResult = {
  decode_id: string;
  code_name: string;
  code_distance: number;
  n_data_qubits: number;
  n_syndrome_qubits: number;
  error_rate: number;
  decoder_used: string;
  n_rounds: number;
  syndrome_pattern: number[];
  n_triggered_syndromes: number;
  correction_operator: string;
  logical_error_occurred: boolean;
  logical_error_rate_estimate: number;
  decoder_success_rate: number;
  error_locations: number[];
  threshold_estimate: number;
  below_threshold: boolean;
  created_at: string;
};

export async function decodeSyndrome(req: { code?: string; error_rate?: number; decoder?: string; n_rounds?: number; seed?: number }): Promise<SyndromeDecoderResult> {
  const res = await fetch(apiUrl("/api/v1/syndrome-decoder"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listSyndromeCodes(): Promise<{ id: string; name: string; distance: number; n_data_qubits: number }[]> {
  const res = await fetch(apiUrl("/api/v1/syndrome-decoder/codes"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Codes failed");
  return res.json();
}

// ------------------------------------------------------------------
// 8. Tensor Network Visualizer
// ------------------------------------------------------------------

export type TensorNetworkResult = {
  tn_id: string;
  n_qubits: number;
  n_tensors: number;
  max_bond_dim_actual: number;
  max_bond_dim_requested: number;
  bond_dimensions: number[];
  entanglement_entropies: number[];
  schmidt_coefficients: number[][];
  truncation_error: number;
  compression_ratio: number;
  memory_bytes_exact: number;
  memory_bytes_mps: number;
  memory_savings_pct: number;
  is_area_law: boolean;
  is_volume_law: boolean;
  decompose_method: string;
  network_diagram: string;
  created_at: string;
};

export async function analyzeTensorNetwork(req: { qasm: string; max_bond_dim?: number; method?: string }): Promise<TensorNetworkResult> {
  const res = await fetch(apiUrl("/api/v1/tensor-network"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// 9. Quantum Speedup Certifier
// ------------------------------------------------------------------

export type SpeedupCertResult = {
  cert_id: string;
  problem_type: string;
  n_qubits: number;
  circuit_depth: number;
  quantum_complexity_class: string;
  classical_complexity_class: string;
  quantum_gate_count: number;
  quantum_time_estimate_ms: number;
  classical_operations: number;
  classical_time_estimate_ms: number;
  classical_formula: string;
  speedup_ratio: number;
  speedup_log2: number;
  advantage_certified: boolean;
  confidence_level: string;
  crossover_n_qubits: number;
  current_best_classical_algorithm: string;
  caveats: string[];
  reference: string;
  created_at: string;
};

export async function certifySpeedup(req: { problem_type?: string; n_qubits?: number; circuit_depth?: number }): Promise<SpeedupCertResult> {
  const res = await fetch(apiUrl("/api/v1/speedup-certifier"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listSpeedupProblems(): Promise<{ id: string; name: string; quantum_class: string; classical_class: string }[]> {
  const res = await fetch(apiUrl("/api/v1/speedup-certifier/problems"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Problems failed");
  return res.json();
}

// ------------------------------------------------------------------
// 10. Complexity Analyzer
// ------------------------------------------------------------------

export type ComplexityFit = { complexity_class: string; r_squared: number; formula: string; a: number; b: number };
export type ComplexityResult = {
  analysis_id: string;
  param_name: string;
  metric_name: string;
  sizes_analyzed: number[];
  measured_values: number[];
  best_fit_class: string;
  best_fit_r_squared: number;
  fit_coefficients: number[];
  all_fits: ComplexityFit[];
  predicted_at_100: number;
  predicted_at_1000: number;
  scaling_plot_data: { n: number; measured: number; fit: number }[];
  is_polynomial: boolean;
  is_exponential: boolean;
  practical_limit_n: number;
  created_at: string;
};

export async function analyzeComplexity(req: { sizes: number[]; values: number[]; param_name?: string; metric_name?: string }): Promise<ComplexityResult> {
  const res = await fetch(apiUrl("/api/v1/complexity-analyzer"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// 11. QML Workbench
// ------------------------------------------------------------------

export type QMLTrainEpoch = { epoch: number; loss: number; accuracy: number };
export type QMLResult = {
  qml_id: string;
  task: string;
  dataset: string;
  encoding: string;
  n_qubits: number;
  n_layers: number;
  optimizer: string;
  n_parameters: number;
  n_training_samples: number;
  n_test_samples: number;
  training_history: QMLTrainEpoch[];
  final_train_loss: number;
  final_train_accuracy: number;
  final_test_loss: number;
  final_test_accuracy: number;
  kernel_matrix: number[][] | null;
  n_cx_gates_per_eval: number;
  circuit_depth: number;
  quantum_vs_classical_accuracy_gap: number;
  created_at: string;
};

export async function runQML(req: { dataset?: string; encoding?: string; n_qubits?: number; n_layers?: number; optimizer?: string; n_epochs?: number; task?: string }): Promise<QMLResult> {
  const res = await fetch(apiUrl("/api/v1/qml"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQMLDatasets(): Promise<{ id: string; name: string; n_features: number; n_classes: number }[]> {
  const res = await fetch(apiUrl("/api/v1/qml/datasets"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Datasets failed");
  return res.json();
}

// ------------------------------------------------------------------
// 12. Hamiltonian Engineering Studio
// ------------------------------------------------------------------

export type PauliTerm = { pauli_string: string; coefficient: number };
export type HamiltonianStudioResult = {
  studio_id: string;
  n_qubits: number;
  n_pauli_terms: number;
  total_terms: number;
  pauli_terms: PauliTerm[];
  ground_state_energy: number;
  first_excited_energy: number;
  spectral_gap: number;
  is_commuting: boolean;
  is_hermitian: boolean;
  ansatz_type: string;
  ansatz_qasm: string;
  n_ansatz_params: number;
  ansatz_depth: number;
  eigenvalues: number[];
  recommended_optimizer: string;
  created_at: string;
};

export async function engineerHamiltonian(req: { pauli_terms?: PauliTerm[]; preset?: string; n_qubits?: number; ansatz?: string }): Promise<HamiltonianStudioResult> {
  const res = await fetch(apiUrl("/api/v1/hamiltonian-studio"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listHamiltonianPresets(): Promise<{ id: string; name: string; n_qubits: number; n_terms: number }[]> {
  const res = await fetch(apiUrl("/api/v1/hamiltonian-studio/presets"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Presets failed");
  return res.json();
}

// ------------------------------------------------------------------
// 13. Publication Figure Generator
// ------------------------------------------------------------------

export type FigureGenResult = {
  figure_id: string;
  figure_type: string;
  style: string;
  format: string;
  svg_content: string;
  width_px: number;
  height_px: number;
  latex_caption: string;
  latex_label: string;
  bibtex_placeholder: string;
  created_at: string;
};

export async function generateFigure(req: { figure_type?: string; style?: string; qasm?: string; data?: Record<string, unknown>; width?: number; height?: number }): Promise<FigureGenResult> {
  const res = await fetch(apiUrl("/api/v1/figure-gen"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// 14. Statistical Hypothesis Engine
// ------------------------------------------------------------------

export type HypothesisResult = {
  test_id: string;
  test_name: string;
  alpha: number;
  test_statistic: number;
  p_value: number;
  critical_value: number;
  reject_null: boolean;
  significance_level_met: boolean;
  effect_size: number;
  effect_size_name: string;
  effect_interpretation: string;
  confidence_interval: [number, number];
  power_at_current_n: number;
  minimum_n_for_power_80: number;
  interpretation: string;
  recommendation: string;
  created_at: string;
};

export async function runHypothesisTest(req: { test?: string; observed?: number[]; expected?: number[]; alpha?: number; distribution1?: number[]; distribution2?: number[] }): Promise<HypothesisResult> {
  const res = await fetch(apiUrl("/api/v1/hypothesis"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listHypothesisTests(): Promise<{ id: string; name: string; description: string }[]> {
  const res = await fetch(apiUrl("/api/v1/hypothesis/tests"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Tests failed");
  return res.json();
}

// ------------------------------------------------------------------
// 15. QKD Protocol Simulator
// ------------------------------------------------------------------

export type QKDSimResult = {
  sim_id: string;
  protocol_name: string;
  n_bits_sent: number;
  n_sifted_bits: number;
  n_secret_bits: number;
  qber: number;
  qber_threshold: number;
  qber_acceptable: boolean;
  eavesdropper_detected: boolean;
  eavesdrop_fraction_estimate: number;
  chsh_s_value: number | null;
  bell_inequality_violated: boolean | null;
  raw_key_rate: number;
  secret_key_rate: number;
  protocol_efficiency: number;
  privacy_amplification_bits: number;
  error_correction_bits: number;
  basis_reconciliation: number;
  security_verdict: string;
  security_level: string;
  created_at: string;
};

export async function runQKDProtocol(req: { protocol?: string; n_bits?: number; eavesdrop_fraction?: number; channel_error_rate?: number; seed?: number }): Promise<QKDSimResult> {
  const res = await fetch(apiUrl("/api/v1/protocol-sim"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listQKDProtocols(): Promise<{ id: string; name: string; description: string }[]> {
  const res = await fetch(apiUrl("/api/v1/protocol-sim/protocols"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Protocols failed");
  return res.json();
}

// ------------------------------------------------------------------
// 16. Quantum Network Simulator
// ------------------------------------------------------------------

export type NetworkNode = { node_id: number; role: string; fidelity: number };
export type NetworkLink = { link_id: string; node_a: number; node_b: number; fidelity: number; distance_km: number };
export type QuantumNetworkResult = {
  network_id: string;
  topology: string;
  n_nodes: number;
  total_distance_km: number;
  n_links: number;
  per_link_distance_km: number;
  link_fidelity_optical: number;
  end_to_end_fidelity: number;
  end_to_end_fidelity_above_threshold: boolean;
  fidelity_per_hop: number[];
  entanglement_generation_time_ms: number;
  memory_wait_time_ms: number;
  secret_key_rate_bits_per_sec: number;
  raw_entanglement_rate_hz: number;
  repeater_overhead_factor: number;
  classical_communication_time_ms: number;
  nodes: NetworkNode[];
  links: NetworkLink[];
  bottleneck_link: string;
  improvement_suggestions: string[];
  created_at: string;
};

export async function simulateQuantumNetwork(req: { topology?: string; n_nodes?: number; link_fidelity?: number; memory_coherence_time_ms?: number; gate_fidelity?: number; entanglement_rate_hz?: number; distance_km?: number; seed?: number }): Promise<QuantumNetworkResult> {
  const res = await fetch(apiUrl("/api/v1/quantum-network"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listNetworkTopologies(): Promise<{ name: string; description: string }[]> {
  const res = await fetch(apiUrl("/api/v1/quantum-network/topologies"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Topologies failed");
  return res.json();
}

// ------------------------------------------------------------------
// 17. arXiv Paper Search
// ------------------------------------------------------------------

export type ArxivPaper = {
  arxiv_id: string;
  title: string;
  authors: string[];
  year: number;
  abstract_snippet: string;
  categories: string[];
  relevance_score: number;
  citation_count_estimate: number;
  bibtex: string;
  doi_url: string;
};
export type ArxivSearchResult = {
  search_id: string;
  query: string;
  n_results: number;
  total_in_database: number;
  results: ArxivPaper[];
  related_topics: string[];
  search_time_ms: number;
  created_at: string;
};

export async function searchArxiv(req: { query: string; category?: string; year_from?: number; year_to?: number; max_results?: number }): Promise<ArxivSearchResult> {
  const res = await fetch(apiUrl("/api/v1/arxiv-search"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listArxivCategories(): Promise<{ id: string; description: string }[]> {
  const res = await fetch(apiUrl("/api/v1/arxiv-search/categories"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Categories failed");
  return res.json();
}

export async function getFeaturedPapers(): Promise<ArxivPaper[]> {
  const res = await fetch(apiUrl("/api/v1/arxiv-search/featured"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Featured failed");
  return res.json();
}

// ------------------------------------------------------------------
// 18. Advantage Timeline Projector
// ------------------------------------------------------------------

export type RoadmapEntry = { year: number; logical_qubits: number; error_rate: number; can_run: boolean };
export type AdvantageScenario = { name: string; year: number; description: string };
export type AdvantageTimelineResult = {
  timeline_id: string;
  algorithm: string;
  algorithm_display_name: string;
  problem_size: number;
  qubits_needed_logical: number;
  physical_qubits_needed: number;
  t_gates_needed: number;
  current_logical_qubits: number;
  current_error_rate: number;
  years_to_advantage: number;
  year_of_advantage: number;
  hardware_roadmap: RoadmapEntry[];
  optimistic_year: number;
  pessimistic_year: number;
  most_likely_year: number;
  classical_time_years: number;
  quantum_time_seconds: number;
  speedup_at_advantage: number;
  scenarios: AdvantageScenario[];
  recommendation: string;
  created_at: string;
};

export async function projectAdvantageTimeline(req: { algorithm?: string; problem_size?: number }): Promise<AdvantageTimelineResult> {
  const res = await fetch(apiUrl("/api/v1/advantage-timeline"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listAdvantageAlgorithms(): Promise<{ id: string; display_name: string; quantum_class: string }[]> {
  const res = await fetch(apiUrl("/api/v1/advantage-timeline/algorithms"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Algorithms failed");
  return res.json();
}

// ------------------------------------------------------------------
// 19. Multi-Qubit Gate Tomography
// ------------------------------------------------------------------

export type GateTomoResult = {
  tomo_id: string;
  gate_name: string;
  gate_display: string;
  n_qubits: number;
  backend: string;
  tomo_method: string;
  method_description: string;
  n_shots: number;
  ptm: number[][];
  process_fidelity: number;
  average_gate_fidelity: number;
  unitarity: number;
  diamond_norm_upper_bound: number;
  pauli_error_rates: { depolarizing: number; dephasing: number; amplitude_damping: number };
  dominant_error_channel: string;
  is_unital: boolean;
  ideal_ptm: number[][];
  ptm_deviation: number[][];
  backend_specs: { gate_error: number; t1_us: number; t2_us: number; gate_time_ns: number };
  recommendations: string[];
  created_at: string;
};

export async function runGateTomography(req: { gate?: string; backend?: string; tomo_method?: string; n_shots?: number }): Promise<GateTomoResult> {
  const res = await fetch(apiUrl("/api/v1/gate-tomo"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTomoGates(): Promise<{ id: string; display: string; n_qubits: number }[]> {
  const res = await fetch(apiUrl("/api/v1/gate-tomo/gates"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Gates failed");
  return res.json();
}

export async function listTomoBackends(): Promise<{ id: string; n_qubits: number; gate_error: number }[]> {
  const res = await fetch(apiUrl("/api/v1/gate-tomo/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Backends failed");
  return res.json();
}

// ------------------------------------------------------------------
// 20. Collaborative Experiment Notebooks
// ------------------------------------------------------------------

export type NotebookCell = {
  cell_id: string;
  cell_type: string;
  content: string;
  language: string;
  output: Record<string, unknown> | null;
  executed_at: string | null;
  execution_count: number;
};
export type Notebook = {
  notebook_id: string;
  title: string;
  description: string;
  cells: NotebookCell[];
  collaborators: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
};
export type NotebookSummary = {
  notebook_id: string;
  title: string;
  description: string;
  n_cells: number;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export async function createNotebook(req: { title: string; description?: string; tags?: string[] }): Promise<Notebook> {
  const res = await fetch(apiUrl("/api/v1/notebook"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listNotebooks(): Promise<{ notebooks: NotebookSummary[]; total: number }> {
  const res = await fetch(apiUrl("/api/v1/notebook"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List notebooks failed");
  return res.json();
}

export async function getNotebook(id: string): Promise<Notebook> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${id}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get notebook failed");
  return res.json();
}

export async function deleteNotebook(id: string): Promise<{ deleted: boolean; notebook_id: string; title: string }> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${id}`), { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Delete notebook failed");
  return res.json();
}

export async function addNotebookCell(notebookId: string, req: { cell_type?: string; content: string; language?: string }): Promise<NotebookCell> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${notebookId}/cells`), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateNotebookCell(notebookId: string, cellId: string, content: string): Promise<NotebookCell> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${notebookId}/cells/${cellId}`), {
    method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runNotebookCell(notebookId: string, cellId: string, req?: { n_shots?: number; qasm?: string }): Promise<{ cell_id: string; execution_count: number; executed_at: string; output: Record<string, unknown> }> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${notebookId}/cells/${cellId}/run`), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req || {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportNotebook(notebookId: string, format?: string): Promise<{ export_id: string; format: string; notebook_id: string; exported_at: string; notebook: Notebook; cell_count: number; executed_cells: number }> {
  const res = await fetch(apiUrl(`/api/v1/notebook/${notebookId}/export`), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ format: format || "json" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Circuit Debugger
// ────────────────────────────────────────────
export interface CircuitDebugStep {
  step_index: number;
  gate_name: string;
  gate_params: string[];
  target_qubits: number[];
  state_real: number[];
  state_imag: number[];
  probabilities: number[];
  bloch_x: number;
  bloch_y: number;
  bloch_z: number;
}
export interface CircuitDebugResult {
  debug_id: string;
  n_qubits: number;
  n_gates: number;
  n_steps: number;
  final_state_real: number[];
  final_state_imag: number[];
  final_probabilities: number[];
  measurement_outcomes: Record<string, number>;
  steps: CircuitDebugStep[];
  created_at: string;
}
export async function debugCircuit(req: { qasm: string; n_shots?: number }): Promise<CircuitDebugResult> {
  const res = await fetch(apiUrl("/api/v1/circuit-debugger"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getDebuggerPresets(): Promise<{ presets: Array<{ id: string; name: string; qasm: string; n_qubits: number }> }> {
  const res = await fetch(apiUrl("/api/v1/circuit-debugger/presets"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get debugger presets failed");
  return res.json();
}

// ────────────────────────────────────────────
// Hardware Jobs
// ────────────────────────────────────────────
export interface HardwareJob {
  job_id: string;
  backend: string;
  provider: string;
  n_shots: number;
  status: string;
  submitted_at: string;
  started_at: string | null;
  completed_at: string | null;
  estimated_queue_time_s: number;
  queue_position: number;
  counts: Record<string, number>;
  success_probability: number;
  backend_specs: Record<string, unknown>;
}
export async function submitHardwareJob(req: { qasm: string; backend?: string; n_shots?: number; circuit_name?: string }): Promise<HardwareJob> {
  const res = await fetch(apiUrl("/api/v1/hardware-jobs"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listHardwareJobs(): Promise<{ jobs: HardwareJob[]; total: number }> {
  const res = await fetch(apiUrl("/api/v1/hardware-jobs"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List hardware jobs failed");
  return res.json();
}
export async function getHardwareJob(jobId: string): Promise<HardwareJob> {
  const res = await fetch(apiUrl(`/api/v1/hardware-jobs/${jobId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get hardware job failed");
  return res.json();
}
export async function listHardwareBackends(): Promise<{ backends: Array<Record<string, unknown>> }> {
  const res = await fetch(apiUrl("/api/v1/hardware-jobs/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List backends failed");
  return res.json();
}

// ────────────────────────────────────────────
// Resource Estimator
// ────────────────────────────────────────────
export interface ResourceMilestone {
  year: number;
  physical_qubits: number;
  can_run: boolean;
}
export interface ResourceEstimateResult {
  est_id: string;
  algorithm: string;
  n_logical_qubits: number;
  n_t_gates: number;
  p_physical: number;
  code_distance: number;
  physical_per_logical: number;
  total_physical_qubits: number;
  n_t_factories: number;
  total_time_hours: number;
  total_time_years: number;
  speedup_vs_classical: string;
  current_gap_factor: number;
  milestones: ResourceMilestone[];
  recommendations: string[];
  created_at: string;
}
export async function estimateResources(req: { algorithm?: string; n_logical_qubits?: number; n_t_gates?: number; p_physical?: number; p_logical_target?: number; include_factories?: boolean }): Promise<ResourceEstimateResult> {
  const res = await fetch(apiUrl("/api/v1/resource-estimator"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listResourceAlgorithms(): Promise<{ algorithms: Array<Record<string, unknown>> }> {
  const res = await fetch(apiUrl("/api/v1/resource-estimator/algorithms"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List algorithms failed");
  return res.json();
}

// ────────────────────────────────────────────
// Trotter Evolution
// ────────────────────────────────────────────
export interface TrotterResult {
  sim_id: string;
  hamiltonian: string;
  n_qubits: number;
  t_total: number;
  n_steps: number;
  dt: number;
  trotter_order: number;
  J: number;
  h: number;
  initial_state: string;
  time_points: number[];
  energy_evolution: number[];
  magnetization_evolution: number[];
  entanglement_evolution: number[];
  trotter_error_evolution: number[];
  final_probabilities: number[];
  final_state_labels: string[];
  ground_state_energy_estimate: number;
  max_trotter_error: number;
  energy_conservation_error: number;
  recommended_n_steps: number;
  qasm_circuit: string;
  created_at: string;
}
export async function runTrotterEvolution(req: { hamiltonian?: string; n_qubits?: number; t_total?: number; n_steps?: number; trotter_order?: number; J?: number; h?: number; delta?: number; initial_state?: string }): Promise<TrotterResult> {
  const res = await fetch(apiUrl("/api/v1/trotter"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listHamiltonians(): Promise<{ hamiltonians: Array<{ id: string; display: string; desc: string }> }> {
  const res = await fetch(apiUrl("/api/v1/trotter/hamiltonians"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List hamiltonians failed");
  return res.json();
}

// ────────────────────────────────────────────
// Code Exporter
// ────────────────────────────────────────────
export interface CodeExportResult {
  export_id: string;
  framework: string;
  framework_version: string;
  backend: string;
  n_qubits: number;
  n_gates: number;
  code: string;
  install_command: string;
  run_command: string;
  estimated_run_time_s: number;
  notes: string[];
  created_at: string;
}
export async function exportCode(req: { qasm: string; framework?: string; backend?: string; n_shots?: number; include_visualization?: boolean; add_error_mitigation?: boolean }): Promise<CodeExportResult> {
  const res = await fetch(apiUrl("/api/v1/code-export"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listCodeFrameworks(): Promise<{ frameworks: Array<{ id: string; version: string; install: string }> }> {
  const res = await fetch(apiUrl("/api/v1/code-export/frameworks"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List frameworks failed");
  return res.json();
}

// ────────────────────────────────────────────
// XEB (Cross-Entropy Benchmarking)
// ────────────────────────────────────────────
export interface XEBResult {
  xeb_id: string;
  n_qubits: number;
  circuit_depth: number;
  n_circuits: number;
  n_shots: number;
  noise_level: number;
  linear_xeb_fidelity: number;
  log_xeb_fidelity: number;
  per_circuit_xeb: number[];
  heavy_output_probability: number;
  ideal_heavy_output_threshold: number;
  collision_probability: number;
  porter_thomas_kl_divergence: number;
  effective_noise_per_gate: number;
  predicted_xeb_from_noise: number;
  classical_simulation_time_estimate_s: number;
  quantum_speedup_factor: number;
  quantum_advantage_certified: boolean;
  confidence_level: string;
  google_sycamore_comparison: string;
  created_at: string;
}
export async function runXEB(req: { n_qubits?: number; circuit_depth?: number; n_circuits?: number; n_shots?: number; noise_level?: number; backend?: string }): Promise<XEBResult> {
  const res = await fetch(apiUrl("/api/v1/xeb"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Quantum Finance
// ────────────────────────────────────────────
export interface QuantumFinanceResult {
  finance_id: string;
  problem: string;
  n_qubits: number;
  option_type: string;
  asset_price: number;
  strike_price: number;
  volatility: number;
  risk_free_rate: number;
  time_to_expiry: number;
  black_scholes_price: number;
  quantum_price_estimate: number;
  classical_mc_price: number;
  pricing_error: number;
  classical_n_paths_needed: number;
  quantum_n_paths_needed: number;
  speedup_factor: number;
  confidence_interval_lower: number;
  confidence_interval_upper: number;
  optimal_portfolio: number[];
  expected_return: number;
  portfolio_risk: number;
  sharpe_ratio: number;
  qaoa_approximation_ratio: number;
  asset_returns: number[];
  circuit_depth: number;
  n_cnot_gates: number;
  quantum_advantage_achieved: boolean;
  interpretation: string;
  created_at: string;
}
export async function runQuantumFinance(req: { problem?: string; asset_price?: number; strike_price?: number; volatility?: number; risk_free_rate?: number; time_to_expiry?: number; n_qubits?: number; n_paths?: number; n_assets?: number; budget?: number; seed?: number }): Promise<QuantumFinanceResult> {
  const res = await fetch(apiUrl("/api/v1/quantum-finance"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Mirror Circuit Benchmarker
// ────────────────────────────────────────────
export interface MirrorCircuitResult {
  mirror_id: string;
  n_qubits: number;
  circuit_depth: number;
  n_circuits: number;
  n_shots: number;
  noise_level: number;
  gate_set: string;
  n_gates_per_circuit: number;
  n_total_gates: number;
  per_circuit_success: number[];
  mean_success_probability: number;
  std_success_probability: number;
  polarization_fidelity: number;
  effective_error_per_layer: number;
  effective_error_per_gate: number;
  entanglement_layer_fidelity: number;
  clops_estimate: number;
  quality_grade: string;
  comparison_to_ideal: string;
  vs_qv_score: number;
  recommendations: string[];
  created_at: string;
}
export async function runMirrorCircuit(req: { n_qubits?: number; circuit_depth?: number; n_circuits?: number; n_shots?: number; noise_level?: number; gate_set?: string }): Promise<MirrorCircuitResult> {
  const res = await fetch(apiUrl("/api/v1/mirror"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Channel Capacity
// ────────────────────────────────────────────
export interface ChannelCapacityResult {
  cap_id: string;
  channel: string;
  classical_capacity_bits_per_use: number;
  quantum_capacity_qubits_per_use: number;
  entanglement_assisted_capacity: number;
  coherent_information: number;
  fidelity: number;
  error_rates: Record<string, number>;
  n_uses: number;
  total_classical_bits: number;
  total_quantum_bits: number;
  total_ebits_needed: number;
  error_correction_overhead: number | null;
  hashing_bound: number;
  threshold_error_rate: number | null;
  above_threshold: boolean | null;
  superadditivity_possible: boolean;
  interpretation: string;
  created_at: string;
}
export async function analyzeChannelCapacity(req: { channel?: string; p_err?: number; gamma?: number; lam?: number; epsilon?: number; px?: number; py?: number; pz?: number; n_uses?: number; uses_entanglement?: boolean }): Promise<ChannelCapacityResult> {
  const res = await fetch(apiUrl("/api/v1/channel-capacity"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listChannels(): Promise<{ channels: Array<{ id: string; desc: string }> }> {
  const res = await fetch(apiUrl("/api/v1/channel-capacity/channels"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List channels failed");
  return res.json();
}

// ────────────────────────────────────────────
// arXiv Feed
// ────────────────────────────────────────────
export interface ArxivFeedPaper {
  arxiv_id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  date: string;
  citations: number;
  journal: string;
}
export interface ArxivFeedResult {
  feed_id: string;
  query: string;
  total_found: number;
  returned: number;
  papers: ArxivFeedPaper[];
  trending_papers: ArxivFeedPaper[];
  categories_available: string[];
  stats: { total_papers_indexed: number; avg_citations: number; most_cited: string };
  created_at: string;
}
export async function searchArxivFeed(req: { query?: string; categories?: string[]; max_results?: number; sort_by?: string; since_days?: number }): Promise<ArxivFeedResult> {
  const res = await fetch(apiUrl("/api/v1/arxiv-feed"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getTrendingArxiv(): Promise<{ trending: ArxivFeedPaper[]; as_of: string }> {
  const res = await fetch(apiUrl("/api/v1/arxiv-feed/trending"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Trending fetch failed");
  return res.json();
}

// ────────────────────────────────────────────
// Circuit Knitting
// ────────────────────────────────────────────
export interface CircuitKnittingResult {
  knitting_id: string;
  n_qubits: number;
  n_subcircuits: number;
  n_cuts: number;
  cuts_type: string;
  reconstruction_method: string;
  fragment_sizes: number[];
  max_fragment_qubits: number;
  qubit_savings: number;
  n_circuit_instances: number;
  total_shots_required: number;
  effective_shots: number;
  overhead_factor: number;
  sampling_overhead: number;
  fragment_fidelity: number;
  full_circuit_fidelity: number;
  fidelity_improvement: number;
  estimated_expectation_value: number;
  reconstruction_error_estimate: number;
  practical_feasibility: boolean;
  method_description: string;
  recommendations: string[];
  interpretation: string;
  created_at: string;
}
export async function runCircuitKnitting(req: { n_qubits?: number; n_subcircuits?: number; cuts_type?: string; n_shots?: number; noise_level?: number; reconstruction_method?: string; circuit_depth?: number }): Promise<CircuitKnittingResult> {
  const res = await fetch(apiUrl("/api/v1/circuit-knitting"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Noise Model Builder
// ────────────────────────────────────────────
export interface NoiseModelResult {
  model_id: string;
  n_qubits: number;
  hardware_type: string;
  t1_us: number;
  t2_us: number;
  gate_time_1q_ns: number;
  gate_time_2q_ns: number;
  readout_fidelity: number;
  gate_error_1q: { p_relaxation: number; p_dephasing: number; p_total: number };
  gate_error_2q: { p_relaxation: number; p_dephasing: number; p_total: number };
  gate_error_table: Record<string, { error_rate: number; error_type: string }>;
  measurement_errors: Array<{ qubit: number; p_meas_error: number; p0_given_1: number; p1_given_0: number }>;
  crosstalk_terms: Array<{ qubit_a: number; qubit_b: number; strength: number }>;
  estimated_circuit_fidelity_d10: number;
  estimated_qv_lower_bound: number;
  dominant_error_source: string;
  qasm_noise_pragma: string;
  compatible_backends: string[];
  created_at: string;
}
export async function buildNoiseModel(req: { n_qubits?: number; hardware_type?: string; t1_us?: number; t2_us?: number; gate_time_1q_ns?: number; gate_time_2q_ns?: number; readout_fidelity?: number; include_crosstalk?: boolean; crosstalk_strength?: number }): Promise<NoiseModelResult> {
  const res = await fetch(apiUrl("/api/v1/noise-model"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listHardwareTypes(): Promise<{ hardware_types: Array<Record<string, string>> }> {
  const res = await fetch(apiUrl("/api/v1/noise-model/hardware-types"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List hardware types failed");
  return res.json();
}

// ────────────────────────────────────────────
// QAOA Solver
// ────────────────────────────────────────────
export interface QAOAEdge {
  from: number;
  to: number;
  weight: number;
}
export interface QAOAResult {
  qaoa_id: string;
  problem: string;
  n_nodes: number;
  n_edges: number;
  graph_type: string;
  p_layers: number;
  n_params: number;
  optimizer: string;
  optimal_gammas: number[];
  optimal_betas: number[];
  optimal_cost: number;
  convergence_history: number[];
  n_iterations: number;
  classical_optimal: number;
  classical_assignment: number[];
  qaoa_assignment: number[];
  qaoa_cut_value: number;
  approximation_ratio: number;
  expected_cut_value: number;
  best_shot_cut: number;
  n_qubits: number;
  n_1q_gates: number;
  n_2q_gates: number;
  circuit_depth: number;
  goemans_williamson_bound: number;
  exceeds_gw: boolean;
  edges: QAOAEdge[];
  created_at: string;
}
export async function runQAOA(req: { problem?: string; n_nodes?: number; p_layers?: number; graph_type?: string; edge_density?: number; optimizer?: string; max_iter?: number; n_shots?: number; seed?: number }): Promise<QAOAResult> {
  const res = await fetch(apiUrl("/api/v1/qaoa"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ────────────────────────────────────────────
// Quantum Sensing
// ────────────────────────────────────────────
export interface QuantumSensingResult {
  sensing_id: string;
  protocol: string;
  sensor_type: string;
  n_sensors: number;
  n_repetitions: number;
  interrogation_time_us: number;
  t1_us: number;
  t2_us: number;
  signal_frequency_MHz: number;
  use_entanglement: boolean;
  sql_sensitivity_phase: number;
  hl_sensitivity_phase: number;
  effective_sensitivity: number;
  sensitivity_freq_Hz: number;
  sensitivity_T_per_rtHz: number;
  decoherence_factor: number;
  classical_fisher_info: number;
  quantum_fisher_info: number;
  qfi_advantage_over_classical: number;
  duty_cycle: number;
  snr_estimate: number;
  scaling_type: string;
  protocol_description: string;
  sensor_application: string;
  beats_classical: boolean;
  recommendations: string[];
  created_at: string;
}
export async function runQuantumSensing(req: { protocol?: string; sensor_type?: string; n_sensors?: number; n_repetitions?: number; interrogation_time_us?: number; total_time_us?: number; signal_frequency_MHz?: number; use_entanglement?: boolean; t1_us?: number; t2_us?: number }): Promise<QuantumSensingResult> {
  const res = await fetch(apiUrl("/api/v1/quantum-sensing"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listSensingProtocols(): Promise<{ protocols: Array<{ id: string; description: string }> }> {
  const res = await fetch(apiUrl("/api/v1/quantum-sensing/protocols"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List protocols failed");
  return res.json();
}

// ────────────────────────────────────────────
// Bloch Sphere Animator
// ────────────────────────────────────────────
export interface BlochFrame {
  step: number;
  gate: string;
  bx: number;
  by: number;
  bz: number;
  theta: number;
  phi: number;
}
export interface BlochAnimResult {
  anim_id: string;
  gate_sequence: string[];
  initial_state: string;
  n_frames: number;
  frames: BlochFrame[];
  trajectory: Array<{ bx: number; by: number; bz: number }>;
  final_bloch_vector: { bx: number; by: number; bz: number };
  bloch_sphere_radius: number;
  purity: number;
  is_pure_state: boolean;
  amplitude_0: { real: number; imag: number };
  amplitude_1: { real: number; imag: number };
  prob_0: number;
  prob_1: number;
  svg_preview: string;
  created_at: string;
}
export async function animateBloch(req: { gate_sequence?: string[]; initial_state?: string; n_frames?: number; include_trajectory?: boolean; noise_level?: number }): Promise<BlochAnimResult> {
  const res = await fetch(apiUrl("/api/v1/bloch"), {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listBlochGates(): Promise<{ gates: string[] }> {
  const res = await fetch(apiUrl("/api/v1/bloch/gates"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List gates failed");
  return res.json();
}


// ─────────────────────────────────────────────────────────
// Multi-Provider Execution
// ─────────────────────────────────────────────────────────
export interface ProviderJobResult {
  job_id: string; provider_id: string; provider_name: string; backend: string;
  status: string; submitted_at: string; estimated_completion: string;
  n_shots: number; cost_usd: number; queue_position: number;
  counts: Record<string, number>; fidelity_estimate: number;
  transpiled_depth: number; transpiled_gates: number;
  success: boolean; error_message: string | null;
}
export interface MultiProviderResult {
  batch_id: string; circuit_name: string; n_providers: number; submitted_at: string;
  jobs: ProviderJobResult[]; best_fidelity_provider: string;
  lowest_cost_provider: string; fastest_provider: string;
  consensus_counts: Record<string, number>; agreement_score: number;
}
export async function submitToProviders(req: { qasm: string; provider_ids?: string[]; n_shots?: number; circuit_name?: string }): Promise<MultiProviderResult> {
  const res = await fetch(apiUrl("/api/v1/providers/submit"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listProviders(): Promise<{ providers: object[] }> {
  const res = await fetch(apiUrl("/api/v1/providers/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List providers failed");
  return res.json();
}
export async function getProviderBatch(batchId: string): Promise<MultiProviderResult> {
  const res = await fetch(apiUrl(`/api/v1/providers/batch/${batchId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get batch failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Environment Snapshots
// ─────────────────────────────────────────────────────────
export interface EnvPackage { name: string; version: string; source: string; }
export interface EnvironmentSnapshot {
  env_id: string; captured_at: string; python_version: string; platform: string;
  architecture: string; cpu_count: number; packages: EnvPackage[];
  env_hash: string; qiskit_version: string; numpy_version: string;
  backend_firmware: string | null; cuda_available: boolean;
  total_ram_gb: number; run_id: string | null;
}
export interface EnvDiff {
  env_a: string; env_b: string; added: EnvPackage[]; removed: EnvPackage[];
  changed: Array<{ name: string; from: string; to: string }>;
  identical: boolean; hash_match: boolean; reproducibility_score: number;
  risk_level: string; warnings: string[];
}
export async function captureEnvironment(req: { run_id?: string; backend_firmware?: string }): Promise<EnvironmentSnapshot> {
  const res = await fetch(apiUrl("/api/v1/environment/capture"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getEnvironmentSnapshot(envId: string): Promise<EnvironmentSnapshot> {
  const res = await fetch(apiUrl(`/api/v1/environment/${envId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get snapshot failed");
  return res.json();
}
export async function diffEnvironments(req: { env_id_a: string; env_id_b: string }): Promise<EnvDiff> {
  const res = await fetch(apiUrl("/api/v1/environment/diff"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Hypotheses
// ─────────────────────────────────────────────────────────
export interface Hypothesis {
  hyp_id: string; title: string; statement: string; background: string;
  prediction: string; null_hypothesis: string; status: string;
  confidence: number; created_at: string; updated_at: string;
  linked_run_ids: string[]; linked_paper_ids: string[];
  evidence_for: string[]; evidence_against: string[];
  tags: string[]; created_by: string; conclusion: string | null;
  p_value: number | null; effect_size: number | null;
}
export async function createHypothesis(req: { title: string; statement: string; background?: string; prediction?: string; null_hypothesis?: string; tags?: string[] }): Promise<Hypothesis> {
  const res = await fetch(apiUrl("/api/v1/hypotheses/"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listHypotheses(status?: string): Promise<{ hypotheses: Hypothesis[]; total: number; by_status: Record<string, number> }> {
  const url = status ? `/api/v1/hypotheses/?status=${status}` : "/api/v1/hypotheses/";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List hypotheses failed");
  return res.json();
}
export async function updateHypothesis(hypId: string, req: { status?: string; conclusion?: string; confidence?: number; p_value?: number; effect_size?: number }): Promise<Hypothesis> {
  const res = await fetch(apiUrl(`/api/v1/hypotheses/${hypId}`), { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function linkHypothesisRun(hypId: string, runId: string, role?: string): Promise<Hypothesis> {
  const res = await fetch(apiUrl(`/api/v1/hypotheses/${hypId}/link-run`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ run_id: runId, role }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Circuit Ancestry
// ─────────────────────────────────────────────────────────
export interface AncestryCircuitVersion {
  version_id: string; circuit_id: string; version_number: number;
  commit_message: string; qasm: string; n_qubits: number; depth: number;
  gate_count: number; created_at: string; created_by: string;
  parent_version_id: string | null; forked_from_circuit_id: string | null;
  tags: string[]; run_ids: string[]; fidelity_at_commit: number | null; is_head: boolean;
}
export interface AncestryCircuitTree {
  circuit_id: string; name: string; head_version_id: string;
  total_versions: number; total_forks: number; created_at: string;
  versions: AncestryCircuitVersion[]; fork_ids: string[];
}
export interface AncestryCircuitDiffResult {
  circuit_id: string; version_a: string; version_b: string;
  unified_diff: string; lines_added: number; lines_removed: number;
  gates_added: string[]; gates_removed: string[];
  depth_delta: number; gate_count_delta: number; similarity_score: number;
}
export async function createCircuit(req: { name: string; qasm: string; commit_message?: string; tags?: string[] }): Promise<AncestryCircuitVersion> {
  const res = await fetch(apiUrl("/api/v1/circuit-ancestry/"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getCircuitTree(circuitId: string): Promise<AncestryCircuitTree> {
  const res = await fetch(apiUrl(`/api/v1/circuit-ancestry/${circuitId}/tree`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get circuit tree failed");
  return res.json();
}
export async function listCircuits(): Promise<{ circuits: object[] }> {
  const res = await fetch(apiUrl("/api/v1/circuit-ancestry/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List circuits failed");
  return res.json();
}
export async function forkCircuit(req: { circuit_id: string; version_id?: string; new_name?: string; commit_message?: string }): Promise<AncestryCircuitVersion> {
  const res = await fetch(apiUrl("/api/v1/circuit-ancestry/fork"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Methods Generator
// ─────────────────────────────────────────────────────────
export interface MethodsGenResult {
  doc_id: string; template: string; experiment_type: string; generated_at: string;
  methods_text: string; calibration_table_md: string; references: string[];
  word_count: number; bibtex: string;
  reproducibility_checklist: Array<{ item: string; done: boolean }>;
}
export async function generateMethods(req: { run_ids: string[]; template?: string; experiment_type?: string; include_calibration_table?: boolean; cite_qiskit?: boolean }): Promise<MethodsGenResult> {
  const res = await fetch(apiUrl("/api/v1/methods-gen/generate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listMethodsTemplates(): Promise<{ templates: object[] }> {
  const res = await fetch(apiUrl("/api/v1/methods-gen/templates"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List templates failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Cost Oracle
// ─────────────────────────────────────────────────────────
export interface ProviderCostEstimate {
  provider_id: string; provider_name: string; cost_per_circuit_usd: number;
  cost_total_usd: number; cost_note: string; estimated_queue_min: number;
  shots_available: boolean; monthly_budget_warning: boolean;
  free_tier: boolean; currency: string;
}
export interface CostEstimateResult {
  estimate_id: string; n_qubits: number; n_shots: number; n_circuits: number;
  generated_at: string; providers: ProviderCostEstimate[];
  cheapest_provider: string; cheapest_cost_usd: number;
  total_if_all_providers_usd: number; recommendations: string[];
}
export async function estimateProviderCost(req: { n_qubits?: number; circuit_depth?: number; n_shots?: number; n_circuits?: number; provider_ids?: string[] }): Promise<CostEstimateResult> {
  const res = await fetch(apiUrl("/api/v1/cost-oracle/estimate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getCostHistory(): Promise<{ history: object[]; total_usd: number; by_provider: Record<string, number> }> {
  const res = await fetch(apiUrl("/api/v1/cost-oracle/history"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get cost history failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Calibration Oracle
// ─────────────────────────────────────────────────────────
export interface QubitCalibration { qubit_id: number; t1_us: number; t2_us: number; single_q_error: number; readout_error: number; frequency_ghz: number; }
export interface BackendCalibration {
  cal_id: string; backend: string; timestamp: string; n_qubits: number;
  median_t1_us: number; median_t2_us: number; median_1q_error: number;
  median_2q_error: number; median_readout_error: number;
  min_t1_us: number; max_t1_us: number; qv: number; clops: number;
  qubits: QubitCalibration[]; health_score: number; trend: string; firmware_version: string;
}
export async function getCalibration(backend: string): Promise<BackendCalibration> {
  const res = await fetch(apiUrl(`/api/v1/calibration-oracle/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get calibration failed");
  return res.json();
}
export async function getCalibrationHistory(backend: string, n?: number): Promise<{ backend: string; history: BackendCalibration[]; metrics: Record<string, number[]> }> {
  const res = await fetch(apiUrl(`/api/v1/calibration-oracle/${backend}/history${n ? `?n=${n}` : ""}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get calibration history failed");
  return res.json();
}
export async function listCalibrationBackends(): Promise<{ backends: object[] }> {
  const res = await fetch(apiUrl("/api/v1/calibration-oracle/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List calibration backends failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Experiment Registry
// ─────────────────────────────────────────────────────────
export interface RegistryEntry {
  registry_id: string; title: string; description: string; experiment_type: string;
  n_qubits: number; backend: string; tags: string[]; stars: number; forks: number;
  author: string; institution: string; doi: string | null;
  published_at: string; updated_at: string; run_ids: string[];
  is_public: boolean; license: string; views: number; content_hash: string;
  forked_from: string | null; reproducibility_badge: boolean;
}
export async function publishExperiment(req: { title: string; description: string; experiment_type?: string; n_qubits?: number; backend?: string; tags?: string[]; run_ids?: string[]; author?: string; institution?: string; doi?: string; license?: string }): Promise<RegistryEntry> {
  const res = await fetch(apiUrl("/api/v1/registry/"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function searchRegistry(req: { query?: string; experiment_type?: string; min_stars?: number; tags?: string[]; max_results?: number; sort_by?: string }): Promise<{ results: RegistryEntry[]; total: number; returned: number; stats: Record<string, number> }> {
  const res = await fetch(apiUrl("/api/v1/registry/search"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function starRegistryEntry(registryId: string): Promise<{ starred: boolean; stars: number }> {
  const res = await fetch(apiUrl(`/api/v1/registry/${registryId}/star`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error("Star failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Cross-Lab Benchmarking
// ─────────────────────────────────────────────────────────
export interface CrossBenchResult {
  benchmark_id: string; benchmark_name: string; metric: string;
  higher_is_better: boolean; your_value: number; your_percentile: number;
  sota_value: number; sota_reference: string; classical_polynomial: number | null;
  beats_sota: boolean; beats_classical: boolean; rank: number; total_entries: number;
  gap_to_sota_pct: number; gap_to_classical_pct: number | null;
  all_entries: Array<{ label: string; value: number; n_qubits: number; backend: string; year: number; doi: string | null }>;
  verdict: string; generated_at: string;
}
export async function compareToBenchmark(req: { benchmark_id: string; your_value: number; n_qubits?: number; backend?: string; label?: string; run_ids?: string[] }): Promise<CrossBenchResult> {
  const res = await fetch(apiUrl("/api/v1/cross-bench/compare"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listBenchmarks(): Promise<{ benchmarks: object[] }> {
  const res = await fetch(apiUrl("/api/v1/cross-bench/benchmarks"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List benchmarks failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Noise Model Marketplace
// ─────────────────────────────────────────────────────────
export interface NoiseMarketplaceModel {
  model_id: string; name: string; backend: string; description: string;
  model_type: string; n_qubits: number; date_captured: string;
  published_at: string; author: string; institution: string;
  downloads: number; stars: number; tags: string[];
  fidelity_error: number; methods: string[];
  qasm_snippet: string; qiskit_snippet: string; pennylane_snippet: string;
}
export async function listNoiseModels(params?: { model_type?: string; backend?: string; sort_by?: string }): Promise<{ models: NoiseMarketplaceModel[]; total: number; stats: Record<string, unknown> }> {
  const qs = params ? "?" + Object.entries(params).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join("&") : "";
  const res = await fetch(apiUrl(`/api/v1/noise-marketplace/${qs}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List noise models failed");
  return res.json();
}
export async function getNoiseModel(modelId: string): Promise<NoiseMarketplaceModel> {
  const res = await fetch(apiUrl(`/api/v1/noise-marketplace/${modelId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get noise model failed");
  return res.json();
}
export async function applyNoiseModel(req: { model_id: string; circuit_qasm: string; n_shots?: number }): Promise<{ model_id: string; model_name: string; noiseless_fidelity_estimate: number; noisy_fidelity_estimate: number; fidelity_degradation: number; ideal_counts: Record<string, number>; noisy_counts: Record<string, number>; noise_method: string }> {
  const res = await fetch(apiUrl(`/api/v1/noise-marketplace/${req.model_id}/apply`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Bayesian Optimization
// ─────────────────────────────────────────────────────────
export interface BayesParamSpec { name: string; min_val: number; max_val: number; param_type: string; log_scale: boolean; }
export interface BayesOptSession {
  opt_id: string; name: string; parameters: BayesParamSpec[];
  objective: string; minimize: boolean; n_initial: number;
  max_iterations: number; current_iteration: number; status: string;
  best_params: Record<string, number>; best_value: number | null;
  created_at: string; updated_at: string;
  history: Array<{ iteration: number; params: Record<string, number>; value: number; timestamp: string }>;
  gp_model_summary: Record<string, unknown>; next_params: Record<string, number>;
  convergence_detected: boolean; improvement_history: number[];
  expected_improvement: number;
}
export async function startBayesOpt(req: { name?: string; parameters: BayesParamSpec[]; objective?: string; minimize?: boolean; n_initial?: number; max_iterations?: number; acquisition?: string }): Promise<BayesOptSession> {
  const res = await fetch(apiUrl("/api/v1/bayes-opt/start"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function submitBayesResult(req: { opt_id: string; params: Record<string, number>; value: number; metadata?: Record<string, unknown> }): Promise<BayesOptSession> {
  const res = await fetch(apiUrl("/api/v1/bayes-opt/submit"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getBayesSession(optId: string): Promise<BayesOptSession> {
  const res = await fetch(apiUrl(`/api/v1/bayes-opt/${optId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get session failed");
  return res.json();
}
export async function listBayesSessions(): Promise<{ sessions: object[] }> {
  const res = await fetch(apiUrl("/api/v1/bayes-opt/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List sessions failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Research Graph
// ─────────────────────────────────────────────────────────
export interface ResearchGraphNode {
  node_id: string; node_type: string; label: string; description: string;
  metadata: Record<string, unknown>; created_at: string;
  x: number; y: number; color: string; size: number;
}
export interface ResearchGraphEdge {
  edge_id: string; source_id: string; target_id: string;
  edge_type: string; label: string; weight: number;
  metadata: Record<string, unknown>; created_at: string;
}
export interface ResearchGraph {
  nodes: ResearchGraphNode[]; edges: ResearchGraphEdge[];
  stats: { n_nodes: number; n_edges: number; node_types: Record<string, number> };
}
export async function getResearchGraph(): Promise<ResearchGraph> {
  const res = await fetch(apiUrl("/api/v1/research-graph/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get research graph failed");
  return res.json();
}
export async function addGraphNode(req: { node_type: string; label: string; description?: string; metadata?: Record<string, unknown> }): Promise<ResearchGraphNode> {
  const res = await fetch(apiUrl("/api/v1/research-graph/nodes"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function addGraphEdge(req: { source_id: string; target_id: string; edge_type: string; label?: string; weight?: number }): Promise<ResearchGraphEdge> {
  const res = await fetch(apiUrl("/api/v1/research-graph/edges"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Community Challenges
// ─────────────────────────────────────────────────────────
export interface Challenge {
  challenge_id: string; title: string; description: string; problem_type: string;
  metric: string; higher_is_better: boolean; target_value: number;
  baseline_value: number; deadline: string; difficulty: string; prize: string;
  n_qubits_min: number; n_qubits_max: number; tags: string[];
  status: string; participants: number; problem_instance: Record<string, unknown>;
  created_at: string; leader: string | null; leader_value: number | null;
}
export interface ChallengeSubmission {
  submission_id: string; challenge_id: string; value: number; rank: number;
  percentile: number; submitted_at: string; label: string;
  n_qubits: number; backend: string; run_ids: string[];
  notes: string; verified: boolean; metadata: Record<string, unknown>;
}
export async function listChallenges(status?: string): Promise<{ challenges: Challenge[]; total: number; active: number; total_participants: number }> {
  const url = status ? `/api/v1/challenges/?status=${status}` : "/api/v1/challenges/";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List challenges failed");
  return res.json();
}
export async function getChallengeLeaderboard(challengeId: string): Promise<{ challenge_id: string; metric: string; higher_is_better: boolean; target_value: number; baseline_value: number; entries: object[]; total_entries: number }> {
  const res = await fetch(apiUrl(`/api/v1/challenges/${challengeId}/leaderboard`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get leaderboard failed");
  return res.json();
}
export async function submitToChallenge(challengeId: string, req: { value: number; label?: string; n_qubits?: number; backend?: string; run_ids?: string[]; notes?: string }): Promise<ChallengeSubmission> {
  const res = await fetch(apiUrl(`/api/v1/challenges/${challengeId}/submit`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ challenge_id: challengeId, ...req }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Copilot
// ─────────────────────────────────────────────────────────
export interface CopilotMessage { role: string; content: string; timestamp: string; }
export interface CopilotSession { session_id: string; created_at: string; messages: CopilotMessage[]; context_run_ids: string[]; context_summary: string; }
export interface CopilotResponse { session_id: string; reply: string; cited_run_ids: string[]; suggested_actions: object[]; confidence: number; follow_up_questions: string[]; }
export async function chatWithCopilot(req: { session_id?: string; message: string; context_run_ids?: string[] }): Promise<CopilotResponse> {
  const res = await fetch(apiUrl("/api/v1/copilot/chat"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getCopilotSession(sessionId: string): Promise<CopilotSession> {
  const res = await fetch(apiUrl(`/api/v1/copilot/${sessionId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get session failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Stats Engine
// ─────────────────────────────────────────────────────────
export interface FisherResult { qfi: number; cfi: number; hl_bound: number; sql_bound: number; sensitivity_ratio: number; beating_sql: boolean; beating_hl: boolean; }
export interface StatAnalysisResult { analysis_id: string; created_at: string; n_samples: number; fidelity_mean: number; fidelity_std: number; fidelity_ci_low: number; fidelity_ci_high: number; chi2_statistic: number; chi2_p_value: number; bayesian_evidence: number; log_bayes_factor: number; bootstrap_mean: number; bootstrap_std: number; bootstrap_ci_low: number; bootstrap_ci_high: number; effect_size: number; is_significant: boolean; power: number; sample_size_needed: number; fisher: FisherResult; systematic_variance: number; shot_variance: number; dominant_noise: string; recommendations: string[]; error_budget: Record<string, number>; }
export async function runStatAnalysis(req: { samples: { counts: Record<string, number>; n_shots: number; n_qubits: number; label?: string }[]; target_state?: string; confidence_level?: number; n_bootstrap?: number }): Promise<StatAnalysisResult> {
  const res = await fetch(apiUrl("/api/v1/stats-engine/analyze"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Autopilot
// ─────────────────────────────────────────────────────────
export interface TerminationCondition { metric: string; target_value: number; tolerance: number; max_iterations: number; max_cost_usd: number; confidence_required: number; }
export interface AutopilotMission { mission_id: string; name: string; goal: string; status: string; created_at: string; updated_at: string; current_iteration: number; total_runs: number; best_value: number | null; best_params: Record<string, number>; best_run_id: string | null; termination: TerminationCondition; iterations: object[]; decision_log: object[]; total_cost_usd: number; estimated_completion_pct: number; next_action: Record<string, unknown>; converged: boolean; convergence_reason: string | null; }
export async function startAutopilot(req: { name?: string; goal?: string; backend?: string; termination?: Partial<TerminationCondition>; initial_params?: Record<string, number>; n_shots?: number }): Promise<AutopilotMission> {
  const res = await fetch(apiUrl("/api/v1/autopilot/start"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function stepAutopilot(req: { mission_id: string; value: number; params: Record<string, number>; run_id: string }): Promise<AutopilotMission> {
  const res = await fetch(apiUrl("/api/v1/autopilot/step"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getAutopilotMission(missionId: string): Promise<AutopilotMission> {
  const res = await fetch(apiUrl(`/api/v1/autopilot/${missionId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get mission failed");
  return res.json();
}
export async function listAutopilotMissions(): Promise<{ missions: object[] }> {
  const res = await fetch(apiUrl("/api/v1/autopilot/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List missions failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Tomography
// ─────────────────────────────────────────────────────────
export interface TomographyJob { job_id: string; method: string; n_qubits: number; n_measurements: number; n_shots: number; status: string; created_at: string; fidelity: number | null; purity: number | null; concurrence: number | null; entanglement_entropy: number | null; density_matrix_real: number[][] | null; density_matrix_imag: number[][] | null; eigenvalues: number[] | null; is_physical: boolean | null; negativity: number | null; measurements_used: number; compression_ratio: number; reconstruction_time_ms: number; pauli_expectations: Record<string, number>; bloch_vector: number[] | null; warnings: string[]; infidelity: number | null; }
export async function runTomography(req: { method?: string; n_qubits?: number; n_shots?: number; counts?: Record<string, number>; target_state?: string; regularization?: number }): Promise<TomographyJob> {
  const res = await fetch(apiUrl("/api/v1/tomography/run"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listTomographyJobs(): Promise<{ jobs: object[] }> {
  const res = await fetch(apiUrl("/api/v1/tomography/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List jobs failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// ZNE / PEC
// ─────────────────────────────────────────────────────────
export interface ZNEResult { method: string; noise_factors: number[]; raw_values: number[]; extrapolated_value: number; r_squared: number; noise_rate_estimate: number; mitigation_factor: number; }
export interface MitigationJob { job_id: string; method: string; created_at: string; circuit_name: string; n_qubits: number; circuit_depth: number; backend: string; noisy_value: number; mitigated_value: number; mitigation_overhead: number; estimated_true_value: number; confidence_interval: number[]; zne: ZNEResult | null; pec: object | null; cdr: object | null; symmetry_verification: object | null; mthree: object | null; recommendations: string[]; cost_usd: number; }
export async function runMitigation(req: { method?: string; circuit_name?: string; n_qubits?: number; circuit_depth?: number; backend?: string; n_shots?: number; noise_factors?: number[]; noisy_counts?: Record<string, number> }): Promise<MitigationJob> {
  const res = await fetch(apiUrl("/api/v1/zne-pec/mitigate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listMitigationJobs(): Promise<{ jobs: object[] }> {
  const res = await fetch(apiUrl("/api/v1/zne-pec/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List jobs failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Error Budget
// ─────────────────────────────────────────────────────────
export interface ErrorComponent { name: string; category: string; contribution_pct: number; absolute_error: number; description: string; mitigatable: boolean; mitigation_strategy: string; }
export interface ErrorBudgetReport { report_id: string; created_at: string; circuit_name: string; n_qubits: number; circuit_depth: number; backend: string; total_error: number; infidelity: number; components: ErrorComponent[]; gate_error_total: number; decoherence_total: number; spam_total: number; measurement_total: number; leakage_total: number; dominant_error: string; fault_tolerant_threshold: number; below_ft_threshold: boolean; recommendations: string[]; action_items: object[]; }
export async function analyzeErrorBudget(req: { circuit_name?: string; n_qubits?: number; circuit_depth?: number; backend?: string; measured_fidelity?: number }): Promise<ErrorBudgetReport> {
  const res = await fetch(apiUrl("/api/v1/error-budget/analyze"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// DD Optimizer
// ─────────────────────────────────────────────────────────
export interface DDPulseSchedule { sequence_type: string; pulses: string[]; n_repetitions: number; total_pulses: number; gate_overhead: number; time_overhead_pct: number; t1_improvement_factor: number; t2_improvement_factor: number; fidelity_improvement_pct: number; qasm_insertion: string; qiskit_snippet: string; suppresses: string[]; }
export interface DDReport { report_id: string; created_at: string; backend: string; idle_time_us: number; recommended_sequence: string; reason: string; sequences: DDPulseSchedule[]; estimated_t2_with_dd: number; estimated_t2_without_dd: number; overhead_acceptable: boolean; noise_spectrum: Record<string, unknown>; }
export async function optimizeDDSequence(req: { circuit_name?: string; n_qubits?: number; circuit_depth?: number; backend?: string; noise_type?: string; t1_us?: number; t2_us?: number; max_overhead_pct?: number }): Promise<DDReport> {
  const res = await fetch(apiUrl("/api/v1/dd-optimizer/optimize"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Peer Review
// ─────────────────────────────────────────────────────────
export interface PeerReviewSubmission { submission_id: string; title: string; abstract: string; experiment_type: string; author_anonymous_id: string; run_ids: string[]; submitted_at: string; status: string; reviewer_count: number; reviews: object[]; average_score: number | null; consensus: string | null; decision: string | null; tags: string[]; }
export async function submitForReview(req: { title: string; abstract: string; experiment_type?: string; run_ids?: string[]; tags?: string[] }): Promise<PeerReviewSubmission> {
  const res = await fetch(apiUrl("/api/v1/peer-review/submit"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function submitReview(req: { submission_id: string; reviewer_token: string; reproducibility: number; scientific_rigor: number; novelty: number; presentation: number; statistical_validity: number; overall: number; recommendation: string; comments: string; strengths: string[]; weaknesses: string[] }): Promise<object> {
  const res = await fetch(apiUrl("/api/v1/peer-review/review"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listReviewSubmissions(status?: string): Promise<{ submissions: PeerReviewSubmission[]; total: number; by_status: Record<string, number> }> {
  const url = status ? `/api/v1/peer-review/?status=${status}` : "/api/v1/peer-review/";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Replication Market
// ─────────────────────────────────────────────────────────
export interface ReplicationClaim { claim_id: string; title: string; original_author: string; original_doi: string | null; original_value: number; metric: string; higher_is_better: boolean; n_qubits: number; backend: string; description: string; submitted_at: string; tags: string[]; status: string; replication_count: number; success_count: number; failure_count: number; partial_count: number; consensus_value: number | null; consensus_uncertainty: number | null; replication_rate: number; badge: string; attempts: object[]; }
export async function listReplicationClaims(badge?: string): Promise<{ claims: ReplicationClaim[]; total: number; replicated: number; contested: number }> {
  const url = badge ? `/api/v1/replication/?badge=${badge}` : "/api/v1/replication/";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List failed");
  return res.json();
}
export async function attemptReplication(req: { claim_id: string; your_value: number; your_uncertainty?: number; backend?: string; run_ids?: string[]; notes?: string }): Promise<object> {
  const res = await fetch(apiUrl("/api/v1/replication/attempt"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Collaboration Rooms
// ─────────────────────────────────────────────────────────
export interface CollabRoom { room_id: string; name: string; experiment_name: string; created_at: string; updated_at: string; status: string; participants: object[]; owner: string; current_params: Record<string, unknown>; current_circuit: string; annotations: object[]; chat: object[]; shared_analysis: Record<string, unknown>; }
export async function createCollabRoom(req: { name?: string; experiment_name?: string; owner?: string; initial_params?: Record<string, unknown> }): Promise<CollabRoom> {
  const res = await fetch(apiUrl("/api/v1/collab/create"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function joinCollabRoom(req: { room_id: string; username: string; role?: string }): Promise<CollabRoom> {
  const res = await fetch(apiUrl("/api/v1/collab/join"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function sendCollabChat(req: { room_id: string; username: string; message: string }): Promise<CollabRoom> {
  const res = await fetch(apiUrl("/api/v1/collab/chat"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function addCollabAnnotation(req: { room_id: string; username: string; text: string; color?: string }): Promise<CollabRoom> {
  const res = await fetch(apiUrl("/api/v1/collab/annotate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listCollabRooms(): Promise<{ rooms: object[] }> {
  const res = await fetch(apiUrl("/api/v1/collab/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List rooms failed");
  return res.json();
}
export async function getCollabRoom(roomId: string): Promise<CollabRoom> {
  const res = await fetch(apiUrl(`/api/v1/collab/${roomId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get room failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Calibration Forecast
// ─────────────────────────────────────────────────────────
export interface ForecastPoint { timestamp: string; hours_ahead: number; t1_predicted_us: number; t2_predicted_us: number; gate_error_predicted: number; confidence_lower: number; confidence_upper: number; alert_level: string; }
export interface CalForecast { forecast_id: string; backend: string; created_at: string; forecast_horizon_hours: number; current_t1_us: number; current_t2_us: number; current_gate_error: number; forecasts: ForecastPoint[]; optimal_window_start: string; optimal_window_end: string; degradation_alert: boolean; recovery_expected: boolean; recovery_eta_hours: number | null; model_r2: number; recommendations: string[]; }
export async function forecastCalibration(req: { backend?: string; horizon_hours?: number; alert_threshold_t1_us?: number; qubit?: number }): Promise<CalForecast> {
  const res = await fetch(apiUrl("/api/v1/cal-forecast/forecast"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Backend Emulator
// ─────────────────────────────────────────────────────────
export interface EmulationJob { job_id: string; source_backend: string; target_backend: string; n_qubits: number; circuit_depth: number; source_fidelity: number; emulated_fidelity: number; fidelity_delta: number; source_counts: Record<string, number>; emulated_counts: Record<string, number>; noise_model_mapping: Record<string, number>; connectivity_penalty: number; swap_overhead: number; cross_backend_agreement: number; confidence: number; warnings: string[]; recommendations: string[]; }
export async function emulateOnBackend(req: { source_backend: string; target_backend: string; n_qubits?: number; circuit_depth?: number; n_shots?: number; source_counts?: Record<string, number> }): Promise<EmulationJob> {
  const res = await fetch(apiUrl("/api/v1/backend-emulator/emulate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listEmulatorBackends(): Promise<{ backends: object[] }> {
  const res = await fetch(apiUrl("/api/v1/backend-emulator/backends"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List backends failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Job Scheduler
// ─────────────────────────────────────────────────────────
export interface ScheduleAssignment { circuit_id: string; backend: string; estimated_start: string; estimated_end: string; estimated_cost_usd: number; estimated_fidelity: number; queue_position: number; reason: string; score: number; }
export interface OptScheduleResult { schedule_id: string; created_at: string; objective: string; n_circuits: number; total_cost_usd: number; makespan_min: number; average_fidelity: number; assignments: ScheduleAssignment[]; savings_vs_random_usd: number; bottleneck_backend: string; utilization: Record<string, number>; recommendations: string[]; }
export async function optimizeJobSchedule(req: { circuits: { circuit_id: string; n_qubits: number; circuit_depth: number; n_shots: number; priority?: string }[]; objective?: string; budget_usd?: number }): Promise<OptScheduleResult> {
  const res = await fetch(apiUrl("/api/v1/job-scheduler/optimize"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Paper Draft
// ─────────────────────────────────────────────────────────
export interface PaperDraft { draft_id: string; created_at: string; title: string; journal_target: string; experiment_type: string; n_runs: number; abstract_text: string; introduction: string; results: string; discussion: string; conclusion: string; methods_section: string; figures: object[]; tables: object[]; bibtex: string; latex_source: string; word_count: number; estimated_pages: number; novelty_score: number; impact_estimate: string; suggested_journals: string[]; checklist: { item: string; done: boolean }[]; }
export async function generatePaperDraft(req: { title?: string; run_ids?: string[]; experiment_type?: string; journal_target?: string; key_metric?: string; key_value?: number; n_qubits?: number; backend?: string; comparison_baseline?: string; author_list?: string[] }): Promise<PaperDraft> {
  const res = await fetch(apiUrl("/api/v1/paper-draft/generate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getPaperDraft(draftId: string): Promise<PaperDraft> {
  const res = await fetch(apiUrl(`/api/v1/paper-draft/${draftId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get draft failed");
  return res.json();
}
export async function listPaperDrafts(): Promise<{ drafts: object[] }> {
  const res = await fetch(apiUrl("/api/v1/paper-draft/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List drafts failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// arXiv Radar
// ─────────────────────────────────────────────────────────
export interface ArxivRadarPaper { arxiv_id: string; title: string; authors: string[]; abstract: string; categories: string[]; submitted: string; relevance_score: number; keywords: string[]; cites_qlab_experiment: boolean; contradicts_hypothesis: boolean; confirms_hypothesis: boolean; circuit_available: boolean; doi: string; citations: number; }
export interface ArxivRadarWatch { watch_id: string; created_at: string; name: string; keywords: string[]; authors: string[]; categories: string[]; alert_on_contradiction: boolean; alert_on_confirmation: boolean; alert_on_citation: boolean; min_relevance: number; active: boolean; alert_count: number; }
export interface ArxivRadarAlert { alert_id: string; watch_id: string; paper_arxiv_id: string; paper_title: string; alert_type: string; relevance_score: number; triggered_at: string; summary: string; action_recommended: string; }
export async function createArxivWatch(req: { name?: string; keywords?: string[]; categories?: string[]; alert_on_contradiction?: boolean; alert_on_confirmation?: boolean; min_relevance?: number }): Promise<ArxivRadarWatch> {
  const res = await fetch(apiUrl("/api/v1/arxiv-radar/watch"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function searchArxivRadar(req: { query?: string; keywords?: string[]; categories?: string[]; min_relevance?: number }): Promise<{ results: ArxivRadarPaper[]; total: number; trending_keywords: string[] }> {
  const res = await fetch(apiUrl("/api/v1/arxiv-radar/search"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getArxivAlerts(watchId?: string): Promise<{ alerts: ArxivRadarAlert[]; total: number; by_type: Record<string, number> }> {
  const url = watchId ? `/api/v1/arxiv-radar/alerts?watch_id=${watchId}` : "/api/v1/arxiv-radar/alerts";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get alerts failed");
  return res.json();
}
export async function getArxivFeed(category?: string): Promise<{ papers: ArxivRadarPaper[]; total: number; trending: string[] }> {
  const url = category ? `/api/v1/arxiv-radar/feed?category=${category}` : "/api/v1/arxiv-radar/feed";
  const res = await fetch(apiUrl(url), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Get feed failed");
  return res.json();
}
export async function listArxivWatches(): Promise<{ watches: ArxivRadarWatch[]; total: number }> {
  const res = await fetch(apiUrl("/api/v1/arxiv-radar/watches"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("List watches failed");
  return res.json();
}
export async function submitReplicationClaim(req: { title: string; original_value: number; metric: string; methodology?: string; run_id?: string; description?: string; backend?: string; n_qubits?: number }): Promise<ReplicationClaim> {
  const res = await fetch(apiUrl("/api/v1/replication/claim"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Foundation Model (QFM)
// ─────────────────────────────────────────────────────────
export interface QFMCitation { arxiv_id: string; title: string; relevance: number; }
export interface QFMSession { session_id: string; reply: string; confidence: number; citations: QFMCitation[]; suggested_experiments: string[]; predicted_fidelity?: number; physics_check: { valid: boolean; warnings: string[] }; follow_ups: string[]; }
export interface QFMFidelityPrediction { predicted_fidelity: number; uncertainty: number; confidence_interval: [number, number]; dominant_noise: string; mitigation_recommended: string; improvement_potential: number; }
export interface QFMAnomalyExplanation { explanation: string; probable_causes: { cause: string; probability: number; evidence: string }[]; resolution_steps: string[]; similar_cases: string[]; }
export async function chatQFM(req: { session_id?: string; message: string; context?: Record<string, unknown> }): Promise<QFMSession> {
  const res = await fetch(apiUrl("/api/v1/qfm/chat"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function predictFidelityQFM(req: { circuit_qasm: string; backend: string; n_qubits: number; depth: number }): Promise<QFMFidelityPrediction> {
  const res = await fetch(apiUrl("/api/v1/qfm/predict-fidelity"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function explainAnomalyQFM(req: { run_id: string; observed_value: number; expected_value: number; backend: string; context?: string }): Promise<QFMAnomalyExplanation> {
  const res = await fetch(apiUrl("/api/v1/qfm/explain-anomaly"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Auto-Mitigation Selector
// ─────────────────────────────────────────────────────────
export interface AutoMitigationTechnique { name: string; order: number; params: Record<string, unknown>; expected_improvement: number; overhead: number; }
export interface MitigationRecommendation { recommendation_id: string; strategy: string; techniques: AutoMitigationTechnique[]; combined_overhead: number; predicted_fidelity: number; confidence: number; reasoning: string; alternatives: { strategy: string; fidelity: number; overhead: number }[]; }
export interface MitigationApplication { mitigated_value: number; raw_value: number; improvement_pct: number; technique_contributions: Record<string, number>; total_overhead: number; }
export async function selectMitigation(req: { n_qubits: number; circuit_depth: number; backend: string; noise_model?: string; budget_overhead?: number; target_fidelity?: number }): Promise<MitigationRecommendation> {
  const res = await fetch(apiUrl("/api/v1/auto-mitigation/select"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function applyMitigationStrategy(req: { recommendation_id: string; circuit_counts: Record<string, number> }): Promise<MitigationApplication> {
  const res = await fetch(apiUrl("/api/v1/auto-mitigation/apply"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Anomaly Physics Engine
// ─────────────────────────────────────────────────────────
export interface PhysicsViolation { rule: string; severity: string; observed: number; limit: number; explanation: string; }
export interface PhysicsCheck { check_id: string; violations: PhysicsViolation[]; warnings: { rule: string; message: string }[]; passed: string[]; overall_valid: boolean; physics_score: number; }
export interface LiteratureComparison { comparison_id: string; percentile: number; better_than_pct: number; similar_papers: { arxiv_id: string; title: string; value: number; year: number }[]; assessment: string; is_record: boolean; record_holder?: string; }
export async function checkPhysicsConstraints(req: { t1_us?: number; t2_us?: number; gate_fidelity?: number; readout_fidelity?: number; energy?: number; fidelity?: number; backend?: string; n_qubits?: number }): Promise<PhysicsCheck> {
  const res = await fetch(apiUrl("/api/v1/anomaly-physics/check"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function compareToLiterature(req: { metric: string; value: number; backend: string; n_qubits: number; algorithm: string }): Promise<LiteratureComparison> {
  const res = await fetch(apiUrl("/api/v1/anomaly-physics/compare-literature"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getPhysicsRules(): Promise<{ rules: { name: string; description: string; category: string }[] }> {
  const res = await fetch(apiUrl("/api/v1/anomaly-physics/rules"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Circuit AI Debugger
// ─────────────────────────────────────────────────────────
export interface CircuitBug { line: number; type: string; severity: string; description: string; fix: string; }
export interface AICircuitDebugResult { debug_id: string; bugs: CircuitBug[]; warnings: { line: number; message: string }[]; suggestions: string[]; circuit_stats: { n_qubits: number; depth: number; gate_count: number; two_qubit_gates: number; t_gates: number }; score: number; }
export interface CircuitOptimizeResult { original_depth: number; optimized_depth: number; original_gates: number; optimized_gates: number; depth_reduction_pct: number; optimized_qasm: string; optimizations_applied: string[]; fidelity_improvement: number; }
export interface CircuitAIExplanation { explanation: string; step_by_step: { gate: string; qubits: number[]; purpose: string }[]; algorithm_detected?: string; use_case: string; }
export async function debugCircuitAI(req: { circuit_qasm: string; n_qubits?: number; backend?: string }): Promise<AICircuitDebugResult> {
  const res = await fetch(apiUrl("/api/v1/circuit-ai/debug"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function optimizeCircuitAI(req: { circuit_qasm: string; backend?: string; objective?: string }): Promise<CircuitOptimizeResult> {
  const res = await fetch(apiUrl("/api/v1/circuit-ai/optimize"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function explainCircuitAI(req: { circuit_qasm: string; detail_level?: string }): Promise<CircuitAIExplanation> {
  const res = await fetch(apiUrl("/api/v1/circuit-ai/explain"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Global Calibration Database
// ─────────────────────────────────────────────────────────
export interface GlobalCalRecord { record_id: string; backend: string; qubit: number; t1_us: number; t2_us: number; gate_error: number; readout_error: number; timestamp: string; institution?: string; contributor?: string; }
export interface BackendCommunityCalibration { backend: string; records: GlobalCalRecord[]; community_t1_median: number; community_t2_median: number; community_gate_error_median: number; trend: string; n_contributors: number; last_updated: string; forecast_next_24h: { t1: number; t2: number }; }
export async function contributeCalibration(req: { backend: string; qubit: number; t1_us: number; t2_us: number; gate_error: number; readout_error: number; timestamp?: string; institution?: string }): Promise<GlobalCalRecord> {
  const res = await fetch(apiUrl("/api/v1/global-cal/contribute"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getBackendCommunityCalibration(backend: string): Promise<BackendCommunityCalibration> {
  const res = await fetch(apiUrl(`/api/v1/global-cal/backend/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getCalLeaderboard(): Promise<{ leaderboard: { rank: number; backend: string; median_t2_us: number; n_contributors: number }[] }> {
  const res = await fetch(apiUrl("/api/v1/global-cal/leaderboard"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function compareCalibration(req: { backend: string; your_t1: number; your_t2: number }): Promise<{ your_percentile_t1: number; your_percentile_t2: number; community_average: Record<string, number>; assessment: string }> {
  const res = await fetch(apiUrl("/api/v1/global-cal/compare"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Benchmark Leaderboard
// ─────────────────────────────────────────────────────────
export interface LeaderboardEntry { backend: string; qaoa_ratio: number; vqe_fidelity: number; qft_fidelity: number; ghz_fidelity: number; mirror_fidelity: number; overall_score: number; rank: number; last_updated: string; trend: string; }
export async function getBenchmarkLeaderboard(): Promise<{ benchmarks: LeaderboardEntry[]; last_run: string; total_backends: number }> {
  const res = await fetch(apiUrl("/api/v1/benchmark-leaderboard/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getBenchmarkBackendHistory(backend: string): Promise<{ backend: string; history: { date: string; score: number }[]; benchmarks: LeaderboardEntry }> {
  const res = await fetch(apiUrl(`/api/v1/benchmark-leaderboard/backend/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function submitBenchmark(req: { backend: string; benchmark_type: string; value: number; n_qubits: number; circuit_depth?: number }): Promise<{ rank: number; message: string }> {
  const res = await fetch(apiUrl("/api/v1/benchmark-leaderboard/submit"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getBenchmarkRecords(): Promise<{ records: { benchmark: string; backend: string; value: number; date: string }[] }> {
  const res = await fetch(apiUrl("/api/v1/benchmark-leaderboard/records"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Social Graph
// ─────────────────────────────────────────────────────────
export interface QuantumProfile { username: string; institution: string; research_areas: string[]; bio?: string; followers: number; following: number; recent_activity: { type: string; description: string; date: string }[]; }
export interface SocialNotification { notification_id: string; user: string; type: string; message: string; link?: string; created_at: string; read: boolean; }
export async function createSocialProfile(req: { username: string; institution: string; research_areas: string[]; bio?: string }): Promise<QuantumProfile> {
  const res = await fetch(apiUrl("/api/v1/social/profile"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function followResearcher(req: { follower: string; following: string }): Promise<{ message: string }> {
  const res = await fetch(apiUrl("/api/v1/social/follow"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getSocialFeed(username: string): Promise<{ feed: { type: string; actor: string; description: string; date: string; link?: string }[] }> {
  const res = await fetch(apiUrl(`/api/v1/social/feed/${username}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getSocialNotifications(username: string): Promise<{ notifications: SocialNotification[] }> {
  const res = await fetch(apiUrl(`/api/v1/social/notifications/${username}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getSocialProfile(username: string): Promise<QuantumProfile> {
  const res = await fetch(apiUrl(`/api/v1/social/profile/${username}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function discoverResearchers(): Promise<{ suggestions: QuantumProfile[] }> {
  const res = await fetch(apiUrl("/api/v1/social/discover"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// One-Click Paper Replication
// ─────────────────────────────────────────────────────────
export interface PaperReplicationJob { replication_id: string; paper_title: string; paper_authors: string[]; main_claim: string; extracted_circuit_qasm?: string; n_qubits?: number; backend_used: string; status: string; started_at: string; original_value?: number; replicated_value?: number; deviation_sigma?: number; verdict?: string; verdict_detail?: string; statistical_test?: string; p_value?: number; circuit_ran?: boolean; issues?: string[]; }
export async function startPaperReplication(req: { arxiv_url: string; backend?: string; n_shots?: number }): Promise<PaperReplicationJob> {
  const res = await fetch(apiUrl("/api/v1/paper-replication/start"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getPaperReplicationJob(replicationId: string): Promise<PaperReplicationJob> {
  const res = await fetch(apiUrl(`/api/v1/paper-replication/${replicationId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function listPaperReplications(): Promise<{ replications: PaperReplicationJob[] }> {
  const res = await fetch(apiUrl("/api/v1/paper-replication/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Bayesian Uncertainty Propagation
// ─────────────────────────────────────────────────────────
export interface BayesUncertaintyResult { posterior_mean: number; posterior_std: number; credible_interval_95: [number, number]; credible_interval_68: [number, number]; posterior_samples: number[]; prior_used: string; likelihood: string; effective_sample_size: number; convergence: boolean; skewness: number; kurtosis: number; }
export interface BayesComparison { bayes_factor: number; evidence_for_a: number; evidence_for_b: number; interpretation: string; posterior_overlap: number; effect_size: number; }
export async function propagateBayesUncertainty(req: { counts: Record<string, number>; n_shots: number; prior?: string; likelihood?: string; n_qubits?: number }): Promise<BayesUncertaintyResult> {
  const res = await fetch(apiUrl("/api/v1/bayes-uncertainty/propagate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function compareBayesian(req: { experiment_a: Record<string, unknown>; experiment_b: Record<string, unknown> }): Promise<BayesComparison> {
  const res = await fetch(apiUrl("/api/v1/bayes-uncertainty/compare"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Multiple Comparisons Corrector
// ─────────────────────────────────────────────────────────
export interface MCorrectionItem { label: string; original_p: number; corrected_p: number; significant: boolean; rank: number; }
export interface MCorrectionResult { method: string; alpha: number; results: MCorrectionItem[]; n_significant: number; n_total: number; fdr_q: number; family_wise_error: number; recommendations: string[]; }
export interface PowerAnalysisResult { required_n: number; achievable_power: number; minimum_detectable_effect: number; current_power?: number; }
export interface MetaAnalysisResult { fixed_effect_estimate: number; fixed_effect_se: number; random_effect_estimate: number; random_effect_se: number; heterogeneity_i2: number; heterogeneity_tau2: number; p_value: number; forest_data: { study: string; value: number; lower: number; upper: number }[]; }
export async function correctMultipleComparisons(req: { p_values: number[]; method?: string; alpha?: number; labels?: string[] }): Promise<MCorrectionResult> {
  const res = await fetch(apiUrl("/api/v1/multi-comparisons/correct"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function runPowerAnalysis(req: { effect_size: number; alpha?: number; power?: number; n_groups?: number }): Promise<PowerAnalysisResult> {
  const res = await fetch(apiUrl("/api/v1/multi-comparisons/power-analysis"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function runMetaAnalysis(req: { studies: { value: number; uncertainty: number; n_shots: number }[] }): Promise<MetaAnalysisResult> {
  const res = await fetch(apiUrl("/api/v1/multi-comparisons/meta-analysis"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// FAIR Data Compliance Engine
// ─────────────────────────────────────────────────────────
export interface FAIRScore { findable: number; accessible: number; interoperable: number; reusable: number; total: number; }
export interface FAIRRecord { record_id: string; doi: string; ro_crate_json: Record<string, unknown>; datacite_xml: string; zenodo_metadata: Record<string, unknown>; fair_score: FAIRScore; checklist: { item: string; done: boolean; recommendation: string }[]; landing_page_url: string; }
export async function generateFAIRRecord(req: { title: string; description: string; algorithm: string; backend: string; n_qubits: number; n_shots: number; fidelity?: number; run_ids?: string[] }): Promise<FAIRRecord> {
  const res = await fetch(apiUrl("/api/v1/fair-data/generate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function validateFAIR(req: { metadata: Record<string, unknown> }): Promise<{ fair_score: FAIRScore; issues: string[] }> {
  const res = await fetch(apiUrl("/api/v1/fair-data/validate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getFAIRRecord(recordId: string): Promise<FAIRRecord> {
  const res = await fetch(apiUrl(`/api/v1/fair-data/${recordId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function listFAIRRecords(): Promise<{ records: FAIRRecord[] }> {
  const res = await fetch(apiUrl("/api/v1/fair-data/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Causal Inference Engine
// ─────────────────────────────────────────────────────────
export interface CausalAnalysisResult { causal_id: string; ate: number; ate_std: number; p_value: number; confidence_interval: [number, number]; method_used: string; refutation_results: { test: string; passed: boolean; p_value: number }[]; confounders_detected: string[]; causal_graph_nodes: string[]; causal_graph_edges: { from: string; to: string; type: string }[]; interpretation: string; }
export async function runCausalAnalysis(req: { treatment: string; outcome: string; covariates: string[]; data: Record<string, unknown>[]; method?: string }): Promise<CausalAnalysisResult> {
  const res = await fetch(apiUrl("/api/v1/causal/analyze"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function identifyConfounders(req: { variables: string[]; outcome: string; experiment_log: Record<string, unknown>[] }): Promise<{ confounders: { variable: string; evidence: string; strength: number }[] }> {
  const res = await fetch(apiUrl("/api/v1/causal/identify-confounders"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Research Pipeline
// ─────────────────────────────────────────────────────────
export interface PipelineStage { name: string; status: string; started_at?: string; completed_at?: string; artifacts: string[]; notes: string; auto_checks: { check: string; passed: boolean }[]; }
export interface ResearchPipeline { pipeline_id: string; title: string; hypothesis: string; algorithm: string; backend: string; success_criteria: string; created_at: string; stages: PipelineStage[]; current_stage: string; overall_completion_pct: number; }
export async function createResearchPipeline(req: { title: string; hypothesis: string; algorithm: string; backend: string; success_criteria: string }): Promise<ResearchPipeline> {
  const res = await fetch(apiUrl("/api/v1/research-pipeline/create"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function advanceResearchPipeline(pipelineId: string): Promise<ResearchPipeline> {
  const res = await fetch(apiUrl(`/api/v1/research-pipeline/${pipelineId}/advance`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getResearchPipeline(pipelineId: string): Promise<ResearchPipeline> {
  const res = await fetch(apiUrl(`/api/v1/research-pipeline/${pipelineId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function listResearchPipelines(): Promise<{ pipelines: ResearchPipeline[] }> {
  const res = await fetch(apiUrl("/api/v1/research-pipeline/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Grant Proposal Generator
// ─────────────────────────────────────────────────────────
export interface GrantProposal { proposal_id: string; title: string; agency: string; sections: { specific_aims: string; significance: string; innovation: string; approach: string; preliminary_results: string; broader_impacts: string; budget_justification: string }; total_word_count: number; estimated_page_count: number; recommended_program: string; success_probability: number; checklist: { item: string; done: boolean }[]; }
export async function generateGrantProposal(req: { title: string; agency: string; program?: string; pi_name: string; institution: string; key_results: string[]; algorithm: string; backend: string; n_qubits: number; fidelity?: number; budget_total?: number; duration_years?: number }): Promise<GrantProposal> {
  const res = await fetch(apiUrl("/api/v1/grant-proposal/generate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getGrantProposal(proposalId: string): Promise<GrantProposal> {
  const res = await fetch(apiUrl(`/api/v1/grant-proposal/${proposalId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function listGrantProposals(): Promise<{ proposals: GrantProposal[] }> {
  const res = await fetch(apiUrl("/api/v1/grant-proposal/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// RB / GST / SPAM Suite
// ─────────────────────────────────────────────────────────
export interface RBResult { rb_id: string; backend: string; qubit: number; sequence_lengths: number[]; survival_probabilities: number[]; error_per_clifford: number; error_per_gate: number; t_gate_infidelity: number; fit_r_squared: number; confidence_interval: [number, number]; decay_constant: number; coherence_limit: number; }
export interface SPAMResult { spam_id: string; state_prep_error: number; measurement_error: number; spam_matrix: number[][]; confusion_matrix: number[][]; f_spam: number; recommendations: string[]; }
export interface RBGSTXEBResult { xeb_id: string; backend: string; n_qubits: number; circuit_depths: number[]; xeb_fidelities: number[]; linear_xeb_per_cycle: number; fit_r_squared: number; }
export async function runRandomizedBenchmarking(req: { backend: string; qubit?: number; max_sequence_length?: number; n_sequences?: number }): Promise<RBResult> {
  const res = await fetch(apiUrl("/api/v1/rb-gst/rb"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function runSPAMCharacterization(req: { backend: string; n_qubits?: number }): Promise<SPAMResult> {
  const res = await fetch(apiUrl("/api/v1/rb-gst/spam"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function runXEBSuite(req: { backend: string; n_qubits: number; max_depth?: number }): Promise<RBGSTXEBResult> {
  const res = await fetch(apiUrl("/api/v1/rb-gst/xeb"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getRBGSTReport(backend: string): Promise<{ backend: string; rb: RBResult | null; spam: SPAMResult | null; xeb: RBGSTXEBResult | null; summary: string }> {
  const res = await fetch(apiUrl(`/api/v1/rb-gst/report/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Universal Quantum Transpiler Hub
// ─────────────────────────────────────────────────────────
export interface TranslationResult { translation_id: string; source_sdk: string; target_sdk: string; original_circuit: string; translated_circuit: string; original_gate_count: number; translated_gate_count: number; equivalence_score: number; warnings: string[]; notes: string[]; }
export async function translateCircuit(req: { circuit: string; source_sdk: string; target_sdk: string; optimize?: boolean; backend?: string }): Promise<TranslationResult> {
  const res = await fetch(apiUrl("/api/v1/transpiler-hub/translate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function detectCircuitSDK(req: { circuit: string }): Promise<{ detected_sdk: string; confidence: number; indicators: string[] }> {
  const res = await fetch(apiUrl("/api/v1/transpiler-hub/detect"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listSupportedSDKs(): Promise<{ sdks: { name: string; version: string; description: string }[] }> {
  const res = await fetch(apiUrl("/api/v1/transpiler-hub/sdks"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// HPC Hybrid Bridge
// ─────────────────────────────────────────────────────────
export interface HPCJob { job_id: string; name: string; scheduler: string; n_nodes: number; n_cores_per_node: number; memory_gb: number; walltime_hours: number; status: string; submitted_at: string; estimated_start?: string; started_at?: string; completed_at?: string; quantum_run_id?: string; stdout_excerpt?: string; slurm_id?: string; queue_position?: number; node_allocation?: string; }
export async function submitHPCJob(req: { name: string; scheduler: string; n_nodes: number; n_cores_per_node: number; memory_gb: number; walltime_hours: number; script: string; quantum_run_id?: string; partition?: string }): Promise<HPCJob> {
  const res = await fetch(apiUrl("/api/v1/hpc-bridge/job"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getHPCJob(jobId: string): Promise<HPCJob> {
  const res = await fetch(apiUrl(`/api/v1/hpc-bridge/job/${jobId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function cancelHPCJob(jobId: string): Promise<{ message: string }> {
  const res = await fetch(apiUrl(`/api/v1/hpc-bridge/job/${jobId}/cancel`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listHPCJobs(): Promise<{ jobs: HPCJob[] }> {
  const res = await fetch(apiUrl("/api/v1/hpc-bridge/jobs"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function listHPCClusters(): Promise<{ clusters: { name: string; scheduler: string; available_nodes: number; typical_wait_min: number; partitions: string[] }[] }> {
  const res = await fetch(apiUrl("/api/v1/hpc-bridge/clusters"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Circuit Marketplace
// ─────────────────────────────────────────────────────────
export interface MarketplaceListing { listing_id: string; title: string; description: string; category: string; tags: string[]; price_usd: number; author: string; license: string; created_at: string; downloads: number; rating: number; review_count: number; circuit_qasm?: string; }
export async function createMarketplaceListing(req: { title: string; description: string; circuit_qasm: string; category: string; tags: string[]; price_usd: number; author: string; license: string }): Promise<MarketplaceListing> {
  const res = await fetch(apiUrl("/api/v1/circuit-marketplace/listing"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listMarketplace(params?: { category?: string; max_price?: number; sort?: string }): Promise<{ listings: MarketplaceListing[]; total: number }> {
  const p = new URLSearchParams();
  if (params?.category) p.set("category", params.category);
  if (params?.max_price != null) p.set("max_price", String(params.max_price));
  if (params?.sort) p.set("sort", params.sort);
  const res = await fetch(apiUrl(`/api/v1/circuit-marketplace/?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function purchaseMarketplaceListing(listingId: string, buyer: string): Promise<{ purchase_id: string; circuit_qasm: string; message: string }> {
  const res = await fetch(apiUrl(`/api/v1/circuit-marketplace/${listingId}/purchase`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ buyer }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function reviewMarketplaceListing(req: { listing_id: string; reviewer: string; rating: number; comment: string }): Promise<{ message: string }> {
  const res = await fetch(apiUrl(`/api/v1/circuit-marketplace/${req.listing_id}/review`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listMarketplaceCategories(): Promise<{ categories: { name: string; count: number }[] }> {
  const res = await fetch(apiUrl("/api/v1/circuit-marketplace/categories"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Institute Dashboard
// ─────────────────────────────────────────────────────────
export interface Institute { institute_id: string; name: string; pi: string; members: string[]; budget_usd?: number; created_at: string; }
export interface InstituteDashboard { institute: Institute; total_runs: number; total_cost_usd: number; budget_remaining?: number; by_member: { member: string; runs: number; cost: number; last_active: string }[]; by_backend: Record<string, number>; by_algorithm: Record<string, number>; productivity_score: number; avg_fidelity: number; publications: number; replications: number; top_result: string; activity_heatmap: { date: string; count: number }[]; }
export async function setupInstitute(req: { name: string; pi: string; members: string[]; budget_usd?: number }): Promise<Institute> {
  const res = await fetch(apiUrl("/api/v1/institute/setup"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getInstituteDashboard(instituteId: string): Promise<InstituteDashboard> {
  const res = await fetch(apiUrl(`/api/v1/institute/${instituteId}/dashboard`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function logInstituteActivity(req: { institute_id: string; member: string; activity_type: string; cost_usd?: number; backend?: string; run_id?: string }): Promise<{ message: string }> {
  const res = await fetch(apiUrl("/api/v1/institute/log-activity"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listInstitutes(): Promise<{ institutes: Institute[] }> {
  const res = await fetch(apiUrl("/api/v1/institute/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Offline / Air-Gap Export
// ─────────────────────────────────────────────────────────
export interface OfflineExport { export_id: string; status: string; estimated_size_mb: number; components: { name: string; size_mb: number; included: boolean }[]; docker_compose_yaml: string; readme: string; checksum?: string; download_url?: string; classification_level?: string; }
export async function createOfflineExport(req: { include_data: boolean; include_models: boolean; format: string; classification_level?: string }): Promise<OfflineExport> {
  const res = await fetch(apiUrl("/api/v1/offline-export/export"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getOfflineExportStatus(exportId: string): Promise<OfflineExport> {
  const res = await fetch(apiUrl(`/api/v1/offline-export/${exportId}/status`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getExportRequirements(): Promise<{ cpu_cores: number; ram_gb: number; disk_gb: number; os: string[]; docker_version: string; notes: string[] }> {
  const res = await fetch(apiUrl("/api/v1/offline-export/requirements"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Pulse-Level Control  /api/v1/pulse-control
// ─────────────────────────────────────────────────────────
export interface PulseWaveform { waveform_id: string; name: string; type: string; duration_ns: number; amplitude: number; sigma_ns?: number; beta?: number; }
export interface PulseChannel { channel_id: string; name: string; type: string; frequency_ghz: number; qubit: number; }
export interface PulseSchedule { schedule_id: string; name: string; backend: string; channels: PulseChannel[]; waveforms: PulseWaveform[]; total_duration_ns: number; gate_fidelity_estimate: number; created_at: string; }
export interface PulseSimResult { simulation_id: string; schedule_id: string; backend: string; state_fidelity: number; leakage: number; control_error: number; bloch_trajectory: Record<string, number>[]; duration_ns: number; }
export async function schedulePulse(req: { name: string; backend: string; n_qubits: number; gates: string[]; optimize_drag?: boolean }): Promise<PulseSchedule> {
  const res = await fetch(apiUrl("/api/v1/pulse-control/schedule"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listPulseSchedules(): Promise<PulseSchedule[]> {
  const res = await fetch(apiUrl("/api/v1/pulse-control/schedules"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function simulatePulse(req: { schedule_id: string; n_shots?: number }): Promise<PulseSimResult> {
  const res = await fetch(apiUrl("/api/v1/pulse-control/simulate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getBackendNativeGates(name: string): Promise<{ backend: string; native_gates: string[]; basis_gates: string[]; qubit_count: number }> {
  const res = await fetch(apiUrl(`/api/v1/pulse-control/backends/${name}/native-gates`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Blind Analysis  /api/v1/blind-analysis
// ─────────────────────────────────────────────────────────
export interface AnalysisRegistration { reg_id: string; title: string; hypothesis: string; methods: string; primary_outcome: string; secondary_outcomes: string[]; registered_at: string; status: string; blinded_data_hash?: string; reveal_timestamp?: string; results_summary?: string; confirmed_hypothesis?: boolean; }
export interface RevealResult { reg_id: string; confirmed_hypothesis: boolean; effect_size: number; p_value: number; confidence_interval: number[]; result_summary: string; revealed_at: string; }
export async function registerAnalysis(req: { title: string; hypothesis: string; methods: string; primary_outcome: string; secondary_outcomes: string[] }): Promise<AnalysisRegistration> {
  const res = await fetch(apiUrl("/api/v1/blind-analysis/register"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listAnalysisRegistrations(): Promise<AnalysisRegistration[]> {
  const res = await fetch(apiUrl("/api/v1/blind-analysis/registrations"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getAnalysisRegistration(regId: string): Promise<AnalysisRegistration> {
  const res = await fetch(apiUrl(`/api/v1/blind-analysis/registration/${regId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function revealAnalysis(regId: string, req: { effect_size: number; p_value: number; confidence_interval: number[]; result_summary: string }): Promise<RevealResult> {
  const res = await fetch(apiUrl(`/api/v1/blind-analysis/${regId}/reveal`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Optimal Experiment Design  /api/v1/oed
// ─────────────────────────────────────────────────────────
export interface ExperimentDesign { design_id: string; name: string; experiment_type: string; n_qubits: number; target_precision: number; optimal_shots: number; fisher_information: number; cramer_rao_bound: number; recommended_circuits: string[]; estimated_runtime_min: number; created_at: string; }
export interface OEDSimulatedOutcome { outcome_id: string; design_id: string; achieved_precision: number; achieved_fidelity: number; total_shots_used: number; runtime_min: number; converged: boolean; }
export async function designExperiment(req: { name: string; experiment_type: string; n_qubits: number; target_precision: number; budget_shots: number }): Promise<ExperimentDesign> {
  const res = await fetch(apiUrl("/api/v1/oed/design"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listExperimentDesigns(): Promise<ExperimentDesign[]> {
  const res = await fetch(apiUrl("/api/v1/oed/designs"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getExperimentDesign(designId: string): Promise<ExperimentDesign> {
  const res = await fetch(apiUrl(`/api/v1/oed/design/${designId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function simulateOED(req: { design_id: string; noise_level?: number }): Promise<OEDSimulatedOutcome> {
  const res = await fetch(apiUrl("/api/v1/oed/simulate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Full Meta-Analysis  /api/v1/meta-analysis
// ─────────────────────────────────────────────────────────
export interface MetaStudy { study_id: string; title: string; authors: string[]; year: number; effect_size: number; std_error: number; sample_size: number; backend: string; metric: string; doi?: string; added_at: string; }
export interface FullMetaAnalysisResult { analysis_id: string; name: string; metric: string; studies: string[]; pooled_effect: number; pooled_se: number; i_squared: number; q_statistic: number; p_heterogeneity: number; z_score: number; p_value: number; confidence_interval_95: number[]; model: string; forest_plot_data: Record<string, unknown>[]; created_at: string; }
export async function addMetaStudy(req: { title: string; authors: string[]; year: number; effect_size: number; std_error: number; sample_size: number; backend: string; metric: string; doi?: string }): Promise<MetaStudy> {
  const res = await fetch(apiUrl("/api/v1/meta-analysis/study"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listMetaStudies(): Promise<MetaStudy[]> {
  const res = await fetch(apiUrl("/api/v1/meta-analysis/studies"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function runFullMetaAnalysis(req: { name: string; metric: string; study_ids: string[]; model?: string }): Promise<FullMetaAnalysisResult> {
  const res = await fetch(apiUrl("/api/v1/meta-analysis/analyze"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listFullMetaAnalyses(): Promise<FullMetaAnalysisResult[]> {
  const res = await fetch(apiUrl("/api/v1/meta-analysis/analyses"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getFullMetaAnalysis(analysisId: string): Promise<FullMetaAnalysisResult> {
  const res = await fetch(apiUrl(`/api/v1/meta-analysis/analysis/${analysisId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Dataset Publisher  /api/v1/dataset-publish
// ─────────────────────────────────────────────────────────
export interface DatasetPublication { pub_id: string; title: string; description: string; repository: string; license: string; keywords: string[]; authors: string[]; run_ids: string[]; status: string; doi?: string; url?: string; file_size_mb: number; record_count: number; created_at: string; published_at?: string; }
export interface DOIMintResult { pub_id: string; doi: string; url: string; record_id: string; minted_at: string; }
export async function publishDataset(req: { title: string; description: string; repository: string; license: string; keywords: string[]; authors: string[]; run_ids: string[] }): Promise<DatasetPublication> {
  const res = await fetch(apiUrl("/api/v1/dataset-publish/publish"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listDatasetPublications(): Promise<DatasetPublication[]> {
  const res = await fetch(apiUrl("/api/v1/dataset-publish/publications"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getDatasetPublication(pubId: string): Promise<DatasetPublication> {
  const res = await fetch(apiUrl(`/api/v1/dataset-publish/publication/${pubId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function mintDOI(pubId: string): Promise<DOIMintResult> {
  const res = await fetch(apiUrl(`/api/v1/dataset-publish/${pubId}/mint-doi`), { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// RL Circuit Optimizer  /api/v1/rl-optimizer
// ─────────────────────────────────────────────────────────
export interface RLSession { session_id: string; name: string; backend: string; n_qubits: number; algorithm: string; objective: string; episodes: number; status: string; best_reward: number; initial_circuit_depth: number; optimized_circuit_depth: number; depth_reduction_pct: number; gate_fidelity_improvement: number; training_curve: number[]; created_at: string; completed_at?: string; }
export interface RLOptimizedCircuit { opt_id: string; session_id: string; original_qasm: string; optimized_qasm: string; original_depth: number; optimized_depth: number; original_gate_count: number; optimized_gate_count: number; estimated_fidelity_gain: number; applied_at: string; }
export async function trainRLOptimizer(req: { name: string; backend: string; n_qubits: number; algorithm: string; objective: string; episodes?: number }): Promise<RLSession> {
  const res = await fetch(apiUrl("/api/v1/rl-optimizer/train"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listRLSessions(): Promise<RLSession[]> {
  const res = await fetch(apiUrl("/api/v1/rl-optimizer/sessions"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getRLSession(sessionId: string): Promise<RLSession> {
  const res = await fetch(apiUrl(`/api/v1/rl-optimizer/session/${sessionId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function applyRLOptimizer(req: { session_id: string; circuit_qasm: string }): Promise<RLOptimizedCircuit> {
  const res = await fetch(apiUrl("/api/v1/rl-optimizer/apply"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Synthetic Quantum Data  /api/v1/synthetic-data
// ─────────────────────────────────────────────────────────
export interface SyntheticDataset { dataset_id: string; name: string; type: string; n_samples: number; n_features: number; n_qubits: number; noise_level: number; backend_model: string; label_distribution: Record<string, number>; feature_stats: Record<string, number>; preview: Record<string, unknown>[]; download_url: string; size_mb: number; created_at: string; }
export interface SyntheticDatasetStats { dataset_id: string; mean_fidelity: number; std_fidelity: number; class_balance: Record<string, number>; circuit_depth_range: number[]; gate_count_range: number[]; }
export async function generateSyntheticData(req: { name: string; type: string; n_samples: number; n_qubits: number; noise_level?: number; backend_model?: string; seed?: number }): Promise<SyntheticDataset> {
  const res = await fetch(apiUrl("/api/v1/synthetic-data/generate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listSyntheticDatasets(): Promise<SyntheticDataset[]> {
  const res = await fetch(apiUrl("/api/v1/synthetic-data/datasets"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getSyntheticDataset(datasetId: string): Promise<SyntheticDataset> {
  const res = await fetch(apiUrl(`/api/v1/synthetic-data/dataset/${datasetId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getSyntheticDatasetStats(datasetId: string): Promise<SyntheticDatasetStats> {
  const res = await fetch(apiUrl(`/api/v1/synthetic-data/dataset/${datasetId}/stats`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Live Backend Monitor  /api/v1/live-monitor
// ─────────────────────────────────────────────────────────
export interface LiveBackendStatus { backend: string; operational: boolean; queue_depth: number; avg_wait_min: number; t1_us: number; t2_us: number; readout_error: number; cx_error: number; last_calibrated: string; alert_level: string; }
export interface BackendQueueSnapshot { backend: string; snapshot_id: string; queue_depth: number; estimated_wait_min: number; jobs_running: number; jobs_pending: number; peak_today: number; taken_at: string; }
export interface CalibrationDriftEvent { backend: string; qubit: number; metric: string; value: number; baseline: number; drift_pct: number; timestamp: string; alert: boolean; }
export interface MonitorAlertSubscription { sub_id: string; backend: string; threshold_t1_us?: number; threshold_cx_error?: number; email?: string; created_at: string; }
export async function getLiveStatus(): Promise<LiveBackendStatus[]> {
  const res = await fetch(apiUrl("/api/v1/live-monitor/status"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getQueueSnapshot(backend: string): Promise<BackendQueueSnapshot> {
  const res = await fetch(apiUrl(`/api/v1/live-monitor/queue/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getBackendDriftHistory(backend: string): Promise<CalibrationDriftEvent[]> {
  const res = await fetch(apiUrl(`/api/v1/live-monitor/history/${backend}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function watchBackend(req: { backend: string; threshold_t1_us?: number; threshold_cx_error?: number; email?: string }): Promise<MonitorAlertSubscription> {
  const res = await fetch(apiUrl("/api/v1/live-monitor/watch"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Backend Cost Arbitrage  /api/v1/cost-arbitrage
// ─────────────────────────────────────────────────────────
export interface BackendQuote { backend: string; provider: string; cost_per_shot_usd: number; min_shots: number; estimated_total_usd: number; queue_wait_min: number; cx_error: number; t1_us: number; fidelity_score: number; available: boolean; }
export interface ArbitrageRecommendation { rec_id: string; circuit_description: string; n_shots: number; budget_usd: number; target_fidelity: number; winner_backend: string; winner_quote: BackendQuote; all_quotes: BackendQuote[]; savings_vs_default_usd: number; savings_pct: number; reasoning: string; created_at: string; }
export async function getArbitrageRecommendation(req: { circuit_description: string; n_shots: number; budget_usd: number; target_fidelity?: number; prefer_speed?: boolean }): Promise<ArbitrageRecommendation> {
  const res = await fetch(apiUrl("/api/v1/cost-arbitrage/recommend"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getBackendQuotes(req: { n_shots: number; circuit_depth: number; n_qubits: number }): Promise<BackendQuote[]> {
  const res = await fetch(apiUrl("/api/v1/cost-arbitrage/quote"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getMarketSnapshot(): Promise<{ snapshot_id: string; taken_at: string; quotes: BackendQuote[] }> {
  const res = await fetch(apiUrl("/api/v1/cost-arbitrage/market"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getArbitrageSavingsHistory(): Promise<{ rec_id: string; backend_chosen: string; savings_usd: number; date: string }[]> {
  const res = await fetch(apiUrl("/api/v1/cost-arbitrage/savings-history"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Process Tomography  /api/v1/process-tomo
// ─────────────────────────────────────────────────────────
export interface QPTResult { result_id: string; backend: string; gate_name: string; n_qubits: number; method: string; process_fidelity: number; average_gate_fidelity: number; unitarity: number; diamond_norm_error: number; chi_matrix_real: number[][]; chi_matrix_imag: number[][]; dominant_error_type: string; error_breakdown: Record<string, number>; n_circuits_used: number; shots_per_circuit: number; created_at: string; }
export interface QPTSummary { result_id: string; backend: string; gate_name: string; process_fidelity: number; average_gate_fidelity: number; diamond_norm_error: number; created_at: string; }
export async function runQPT(req: { backend: string; gate_name: string; n_qubits?: number; method?: string; shots_per_circuit?: number }): Promise<QPTResult> {
  const res = await fetch(apiUrl("/api/v1/process-tomo/run"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listQPTResults(): Promise<QPTSummary[]> {
  const res = await fetch(apiUrl("/api/v1/process-tomo/results"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getQPTResult(resultId: string): Promise<QPTResult> {
  const res = await fetch(apiUrl(`/api/v1/process-tomo/result/${resultId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Conference Asset Builder  /api/v1/conference
// ─────────────────────────────────────────────────────────
export interface ConferenceAsset { asset_id: string; type: string; title: string; venue: string; authors: string[]; experiment_ids: string[]; sections: { title: string; content: string; figures?: string[] }[]; template: string; format: string; file_size_kb: number; download_url: string; created_at: string; }
export async function generatePoster(req: { title: string; venue: string; authors: string[]; experiment_ids: string[]; template?: string; highlight_metric?: string }): Promise<ConferenceAsset> {
  const res = await fetch(apiUrl("/api/v1/conference/generate-poster"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function generateSlides(req: { title: string; venue: string; authors: string[]; experiment_ids: string[]; n_slides?: number; template?: string }): Promise<ConferenceAsset> {
  const res = await fetch(apiUrl("/api/v1/conference/generate-slides"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function generateAbstract(req: { title: string; venue: string; authors: string[]; experiment_ids: string[]; max_words?: number }): Promise<ConferenceAsset> {
  const res = await fetch(apiUrl("/api/v1/conference/generate-abstract"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listConferenceAssets(): Promise<ConferenceAsset[]> {
  const res = await fetch(apiUrl("/api/v1/conference/assets"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getConferenceAsset(assetId: string): Promise<ConferenceAsset> {
  const res = await fetch(apiUrl(`/api/v1/conference/asset/${assetId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Learning Paths  /api/v1/learn
// ─────────────────────────────────────────────────────────
export interface LearningModule { module_id: string; title: string; description: string; type: string; duration_min: number; difficulty: string; tags: string[]; }
export interface LearningPath { path_id: string; title: string; description: string; level: string; modules: LearningModule[]; total_duration_min: number; prerequisites: string[]; skills_gained: string[]; enrolled_count: number; completion_rate: number; }
export interface LearningProgress { progress_id: string; user: string; path_id: string; enrolled_at: string; completed_modules: string[]; current_module?: string; pct_complete: number; last_active: string; certificate_url?: string; completed_at?: string; }
export async function listLearningPaths(): Promise<LearningPath[]> {
  const res = await fetch(apiUrl("/api/v1/learn/paths"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getLearningPath(pathId: string): Promise<LearningPath> {
  const res = await fetch(apiUrl(`/api/v1/learn/path/${pathId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function enrollInPath(req: { user: string; path_id: string }): Promise<LearningProgress> {
  const res = await fetch(apiUrl("/api/v1/learn/enroll"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function completeModule(req: { user: string; path_id: string; module_id: string }): Promise<LearningProgress> {
  const res = await fetch(apiUrl("/api/v1/learn/complete-module"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getLearningProgress(user: string): Promise<LearningProgress[]> {
  const res = await fetch(apiUrl(`/api/v1/learn/progress/${user}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Researcher Talent Board  /api/v1/talent
// ─────────────────────────────────────────────────────────
export interface ResearcherProfile { profile_id: string; name: string; email: string; institution: string; role: string; expertise: string[]; publications: number; h_index: number; open_to_opportunities: boolean; bio: string; website?: string; orcid?: string; created_at: string; }
export interface TalentJobListing { job_id: string; title: string; institution: string; location: string; type: string; description: string; required_skills: string[]; preferred_skills: string[]; salary_range?: string; deadline?: string; contact_email: string; posted_at: string; active: boolean; }
export interface TalentMatch { profile_id: string; job_id: string; match_score: number; matching_skills: string[]; }
export async function createResearcherProfile(req: { name: string; email: string; institution: string; role: string; expertise: string[]; publications: number; h_index: number; open_to_opportunities: boolean; bio: string; website?: string; orcid?: string }): Promise<ResearcherProfile> {
  const res = await fetch(apiUrl("/api/v1/talent/profile"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listResearcherProfiles(params?: { role?: string; expertise?: string }): Promise<ResearcherProfile[]> {
  const p = new URLSearchParams();
  if (params?.role) p.set("role", params.role);
  if (params?.expertise) p.set("expertise", params.expertise);
  const res = await fetch(apiUrl(`/api/v1/talent/profiles?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function createJobListing(req: { title: string; institution: string; location: string; type: string; description: string; required_skills: string[]; preferred_skills: string[]; salary_range?: string; deadline?: string; contact_email: string }): Promise<TalentJobListing> {
  const res = await fetch(apiUrl("/api/v1/talent/job"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listJobListings(params?: { type?: string; location?: string }): Promise<TalentJobListing[]> {
  const p = new URLSearchParams();
  if (params?.type) p.set("type", params.type);
  if (params?.location) p.set("location", params.location);
  const res = await fetch(apiUrl(`/api/v1/talent/jobs?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getTalentMatches(profileId: string): Promise<TalentMatch[]> {
  const res = await fetch(apiUrl(`/api/v1/talent/matches/${profileId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// GitHub CI Bridge  /api/v1/github-ci
// ─────────────────────────────────────────────────────────
export interface CIPipeline { pipeline_id: string; name: string; repo: string; branch_pattern: string; trigger: string; experiment_template: Record<string, unknown>; backend: string; shots: number; status: string; created_at: string; }
export interface CIPipelineRun { run_id: string; pipeline_id: string; repo: string; branch: string; commit_sha: string; triggered_by: string; experiment_run_id?: string; status: string; fidelity_threshold: number; achieved_fidelity?: number; duration_sec?: number; log_url: string; started_at: string; completed_at?: string; }
export async function createCIPipeline(req: { name: string; repo: string; branch_pattern: string; trigger: string; experiment_template: Record<string, unknown>; backend: string; shots: number; fidelity_threshold?: number }): Promise<CIPipeline> {
  const res = await fetch(apiUrl("/api/v1/github-ci/pipeline"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listCIPipelines(): Promise<CIPipeline[]> {
  const res = await fetch(apiUrl("/api/v1/github-ci/pipelines"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function triggerCIPipeline(req: { pipeline_id: string; branch?: string; commit_sha?: string; triggered_by?: string }): Promise<CIPipelineRun> {
  const res = await fetch(apiUrl("/api/v1/github-ci/trigger"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getCIPipelineRuns(pipelineId: string): Promise<CIPipelineRun[]> {
  const res = await fetch(apiUrl(`/api/v1/github-ci/runs/${pipelineId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Advantage Certifier  /api/v1/certify
// ─────────────────────────────────────────────────────────
export interface CertificationResult { cert_id: string; name: string; claim_type: string; backend: string; n_qubits: number; classical_runtime_sec: number; quantum_runtime_sec: number; speedup_factor: number; statistical_test: string; test_statistic: number; p_value: number; confidence_level: number; certified: boolean; certificate_url?: string; methodology_notes: string[]; created_at: string; }
export async function certifyAdvantage(req: { name: string; claim_type: string; backend: string; n_qubits: number; classical_runtime_sec: number; quantum_runtime_sec: number; statistical_test: string; confidence_level?: number; evidence_run_ids: string[] }): Promise<CertificationResult> {
  const res = await fetch(apiUrl("/api/v1/certify/certify"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listCertifications(): Promise<{ cert_id: string; name: string; certified: boolean; speedup_factor: number; p_value: number; created_at: string }[]> {
  const res = await fetch(apiUrl("/api/v1/certify/certifications"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getCertification(certId: string): Promise<CertificationResult> {
  const res = await fetch(apiUrl(`/api/v1/certify/certification/${certId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Spectral Noise Analyzer  /api/v1/spectral-noise
// ─────────────────────────────────────────────────────────
export interface NoisePSD { analysis_id: string; backend: string; qubit: number; metric: string; frequencies_hz: number[]; psd_values: number[]; noise_floor: number; one_over_f_coefficient: number; one_over_f_exponent: number; white_noise_level: number; dominant_frequency?: number; tls_detected: boolean; tls_frequencies: number[]; created_at: string; }
export interface TLSReport { report_id: string; backend: string; qubit: number; n_tls_detected: number; tls_list: { frequency_ghz: number; coupling_strength: number; coherence_time_us: number }[]; mitigation_suggestions: string[]; created_at: string; }
export async function analyzeSpectralNoise(req: { backend: string; qubit: number; metric: string; duration_sec?: number }): Promise<NoisePSD> {
  const res = await fetch(apiUrl("/api/v1/spectral-noise/analyze"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listSpectralAnalyses(): Promise<NoisePSD[]> {
  const res = await fetch(apiUrl("/api/v1/spectral-noise/analyses"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getSpectralAnalysis(analysisId: string): Promise<NoisePSD> {
  const res = await fetch(apiUrl(`/api/v1/spectral-noise/analysis/${analysisId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function detectTLS(req: { backend: string; qubit: number }): Promise<TLSReport> {
  const res = await fetch(apiUrl("/api/v1/spectral-noise/detect-tls"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Lab Inventory  /api/v1/lab-inventory
// ─────────────────────────────────────────────────────────
export interface EquipmentItem { item_id: string; name: string; category: string; model: string; serial_number: string; location: string; status: string; purchase_date: string; warranty_expires?: string; last_maintenance?: string; next_maintenance?: string; notes: string; linked_backends: string[]; created_at: string; }
export interface MaintenanceLog { log_id: string; item_id: string; type: string; description: string; performed_by: string; duration_hours: number; parts_replaced: string[]; cost_usd: number; next_due?: string; logged_at: string; }
export interface MaintenanceScheduleEntry { item_id: string; item_name: string; next_due: string; type: string; overdue: boolean; }
export async function addEquipmentItem(req: { name: string; category: string; model: string; serial_number: string; location: string; status: string; purchase_date: string; warranty_expires?: string; notes: string; linked_backends?: string[] }): Promise<EquipmentItem> {
  const res = await fetch(apiUrl("/api/v1/lab-inventory/item"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listEquipmentItems(params?: { category?: string; status?: string }): Promise<EquipmentItem[]> {
  const p = new URLSearchParams();
  if (params?.category) p.set("category", params.category);
  if (params?.status) p.set("status", params.status);
  const res = await fetch(apiUrl(`/api/v1/lab-inventory/items?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getEquipmentItem(itemId: string): Promise<EquipmentItem> {
  const res = await fetch(apiUrl(`/api/v1/lab-inventory/item/${itemId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function logMaintenance(req: { item_id: string; type: string; description: string; performed_by: string; duration_hours: number; parts_replaced: string[]; cost_usd: number; next_due?: string }): Promise<MaintenanceLog> {
  const res = await fetch(apiUrl("/api/v1/lab-inventory/maintenance"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getMaintenanceSchedule(): Promise<MaintenanceScheduleEntry[]> {
  const res = await fetch(apiUrl("/api/v1/lab-inventory/schedule"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// QML Dataset Hub  /api/v1/qml-datasets
// ─────────────────────────────────────────────────────────
export interface QMLDatasetEntry { dataset_id: string; name: string; description: string; task: string; n_samples: number; n_features: number; n_qubits: number; encoding: string; benchmark_accuracy: number; size_mb: number; license: string; authors: string[]; paper_doi?: string; tags: string[]; download_url: string; created_at: string; }
export interface QMLBenchmarkRun { run_id: string; dataset_id: string; model_type: string; n_params: number; accuracy: number; f1_score: number; training_time_sec: number; n_qubits_used: number; optimizer: string; created_at: string; }
export async function listQMLDatasetHub(): Promise<QMLDatasetEntry[]> {
  const res = await fetch(apiUrl("/api/v1/qml-datasets/"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getQMLDatasetEntry(datasetId: string): Promise<QMLDatasetEntry> {
  const res = await fetch(apiUrl(`/api/v1/qml-datasets/${datasetId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function uploadQMLDataset(req: { name: string; description: string; task: string; n_samples: number; n_features: number; n_qubits: number; encoding: string; license: string; authors: string[]; paper_doi?: string; tags: string[] }): Promise<QMLDatasetEntry> {
  const res = await fetch(apiUrl("/api/v1/qml-datasets/upload"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function benchmarkQMLDataset(req: { dataset_id: string; model_type: string; n_params: number; optimizer?: string }): Promise<QMLBenchmarkRun> {
  const res = await fetch(apiUrl("/api/v1/qml-datasets/benchmark"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function getQMLDatasetBenchmarks(datasetId: string): Promise<QMLBenchmarkRun[]> {
  const res = await fetch(apiUrl(`/api/v1/qml-datasets/${datasetId}/benchmarks`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Quantum Internet Simulator  /api/v1/quantum-internet
// ─────────────────────────────────────────────────────────
export interface QNode { node_id: string; name: string; type: string; location: string; qubit_count: number; coherence_time_us: number; gate_fidelity: number; }
export interface QLink { link_id: string; node_a: string; node_b: string; distance_km: number; loss_db_per_km: number; entanglement_rate_hz: number; fidelity: number; }
export interface QNetwork { network_id: string; name: string; nodes: QNode[]; links: QLink[]; topology: string; created_at: string; }
export interface EntanglementSimResult { sim_id: string; network_id: string; source_node: string; dest_node: string; path: string[]; n_hops: number; end_to_end_fidelity: number; entanglement_rate_hz: number; success_probability: number; latency_ms: number; bottleneck_link?: string; simulated_at: string; }
export interface RepeaterPlacement { placement_id: string; network_id: string; n_repeaters: number; placements: { position: string; improvement: number }[]; fidelity_before: number; fidelity_after: number; rate_before: number; rate_after: number; created_at: string; }
export async function createQuantumNetwork(req: { name: string; nodes: Partial<QNode>[]; links: Partial<QLink>[]; topology: string }): Promise<QNetwork> {
  const res = await fetch(apiUrl("/api/v1/quantum-internet/network"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listQuantumNetworks(): Promise<QNetwork[]> {
  const res = await fetch(apiUrl("/api/v1/quantum-internet/networks"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getQuantumNetwork(networkId: string): Promise<QNetwork> {
  const res = await fetch(apiUrl(`/api/v1/quantum-internet/network/${networkId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function simulateEntanglement(req: { network_id: string; source_node: string; dest_node: string; n_runs?: number }): Promise<EntanglementSimResult> {
  const res = await fetch(apiUrl("/api/v1/quantum-internet/simulate"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function optimizeRepeaters(req: { network_id: string; n_repeaters: number; budget_usd?: number }): Promise<RepeaterPlacement> {
  const res = await fetch(apiUrl("/api/v1/quantum-internet/optimize-repeaters"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Collaborative Notebooks  /api/v1/collab-notebook
// ─────────────────────────────────────────────────────────
export interface CollabCell { cell_id: string; type: string; content: string; outputs: string[]; executed_at?: string; execution_count?: number; }
export interface CollabNotebook { notebook_id: string; title: string; owner: string; collaborators: string[]; tags: string[]; cells: CollabCell[]; kernel: string; status: string; created_at: string; updated_at: string; }
export interface CollabExecutionResult { notebook_id: string; cell_id: string; output: string[]; execution_time_ms: number; success: boolean; executed_at: string; }
export async function createCollabNotebook(req: { title: string; owner: string; collaborators?: string[]; tags?: string[]; kernel?: string }): Promise<CollabNotebook> {
  const res = await fetch(apiUrl("/api/v1/collab-notebook/notebook"), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function listCollabNotebooks(owner?: string): Promise<CollabNotebook[]> {
  const p = new URLSearchParams();
  if (owner) p.set("owner", owner);
  const res = await fetch(apiUrl(`/api/v1/collab-notebook/notebooks?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function getCollabNotebook(notebookId: string): Promise<CollabNotebook> {
  const res = await fetch(apiUrl(`/api/v1/collab-notebook/notebook/${notebookId}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
export async function addCollabCell(notebookId: string, req: { type: string; content: string }): Promise<CollabNotebook> {
  const res = await fetch(apiUrl(`/api/v1/collab-notebook/notebook/${notebookId}/cell`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function updateCollabCell(notebookId: string, cellId: string, content: string): Promise<CollabNotebook> {
  const res = await fetch(apiUrl(`/api/v1/collab-notebook/notebook/${notebookId}/cell/${cellId}`), { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ content }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function executeCollabNotebook(notebookId: string, cellId?: string): Promise<CollabExecutionResult[]> {
  const res = await fetch(apiUrl(`/api/v1/collab-notebook/notebook/${notebookId}/execute`), { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ cell_id: cellId }) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─────────────────────────────────────────────────────────
// Federated Quantum Benchmark Registry  /api/v1/federated
// ─────────────────────────────────────────────────────────
export interface FederatedResult {
  result_id: string;
  contributed_by: string;
  algorithm: string;
  backend: string;
  n_qubits: number;
  circuit_depth: number;
  n_shots: number;
  success_probability: number;
  health_score: number;
  error_rate: number;
  t1_at_runtime?: number | null;
  t2_at_runtime?: number | null;
  algorithm_category: string;
  noise_model?: string | null;
  error_mitigation?: string | null;
  tags: string[];
  contributed_at: string;
  verified: boolean;
}

export interface FederatedResultsResponse {
  results: FederatedResult[];
  total: number;
  stats: {
    avg_health_score: number;
    top_backend: string | null;
    top_algorithm: string | null;
    total_contributed: number;
  };
}

export interface FederatedLeaderboard {
  by_category: Record<string, FederatedResult[]>;
}

export interface FederatedStats {
  total_contributions: number;
  unique_backends: number;
  unique_algorithms: number;
  avg_health_score: number;
  avg_health_score_by_backend: Record<string, number>;
  avg_health_score_by_algorithm: Record<string, number>;
  contributions_last_30_days: number;
}

export interface ContributeFederatedRequest {
  algorithm: string;
  backend: string;
  n_qubits: number;
  circuit_depth: number;
  n_shots: number;
  success_probability: number;
  health_score: number;
  error_rate: number;
  t1_at_runtime?: number;
  t2_at_runtime?: number;
  algorithm_category?: string;
  noise_model?: string;
  error_mitigation?: string;
  tags?: string[];
  contributed_by?: string;
}

export interface FederatedResultsParams {
  algorithm_category?: string;
  backend?: string;
  min_qubits?: number;
  max_qubits?: number;
  min_health_score?: number;
  algorithm?: string;
  limit?: number;
}

export async function contributeFederated(req: ContributeFederatedRequest): Promise<FederatedResult> {
  const res = await fetch(apiUrl("/api/v1/federated/contribute"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getFederatedResults(params?: FederatedResultsParams): Promise<FederatedResultsResponse> {
  const p = new URLSearchParams();
  if (params?.algorithm_category) p.set("algorithm_category", params.algorithm_category);
  if (params?.backend) p.set("backend", params.backend);
  if (params?.min_qubits != null) p.set("min_qubits", String(params.min_qubits));
  if (params?.max_qubits != null) p.set("max_qubits", String(params.max_qubits));
  if (params?.min_health_score != null) p.set("min_health_score", String(params.min_health_score));
  if (params?.algorithm) p.set("algorithm", params.algorithm);
  if (params?.limit != null) p.set("limit", String(params.limit));
  const res = await fetch(apiUrl(`/api/v1/federated/results?${p}`), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch federated results");
  return res.json();
}

export async function getFederatedLeaderboard(): Promise<FederatedLeaderboard> {
  const res = await fetch(apiUrl("/api/v1/federated/leaderboard"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch federated leaderboard");
  return res.json();
}

export async function getFederatedStats(): Promise<FederatedStats> {
  const res = await fetch(apiUrl("/api/v1/federated/stats"), { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch federated stats");
  return res.json();
}

export async function contributeFromRun(runId: string, contributedBy?: string): Promise<FederatedResult> {
  const p = new URLSearchParams();
  if (contributedBy) p.set("contributed_by", contributedBy);
  const res = await fetch(apiUrl(`/api/v1/federated/contribute-from-run/${runId}?${p}`), {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Full-Text Search (FTS5)
// ------------------------------------------------------------------

export interface FulltextResult {
  run_id: string;
  circuit_name: string | null;
  backend: string | null;
  project_slug: string | null;
  status: string;
  created_at: string | null;
  tags: string[];
  score: number;
}

export async function fulltextSearch(
  q: string,
  limit = 20,
): Promise<{ results: FulltextResult[]; total: number; query: string }> {
  const res = await fetch(
    apiUrl(`/api/v1/search/fulltext?q=${encodeURIComponent(q)}&limit=${limit}`),
    { cache: "no-store", headers: authHeaders() },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Plugin Registry
// ------------------------------------------------------------------

export type Plugin = {
  plugin_id: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  install_command: string;
  homepage_url: string | null;
  source_url: string | null;
  docs_url: string | null;
  icon_emoji: string;
  downloads: number;
  rating: number;
  rating_count: number;
  compatible_versions: string[];
  hooks: string[];
  is_official: boolean;
  created_at: string;
  updated_at: string;
};

export type PluginCreate = {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags?: string[];
  install_command: string;
  homepage_url?: string | null;
  source_url?: string | null;
  docs_url?: string | null;
  icon_emoji?: string;
  compatible_versions?: string[];
  hooks?: string[];
};

export async function listPlugins(params?: {
  category?: string;
  tag?: string;
  sort?: "downloads" | "rating" | "newest";
}): Promise<Plugin[]> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.sort) qs.set("sort", params.sort);
  const url = apiUrl(`/api/v1/plugins${qs.toString() ? "?" + qs : ""}`);
  const res = await fetch(url, { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPlugin(pluginId: string): Promise<Plugin> {
  const res = await fetch(apiUrl(`/api/v1/plugins/${pluginId}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function publishPlugin(body: PluginCreate): Promise<Plugin> {
  const res = await fetch(apiUrl("/api/v1/plugins"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ratePlugin(
  pluginId: string,
  rating: number,
): Promise<{ plugin_id: string; rating: number; rating_count: number }> {
  const res = await fetch(apiUrl(`/api/v1/plugins/${pluginId}/rate`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ------------------------------------------------------------------
// Provenance & Badge
// ------------------------------------------------------------------

export async function getRunProvenance(runId: string): Promise<any> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/provenance`), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load provenance");
  return res.json();
}

export function getRunBadgeUrl(runId: string): string {
  return apiUrl(`/api/v1/runs/${runId}/badge.svg`);
}

// ------------------------------------------------------------------
// Paper Package & Overleaf Export
// ------------------------------------------------------------------

/** Returns the URL for directly downloading the paper-package ZIP. */
export function getPaperPackageUrl(runId: string): string {
  return apiUrl(`/api/v1/runs/${runId}/paper-package`);
}

export type OverleafLinkResponse = {
  run_id: string;
  zip_url: string;
  overleaf_url: string;
};

/** Returns an Overleaf deep-link that opens the paper ZIP in a new Overleaf project. */
export async function getOverleafLink(runId: string): Promise<OverleafLinkResponse> {
  const res = await fetch(apiUrl(`/api/v1/runs/${runId}/overleaf-link`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to generate Overleaf link");
  return res.json();
}
