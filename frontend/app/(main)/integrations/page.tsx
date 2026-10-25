"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  XCircle,
  Copy,
  Send,
  MessageSquare,
  RefreshCw,
  Link as LinkIcon,
} from "lucide-react";
import GithubIcon from "../../../components/GithubIcon";

const API = "/qlab-api";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: ok ? "#0d2318" : "#1e1e1e",
        color: ok ? "#34d399" : "#94a3b8",
        border: `1px solid ${ok ? "#1f6a45" : "#334155"}`,
      }}
    >
      {ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {label}
    </span>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 6,
        padding: "8px 12px",
      }}
    >
      <code style={{ flex: 1, fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}>{value}</code>
      <button
        onClick={handleCopy}
        title="Copy"
        style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 0 }}
      >
        <Copy size={14} color={copied ? "#34d399" : undefined} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub Integration
// ---------------------------------------------------------------------------

interface GitHubConfigState {
  github_token: string;
  repo_owner: string;
  repo_name: string;
  auto_comment_prs: boolean;
  min_health_score_badge: number;
  comment_template: string;
}

const GITHUB_DEFAULTS: GitHubConfigState = {
  github_token: "",
  repo_owner: "",
  repo_name: "",
  auto_comment_prs: true,
  min_health_score_badge: 50,
  comment_template: "markdown",
};

