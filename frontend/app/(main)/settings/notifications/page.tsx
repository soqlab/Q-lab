"use client";
import { useEffect, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationPreferences {
  email: string;
  on_run_complete: boolean;
  on_run_failed: boolean;
  on_alert_triggered: boolean;
  weekly_digest: boolean;
  on_peer_review_request: boolean;
  min_health_score_to_notify: number;
}

interface EmailStatus {
  configured: boolean;
  transport: "smtp" | "resend" | "none";
  smtp_host: string | null;
}

interface HistoryEntry {
  event: string;
  subject: string;
  status: "sent" | "failed";
  timestamp: string;
  run_id?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("qlab_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/qlab-api/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const defaultPrefs: NotificationPreferences = {
  email: "",
  on_run_complete: true,
  on_run_failed: true,
  on_alert_triggered: true,
  weekly_digest: true,
  on_peer_review_request: true,
  min_health_score_to_notify: 0,
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusCard({
  status,
  testing,
  testResult,
  prefsEmail,
  onTest,
}: {
  status: EmailStatus | null;
  testing: boolean;
  testResult: string | null;
  prefsEmail: string;
  onTest: () => void;
}) {
  const configured = status?.configured ?? false;
  return (
    <div
      style={{
        background: "#1e293b",
        border: `1px solid ${configured ? "#166534" : "#713f12"}`,
        borderRadius: 12,
        padding: "1.25rem 1.5rem",
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: configured ? "#22c55e" : "#eab308",
            flexShrink: 0,
            boxShadow: configured
              ? "0 0 6px #22c55e88"
              : "0 0 6px #eab30888",
          }}
        />
        <div>
          <div
            style={{
              color: configured ? "#86efac" : "#fde68a",
              fontWeight: 700,
              fontSize: "0.95rem",
            }}
          >
            {configured ? "Email configured" : "Email not configured"}
          </div>
          <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: 2 }}>
            {configured
              ? `Transport: ${status?.transport}${status?.smtp_host ? ` (${status.smtp_host})` : ""}`
              : "Set SMTP_HOST env var (or RESEND_API_KEY) to enable email notifications"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {testResult && (
          <span
            style={{
              fontSize: "0.8rem",
              color: testResult === "ok" ? "#86efac" : "#fca5a5",
            }}
          >
            {testResult === "ok" ? "Test sent!" : `Failed: ${testResult}`}
          </span>
        )}
        <button
          onClick={onTest}
          disabled={testing || !prefsEmail}
          title={!prefsEmail ? "Set a notification email first" : undefined}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "0.5rem 1.1rem",
            cursor: testing || !prefsEmail ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            opacity: testing || !prefsEmail ? 0.55 : 1,
          }}
        >
          {testing ? "Sending…" : "Send test email"}
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "0.9rem 0",
        borderBottom: "1px solid #1e293b",
        gap: "1rem",
      }}
    >
      <div>
        <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "0.9rem" }}>
          {label}
        </div>
        <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 2 }}>
          {description}
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 44,
          height: 24,
          borderRadius: 12,
          border: "none",
          background: checked ? "#3b82f6" : "#334155",
          cursor: "pointer",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </button>
    </div>
  );
}

function HistoryTable({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div
        style={{ color: "#64748b", textAlign: "center", padding: "3rem 0", fontSize: "0.9rem" }}
      >
        No notification history yet.
      </div>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ color: "#475569", borderBottom: "1px solid #1e293b" }}>
            {["Type", "Timestamp", "Subject", "Status"].map((h) => (
              <th
                key={h}
                style={{ textAlign: "left", padding: "0.5rem 0.75rem", fontWeight: 500 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 20).map((e, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #0f172a" }}>
              <td style={{ padding: "0.55rem 0.75rem", color: "#94a3b8" }}>
                <span
                  style={{
                    background: "#1e293b",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                  }}
                >
                  {e.event}
                </span>
              </td>
              <td style={{ padding: "0.55rem 0.75rem", color: "#64748b" }}>
                {new Date(e.timestamp).toLocaleString()}
              </td>
              <td style={{ padding: "0.55rem 0.75rem", color: "#e2e8f0" }}>
                {e.subject}
              </td>
              <td style={{ padding: "0.55rem 0.75rem" }}>
                <span
                  style={{
                    color: e.status === "sent" ? "#86efac" : "#fca5a5",
                    fontWeight: 600,
                    fontSize: "0.78rem",
                  }}
                >
                  {e.status === "sent" ? "sent" : "failed"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function NotificationsPreferencesPage() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultPrefs);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, h] = await Promise.all([
        apiFetch<EmailStatus>("/notifications/status"),
        apiFetch<NotificationPreferences>("/notifications/preferences"),
        apiFetch<HistoryEntry[]>("/notifications/history"),
      ]);
      setStatus(s);
      setPrefs(p);
      setHistory(h);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      await apiFetch("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      });
      setSaveMsg("Preferences saved.");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so the test email goes to the right address
      await apiFetch("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(prefs),
      });
      const r = await apiFetch<{ sent: boolean; to: string }>("/notifications/test", {
        method: "POST",
      });
      setTestResult(r.sent ? "ok" : "failed — check server logs");
      void load(); // refresh history
    } catch (e: unknown) {
      setTestResult(e instanceof Error ? e.message : "error");
    } finally {
      setTesting(false);
    }
  };

  const set = (key: keyof NotificationPreferences, value: boolean | number | string) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    marginTop: 4,
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#e2e8f0",
    padding: "0.5rem 0.75rem",
    boxSizing: "border-box",
    fontSize: "0.9rem",
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "2rem" }}>
      {/* Page header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
          Email Notifications
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.88rem", marginTop: 6 }}>
          Control which events trigger email notifications and manage your delivery history.
        </p>
      </div>

      {error && (
        <div
          style={{
            background: "#7f1d1d22",
            border: "1px solid #ef4444",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            color: "#f87171",
            marginBottom: "1.25rem",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#64748b", textAlign: "center", padding: "4rem" }}>
          Loading…
        </div>
      ) : (
        <>
          {/* Email Status Card */}
          <StatusCard
            status={status}
            testing={testing}
            testResult={testResult}
            prefsEmail={prefs.email}
            onTest={handleTest}
          />

          {/* Preferences form */}
          <div
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 12,
              padding: "1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <h2 style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.05rem", margin: "0 0 1.25rem" }}>
              Notification Preferences
            </h2>

            {/* Email address */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 500 }}>
                Notification email address
                <input
                  type="email"
                  value={prefs.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@example.com"
                  style={inputStyle}
                />
              </label>
              <p style={{ color: "#475569", fontSize: "0.75rem", margin: "4px 0 0" }}>
                May differ from your login email. Used for all notification types.
              </p>
            </div>

            {/* Toggles */}
            <Toggle
              label="Run complete"
              description="Email when a quantum experiment finishes successfully."
              checked={prefs.on_run_complete}
              onChange={(v) => set("on_run_complete", v)}
            />
            <Toggle
              label="Run failed"
              description="Email when a run encounters an error."
              checked={prefs.on_run_failed}
              onChange={(v) => set("on_run_failed", v)}
            />
            <Toggle
              label="Alert triggered"
              description="Email when a monitoring threshold is crossed."
              checked={prefs.on_alert_triggered}
              onChange={(v) => set("on_alert_triggered", v)}
            />
            <Toggle
              label="Weekly digest"
              description="A weekly summary of your experiment activity."
              checked={prefs.weekly_digest}
              onChange={(v) => set("weekly_digest", v)}
            />
            <Toggle
              label="Peer review requests"
              description="Email when a colleague requests your review of a run."
              checked={prefs.on_peer_review_request}
              onChange={(v) => set("on_peer_review_request", v)}
            />

            {/* Health score threshold */}
            <div style={{ paddingTop: "1rem" }}>
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", fontWeight: 500 }}>
                Minimum health score to notify on run-complete
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  marginTop: 8,
                }}
              >
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={prefs.min_health_score_to_notify}
                  onChange={(e) =>
                    set("min_health_score_to_notify", Number(e.target.value))
                  }
                  style={{ flex: 1, accentColor: "#3b82f6" }}
                />
                <span
                  style={{
                    minWidth: 40,
                    textAlign: "right",
                    color: "#e2e8f0",
                    fontWeight: 700,
                    fontFamily: "monospace",
                  }}
                >
                  {prefs.min_health_score_to_notify === 0
                    ? "All"
                    : `< ${prefs.min_health_score_to_notify}`}
                </span>
              </div>
              <p style={{ color: "#475569", fontSize: "0.75rem", margin: "4px 0 0" }}>
                {prefs.min_health_score_to_notify === 0
                  ? "Notify on every completed run regardless of health score."
                  : `Only send run-complete emails when health score is below ${prefs.min_health_score_to_notify}.`}
              </p>
            </div>

            {/* Save button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: "1.5rem",
              }}
            >
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "0.6rem 1.4rem",
                  cursor: saving ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Save preferences"}
              </button>
              {saveMsg && (
                <span style={{ color: "#86efac", fontSize: "0.85rem" }}>{saveMsg}</span>
              )}
            </div>
          </div>

          {/* Notification history */}
          <div
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 12,
              padding: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <h2 style={{ color: "#e2e8f0", fontWeight: 700, fontSize: "1.05rem", margin: 0 }}>
                Notification History
              </h2>
              <span style={{ color: "#475569", fontSize: "0.78rem" }}>
                Last 20 notifications
              </span>
            </div>
            <HistoryTable entries={history} />
          </div>
        </>
      )}
    </div>
  );
}