function GitHubSection() {
  const [form, setForm] = useState<GitHubConfigState>(GITHUB_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [connected, setConnected] = useState<{ github_user: string; repo_owner: string; repo_name: string } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Manual comment test
  const [testRunId, setTestRunId] = useState("");
  const [testPrNumber, setTestPrNumber] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    apiFetch("/api/v1/github/config")
      .then((cfg) => {
        setConnected({
          github_user: cfg.github_user ?? "unknown",
          repo_owner: cfg.repo_owner,
          repo_name: cfg.repo_name,
        });
        setForm({
          github_token: "",
          repo_owner: cfg.repo_owner ?? "",
          repo_name: cfg.repo_name ?? "",
          auto_comment_prs: cfg.auto_comment_prs ?? true,
          min_health_score_badge: cfg.min_health_score_badge ?? 50,
          comment_template: cfg.comment_template ?? "markdown",
        });
      })
      .catch(() => setConnected(null))
      .finally(() => setLoadingConfig(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.github_token.trim()) {
      setError("GitHub token is required.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/v1/github/config", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setConnected({
        github_user: result.github_user ?? "unknown",
        repo_owner: result.repo_owner,
        repo_name: result.repo_name,
      });
      setForm((f) => ({ ...f, github_token: "" }));
      setSuccess(`Connected as @${result.github_user ?? "unknown"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await apiFetch("/api/v1/github/config", { method: "DELETE" }).catch(() => null);
    setConnected(null);
    setSuccess("");
    setError("");
  }

  async function handleTest() {
    if (!testRunId.trim() || !testPrNumber.trim()) return;
    setTestBusy(true);
    setTestResult("");
    try {
      await apiFetch(`/api/v1/github/comment-run/${testRunId.trim()}`, {
        method: "POST",
        body: JSON.stringify({ pr_number: parseInt(testPrNumber, 10) }),
      });
      setTestResult("Comment posted successfully.");
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestBusy(false);
    }
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      {node}
      {hint && <span style={{ fontSize: 11, color: "#475569" }}>{hint}</span>}
    </div>
  );

  return (
    <section className="panel" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
      <div className="panel-header" style={{ background: "#0f172a", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GithubIcon size={18} color="#94a3b8" />
          <h2 style={{ color: "#e2e8f0", margin: 0 }}>GitHub Integration</h2>
        </div>
        {!loadingConfig && (
          <StatusBadge
            ok={!!connected}
            label={connected ? `Connected — ${connected.repo_owner}/${connected.repo_name}` : "Not Connected"}
          />
        )}
      </div>

      <div style={{ padding: "20px 22px", display: "grid", gap: 20 }}>
        {connected && (
          <div
            style={{
              padding: "12px 16px",
              background: "#0d2318",
              border: "1px solid #1f6a45",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: "#34d399" }}>
              Authenticated as <strong>@{connected.github_user}</strong> — watching{" "}
              <strong>{connected.repo_owner}/{connected.repo_name}</strong>
            </div>
            <button
              className="button secondary"
              style={{ fontSize: 12, height: 28, padding: "0 10px" }}
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: "grid", gap: 16 }}>
          {field(
            "GitHub Personal Access Token",
            <input
              className="input"
              type="password"
              value={form.github_token}
              onChange={(e) => setForm((f) => ({ ...f, github_token: e.target.value }))}
              placeholder={connected ? "Enter new token to rotate" : "ghp_xxxxxxxxxxxxxxxxxxxx"}
              style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
            />,
            "Needs repo and pull_requests scopes"
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {field(
              "Repository Owner",
              <input
                className="input"
                value={form.repo_owner}
                onChange={(e) => setForm((f) => ({ ...f, repo_owner: e.target.value }))}
                placeholder="mylab"
                style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
              />
            )}
            {field(
              "Repository Name",
              <input
                className="input"
                value={form.repo_name}
                onChange={(e) => setForm((f) => ({ ...f, repo_name: e.target.value }))}
                placeholder="quantum-research"
                style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
              />
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#cbd5e1",
                }}
              >
                <div
                  onClick={() => setForm((f) => ({ ...f, auto_comment_prs: !f.auto_comment_prs }))}
                  style={{
                    width: 38,
                    height: 22,
                    borderRadius: 999,
                    background: form.auto_comment_prs ? "#6366f1" : "#334155",
                    position: "relative",
                    cursor: "pointer",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 3,
                      left: form.auto_comment_prs ? 19 : 3,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                    }}
                  />
                </div>
                Auto-comment PRs
              </label>
            </div>

            {field(
              `Min health score for badge: ${form.min_health_score_badge}`,
              <input
                type="range"
                min={0}
                max={100}
                value={form.min_health_score_badge}
                onChange={(e) => setForm((f) => ({ ...f, min_health_score_badge: parseInt(e.target.value, 10) }))}
                style={{ width: "100%", accentColor: "#6366f1" }}
              />
            )}
          </div>

          {field(
            "Comment Template",
            <div style={{ display: "flex", gap: 12 }}>
              {(["compact", "markdown", "detailed"] as const).map((t) => (
                <label
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: "#cbd5e1",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="comment_template"
                    value={t}
                    checked={form.comment_template === t}
                    onChange={() => setForm((f) => ({ ...f, comment_template: t }))}
                    style={{ accentColor: "#6366f1" }}
                  />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          )}

          {error && (
            <div
              style={{ padding: "10px 14px", background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}
            >
              {error}
            </div>
          )}
          {success && (
            <div
              style={{ padding: "10px 14px", background: "#0d2318", border: "1px solid #1f6a45", borderRadius: 6, color: "#34d399", fontSize: 13 }}
            >
              {success}
            </div>
          )}

          <div>
            <button className="button" type="submit" disabled={saving} style={{ background: "#6366f1", borderColor: "#6366f1" }}>
              {saving ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Verifying…</> : "Save & Verify"}
            </button>
          </div>
        </form>

        {connected && (
          <>
            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Webhook URL — add in GitHub repo settings
              </div>
              <CopyBlock value="https://your-server.com/api/v1/github/webhook" />
              <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
                Set Content-Type: application/json and events: Pull requests
              </div>
            </div>

            <div style={{ borderTop: "1px solid #1e293b", paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Manual Comment Test
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 11, color: "#64748b" }}>Run ID</label>
                  <input
                    className="input"
                    value={testRunId}
                    onChange={(e) => setTestRunId(e.target.value)}
                    placeholder="abc123..."
                    style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 11, color: "#64748b" }}>PR Number</label>
                  <input
                    className="input"
                    type="number"
                    value={testPrNumber}
                    onChange={(e) => setTestPrNumber(e.target.value)}
                    placeholder="42"
                    style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
                  />
                </div>
                <button
                  className="button secondary"
                  onClick={handleTest}
                  disabled={testBusy || !testRunId.trim() || !testPrNumber.trim()}
                  style={{ height: 38 }}
                >
                  <Send size={13} /> Post Comment
                </button>
              </div>
              {testResult && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    color: testResult.startsWith("Error") ? "#f87171" : "#34d399",
                  }}
                >
                  {testResult}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Slack / Teams
// ---------------------------------------------------------------------------

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 999,
        background: value ? "#6366f1" : "#334155",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: value ? 19 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </div>
  );
}

interface SlackFormState {
  slack_signing_secret: string;
  slack_bot_token: string;
  channel_id: string;
  notify_on_run_complete: boolean;
  notify_on_health_below: boolean;
  health_threshold: number;
  teams_webhook_url: string;
}

const SLACK_DEFAULTS: SlackFormState = {
  slack_signing_secret: "",
  slack_bot_token: "",
  channel_id: "",
  notify_on_run_complete: true,
  notify_on_health_below: false,
  health_threshold: 50,
  teams_webhook_url: "",
};

function SlackSection() {
  const [activeTab, setActiveTab] = useState<"slack" | "teams">("slack");
  const [form, setForm] = useState<SlackFormState>(SLACK_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [connected, setConnected] = useState<{ bot_name: string; team_name: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Teams test
  const [teamsTestBusy, setTeamsTestBusy] = useState(false);
  const [teamsTestMsg, setTeamsTestMsg] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/slack/config")
      .then((cfg) => {
        setConnected({
          bot_name: cfg.bot_name ?? "Q-Lab Bot",
          team_name: cfg.team_name ?? "",
        });
        setForm((f) => ({
          ...f,
          channel_id: cfg.channel_id ?? "",
          notify_on_run_complete: cfg.notify_on_run_complete ?? true,
          notify_on_health_below: cfg.notify_on_health_below != null,
          health_threshold: cfg.notify_on_health_below ?? 50,
          teams_webhook_url: cfg.teams_webhook_url ?? "",
        }));
      })
      .catch(() => setConnected(null))
      .finally(() => setLoadingConfig(false));
  }, []);

  async function handleSaveSlack(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await apiFetch("/api/v1/slack/config", {
        method: "POST",
        body: JSON.stringify({
          slack_signing_secret: form.slack_signing_secret,
          slack_bot_token: form.slack_bot_token,
          channel_id: form.channel_id || null,
          notify_on_run_complete: form.notify_on_run_complete,
          notify_on_health_below: form.notify_on_health_below ? form.health_threshold : null,
          teams_webhook_url: form.teams_webhook_url || null,
        }),
      });
      setConnected({
        bot_name: result.bot_name ?? "Q-Lab Bot",
        team_name: result.team_name ?? "",
      });
      setForm((f) => ({ ...f, slack_signing_secret: "", slack_bot_token: "" }));
      setSuccess(result.verified ? `Connected — ${result.bot_name ?? "bot"} in ${result.team_name ?? "workspace"}` : "Saved (token not verified)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg("");
    try {
      const res = await apiFetch("/api/v1/slack/test");
      setTestMsg(res.sent ? "Test message sent!" : `Not sent: ${res.error ?? "unknown"}`);
    } catch (err) {
      setTestMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleTeamsTest() {
    if (!form.teams_webhook_url.trim()) {
      setTeamsTestMsg("Set a Teams webhook URL first.");
      return;
    }
    setTeamsTestBusy(true);
    setTeamsTestMsg("");
    try {
      await apiFetch("/api/v1/slack/teams-notify", {
        method: "POST",
        body: JSON.stringify({
          title: "⚛️ Q-Lab Test",
          text: "Teams integration is working correctly!",
          color: "6366f1",
        }),
      });
      setTeamsTestMsg("Test message sent to Teams!");
    } catch (err) {
      setTeamsTestMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTeamsTestBusy(false);
    }
  }

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </label>
      {node}
      {hint && <span style={{ fontSize: 11, color: "#475569" }}>{hint}</span>}
    </div>
  );

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    background: active ? "#1e293b" : "transparent",
    color: active ? "#e2e8f0" : "#64748b",
    border: active ? "1px solid #334155" : "1px solid transparent",
    transition: "all 0.15s",
  });

  return (
    <section className="panel" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
      <div className="panel-header" style={{ background: "#0f172a", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MessageSquare size={18} color="#94a3b8" />
          <h2 style={{ color: "#e2e8f0", margin: 0 }}>Slack / Teams</h2>
        </div>
        {!loadingConfig && (
          <StatusBadge ok={!!connected} label={connected ? `Connected — ${connected.team_name || connected.bot_name}` : "Not Connected"} />
        )}
      </div>

      <div style={{ padding: "16px 22px 0" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={tabStyle(activeTab === "slack")} onClick={() => setActiveTab("slack")}>
            Slack
          </button>
          <button style={tabStyle(activeTab === "teams")} onClick={() => setActiveTab("teams")}>
            Microsoft Teams
          </button>
        </div>
      </div>

      {/* ── Slack tab ── */}
      {activeTab === "slack" && (
        <div style={{ padding: "20px 22px", display: "grid", gap: 20 }}>
          {connected && (
            <div
              style={{
                padding: "12px 16px",
                background: "#0d2318",
                border: "1px solid #1f6a45",
                borderRadius: 8,
                fontSize: 13,
                color: "#34d399",
              }}
            >
              Connected as <strong>{connected.bot_name}</strong>
              {connected.team_name ? ` in ${connected.team_name}` : ""}
            </div>
          )}

          <form onSubmit={handleSaveSlack} style={{ display: "grid", gap: 16 }}>
            {field(
              "Signing Secret",
              <input
                className="input"
                type="password"
                value={form.slack_signing_secret}
                onChange={(e) => setForm((f) => ({ ...f, slack_signing_secret: e.target.value }))}
                placeholder={connected ? "Enter to rotate" : "From Slack app configuration"}
                style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
              />
            )}

            {field(
              "Bot Token",
              <input
                className="input"
                type="password"
                value={form.slack_bot_token}
                onChange={(e) => setForm((f) => ({ ...f, slack_bot_token: e.target.value }))}
                placeholder={connected ? "Enter to rotate" : "xoxb-..."}
                style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
              />
            )}

            {field(
              "Default Channel ID",
              <input
                className="input"
                value={form.channel_id}
                onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}
                placeholder="C0123456789"
                style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
              />,
              "Channel ID from Slack (right-click channel → View channel details)"
            )}

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: "#cbd5e1" }}>
                <Toggle value={form.notify_on_run_complete} onChange={(v) => setForm((f) => ({ ...f, notify_on_run_complete: v }))} />
                Notify when run completes
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Toggle
                  value={form.notify_on_health_below}
                  onChange={(v) => setForm((f) => ({ ...f, notify_on_health_below: v }))}
                />
                <span style={{ fontSize: 13, color: "#cbd5e1" }}>Alert when health below</span>
                {form.notify_on_health_below && (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.health_threshold}
                    onChange={(e) => setForm((f) => ({ ...f, health_threshold: parseInt(e.target.value, 10) }))}
                    style={{
                      width: 64,
                      background: "#0a0f1e",
                      border: "1px solid #1e293b",
                      borderRadius: 5,
                      color: "#e2e8f0",
                      padding: "3px 8px",
                      fontSize: 13,
                    }}
                  />
                )}
              </div>
            </div>

            {error && (
              <div style={{ padding: "10px 14px", background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ padding: "10px 14px", background: "#0d2318", border: "1px solid #1f6a45", borderRadius: 6, color: "#34d399", fontSize: 13 }}>
                {success}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="button" type="submit" disabled={saving} style={{ background: "#6366f1", borderColor: "#6366f1" }}>
                {saving ? "Saving…" : "Save & Test"}
              </button>
              {connected && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleTest}
                  disabled={testing}
                >
                  <Send size={13} /> {testing ? "Sending…" : "Send Test"}
                </button>
              )}
            </div>
            {testMsg && (
              <div style={{ fontSize: 13, color: testMsg.startsWith("Error") ? "#f87171" : "#34d399" }}>{testMsg}</div>
            )}
          </form>

          {/* Slash command setup */}
          <div style={{ borderTop: "1px solid #1e293b", paddingTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Slash Command Setup — paste into your Slack App config
            </div>
            <div
              style={{
                background: "#0a0f1e",
                border: "1px solid #1e293b",
                borderRadius: 8,
                padding: "14px 16px",
                display: "grid",
                gap: 8,
              }}
            >
              {[
                ["Command", "/qlab"],
                ["Request URL", "https://your-server.com/api/v1/slack/slash-command"],
                ["Short Description", "Query Q-Lab quantum experiments"],
                ["Usage Hint", "[status|runs|run <id>|health <backend>|help]"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 11, color: "#475569", minWidth: 140, fontWeight: 600 }}>{k}</span>
                  <CopyBlock value={v} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Teams tab ── */}
      {activeTab === "teams" && (
        <div style={{ padding: "20px 22px", display: "grid", gap: 18 }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            Send Q-Lab notifications to a Microsoft Teams channel via incoming webhook.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Teams Webhook URL
            </label>
            <input
              className="input"
              type="url"
              value={form.teams_webhook_url}
              onChange={(e) => setForm((f) => ({ ...f, teams_webhook_url: e.target.value }))}
              placeholder="https://myorg.webhook.office.com/webhookb2/..."
              style={{ background: "#0a0f1e", borderColor: "#1e293b", color: "#e2e8f0" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="button"
              style={{ background: "#6366f1", borderColor: "#6366f1" }}
              onClick={async () => {
                setSaving(true);
                setError("");
                setSuccess("");
                try {
                  await apiFetch("/api/v1/slack/config", {
                    method: "POST",
                    body: JSON.stringify({
                      slack_signing_secret: form.slack_signing_secret || "placeholder",
                      slack_bot_token: form.slack_bot_token || "placeholder",
                      channel_id: form.channel_id || null,
                      notify_on_run_complete: form.notify_on_run_complete,
                      notify_on_health_below: form.notify_on_health_below ? form.health_threshold : null,
                      teams_webhook_url: form.teams_webhook_url || null,
                    }),
                  });
                  setSuccess("Teams webhook saved.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Save failed");
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              Save
            </button>
            <button
              className="button secondary"
              onClick={handleTeamsTest}
              disabled={teamsTestBusy}
            >
              <Send size={13} /> {teamsTestBusy ? "Sending…" : "Send Test"}
            </button>
          </div>

          {teamsTestMsg && (
            <div style={{ fontSize: 13, color: teamsTestMsg.startsWith("Error") ? "#f87171" : "#34d399" }}>{teamsTestMsg}</div>
          )}
          {error && (
            <div style={{ padding: "10px 14px", background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 6, color: "#f87171", fontSize: 13 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ padding: "10px 14px", background: "#0d2318", border: "1px solid #1f6a45", borderRadius: 6, color: "#34d399", fontSize: 13 }}>
              {success}
            </div>
          )}

          <div style={{ borderTop: "1px solid #1e293b", paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              How to set up Teams incoming webhook
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 13, color: "#94a3b8" }}>
              <li>Go to the Teams channel where you want notifications</li>
              <li>Click the three dots (…) next to the channel name</li>
              <li>Select <strong style={{ color: "#e2e8f0" }}>Connectors</strong></li>
              <li>Find <strong style={{ color: "#e2e8f0" }}>Incoming Webhook</strong> and click Configure</li>
              <li>Give it a name (e.g. Q-Lab) and upload an icon if desired</li>
              <li>Copy the webhook URL and paste it above</li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function IntegrationsPage() {
  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", margin: "0 0 6px" }}>
          Integrations
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>
          Connect Q-Lab to your developer workflows — GitHub PRs, Slack channels, and Teams.
        </p>
      </div>

      <div style={{ display: "grid", gap: 24 }}>
        <GitHubSection />
        <SlackSection />
      </div>
    </main>
  );
}
