"use client";
import { useEffect, useState } from "react";
import {
  ApiCredential, CredentialTestResult, AIProviderMeta,
  listCredentials, createCredential, deleteCredential, testCredential, updateCredential,
  getAIProviderSettings, setAIProviderPreference,
} from "../../../lib/api";
import { Key, Plus, Trash2, CheckCircle, XCircle, RefreshCw, Eye, EyeOff, Shield, Bot, Zap } from "lucide-react";

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

const QUANTUM_PROVIDERS = ["ibm", "ionq", "braket", "rigetti"];
const AI_PROVIDERS = ["anthropic", "openai", "groq", "mistral", "gemini", "custom", "agent"];
const ALL_PROVIDERS = [...QUANTUM_PROVIDERS, ...AI_PROVIDERS, "other"];

const PROVIDER_COLORS: Record<string, string> = {
  ibm: "#6929c4", ionq: "#0f62fe", braket: "#ff9900", rigetti: "#2b5ce6",
  anthropic: "#d97706", openai: "#10a37f", groq: "#f55036", mistral: "#ff6b35",
  gemini: "#4285f4", custom: "#8b5cf6", agent: "#06b6d4", other: "#6b7280",
};

const PROVIDER_LABELS: Record<string, string> = {
  ibm: "IBM Quantum", ionq: "IonQ", braket: "Amazon Braket", rigetti: "Rigetti",
  anthropic: "Claude (Anthropic)", openai: "GPT (OpenAI)", groq: "Groq",
  mistral: "Mistral AI", gemini: "Gemini (Google)", custom: "Custom (OpenAI-compatible)",
  agent: "Custom Agent (webhook)", other: "Other",
};

const AI_PROVIDER_NOTES: Record<string, string> = {
  anthropic: "Get your key at console.anthropic.com",
  openai: "Get your key at platform.openai.com",
  groq: "Free tier available at console.groq.com",
  mistral: "Get your key at console.mistral.ai",
  gemini: "Get your key at aistudio.google.com",
  custom: "Enter your base URL and API key (leave key blank for local models like Ollama)",
  agent: "Point to any HTTP endpoint you control — LangChain, CrewAI, n8n, custom FastAPI, etc. Q-Lab will POST {prompt, system, max_tokens} and read {content} from the response.",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    valid: { cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "Valid" },
    invalid: { cls: "text-red-400 bg-red-500/10 border-red-500/20", label: "Invalid" },
    error: { cls: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", label: "Error" },
    untestable: { cls: "text-slate-400 bg-slate-500/10 border-slate-500/20", label: "Untestable" },
  };
  const s = map[status] ?? map.untestable;
  return <span className={`text-xs px-2 py-0.5 rounded border font-medium ${s.cls}`}>{s.label}</span>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CredentialsPage() {
  const [creds, setCreds] = useState<ApiCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, CredentialTestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ provider: "ibm", label: "", api_key: "", base_url: "", expires_at: "" });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterProvider, setFilterProvider] = useState("all");

  // AI preference state
  const [preferredAI, setPreferredAI] = useState<string | null>(null);
  const [aiProviders, setAiProviders] = useState<AIProviderMeta[]>([]);
  const [aiPrefSaving, setAiPrefSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [data, aiSettings] = await Promise.all([
        listCredentials(filterProvider !== "all" ? filterProvider : undefined),
        getAIProviderSettings().catch(() => null),
      ]);
      setCreds(data);
      if (aiSettings) {
        setPreferredAI(aiSettings.preferred_provider);
        setAiProviders(aiSettings.available_providers);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterProvider]);

  const handleCreate = async () => {
    const needsUrl = form.provider === "custom" || form.provider === "agent";
    const apiKey = needsUrl
      ? `${form.base_url.trim()}|||${form.api_key.trim()}`
      : form.api_key;
    if (!form.label) { setError("Label is required"); return; }
    if (form.provider === "custom" && !form.base_url.trim()) { setError("Base URL is required for custom provider"); return; }
    if (form.provider === "agent" && !form.base_url.trim()) { setError("Webhook URL is required"); return; }
    setSaving(true); setError(null);
    try {
      await createCredential({ provider: form.provider, label: form.label, api_key: apiKey, expires_at: form.expires_at || undefined });
      setShowForm(false);
      setForm({ provider: "ibm", label: "", api_key: "", base_url: "", expires_at: "" });
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (credId: string) => {
    await deleteCredential(credId);
    setCreds(c => c.filter(x => x.cred_id !== credId));
  };

  const handleTest = async (credId: string) => {
    setTesting(t => ({ ...t, [credId]: true }));
    try {
      const result = await testCredential(credId);
      setTestResults(r => ({ ...r, [credId]: result }));
    } catch (e: unknown) {
      setTestResults(r => ({ ...r, [credId]: { cred_id: credId, provider: "", status: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
    setTesting(t => ({ ...t, [credId]: false }));
  };

  const handleToggle = async (cred: ApiCredential) => {
    await updateCredential(cred.cred_id, { is_active: !cred.is_active });
    await load();
  };

  const handleSetAIPref = async (provider: string) => {
    setAiPrefSaving(true);
    try {
      await setAIProviderPreference(provider);
      setPreferredAI(provider);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAiPrefSaving(false); }
  };

  const hasAIKey = (provider: string) => creds.some(c => c.provider === provider && c.is_active);
  const inputStyle = { display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" as const };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <Shield size={28} color="#3b82f6" /> Credential Vault
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            Store API keys for quantum backends and AI providers — encrypted at rest.
          </p>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 600 }}>
          <Plus size={16} /> Add Key
        </button>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      {/* AI Provider Preference Card */}
      <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
          <Bot size={18} color="#a78bfa" />
          <h2 style={{ color: "#e2e8f0", fontWeight: 600, fontSize: "1rem", margin: 0 }}>Preferred AI Provider</h2>
          <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#475569" }}>Used for insights, assistant, circuit designer, etc.</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {AI_PROVIDERS.map(p => {
            const hasCred = hasAIKey(p);
            const isPreferred = preferredAI === p;
            return (
              <button key={p} onClick={() => handleSetAIPref(p)} disabled={aiPrefSaving}
                title={hasCred ? `Use ${PROVIDER_LABELS[p]}` : `Add a ${PROVIDER_LABELS[p]} key first`}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "0.45rem 0.9rem", borderRadius: 8, fontSize: "0.82rem", fontWeight: isPreferred ? 700 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                  background: isPreferred ? PROVIDER_COLORS[p] + "22" : "transparent",
                  border: `1px solid ${isPreferred ? PROVIDER_COLORS[p] : "#334155"}`,
                  color: isPreferred ? PROVIDER_COLORS[p] : hasCred ? "#94a3b8" : "#475569",
                  opacity: aiPrefSaving ? 0.6 : 1,
                }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: hasCred ? PROVIDER_COLORS[p] : "#334155" }} />
                {PROVIDER_LABELS[p]}
                {isPreferred && <Zap size={11} />}
                {!hasCred && <span style={{ fontSize: "0.65rem", color: "#475569" }}>(no key)</span>}
              </button>
            );
          })}
        </div>
        {preferredAI && (
          <p style={{ marginTop: 10, fontSize: "0.8rem", color: "#64748b" }}>
            Active: <strong style={{ color: PROVIDER_COLORS[preferredAI] ?? "#94a3b8" }}>{PROVIDER_LABELS[preferredAI] ?? preferredAI}</strong>
            {!hasAIKey(preferredAI) && <span style={{ color: "#f59e0b" }}> — add a key below to activate</span>}
          </p>
        )}
      </div>

      {/* Add Key Form */}
      {showForm && (
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#e2e8f0", fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>New API Credential</h3>
          {AI_PROVIDER_NOTES[form.provider] && (
            <div style={{ background: "#0f172a", borderRadius: 6, padding: "0.6rem 0.9rem", marginBottom: "1rem", fontSize: "0.8rem", color: "#64748b", border: "1px solid #1e293b" }}>
              💡 {AI_PROVIDER_NOTES[form.provider]}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Provider
              <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} style={inputStyle}>
                <optgroup label="Quantum Backends">
                  {QUANTUM_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p.toUpperCase()}</option>)}
                </optgroup>
                <optgroup label="AI Providers">
                  {AI_PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </optgroup>
                <optgroup label="Other">
                  <option value="other">Other</option>
                </optgroup>
              </select>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Label
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={form.provider === "agent" ? "e.g. My LangChain Agent" : form.provider === "custom" ? "e.g. Local Ollama" : "e.g. Production Token"}
                style={inputStyle} />
            </label>
            {(form.provider === "custom" || form.provider === "agent") && (
              <label style={{ color: "#94a3b8", fontSize: "0.85rem", gridColumn: "1 / -1" }}>
                {form.provider === "agent" ? "Webhook URL" : "Base URL"}
                <input value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  placeholder={form.provider === "agent" ? "https://your-agent.example.com/invoke" : "http://localhost:11434/v1"}
                  style={inputStyle} />
              </label>
            )}
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", gridColumn: "1 / -1" }}>
              {form.provider === "agent"
                ? <span>Auth Token <span style={{ color: "#475569" }}>(optional — sent as Bearer token)</span></span>
                : <span>API Key{form.provider === "custom" && <span style={{ color: "#475569" }}> (optional for local models)</span>}</span>
              }
              <div style={{ position: "relative", marginTop: 4 }}>
                <input type={showKey ? "text" : "password"} value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder={form.provider === "agent" ? "Leave blank for unauthenticated endpoints" : form.provider === "custom" ? "Leave blank for Ollama / no-auth servers" : "Paste your API key here…"}
                  style={{ ...inputStyle, padding: "0.5rem 2.5rem 0.5rem 0.75rem" }} />
                <button onClick={() => setShowKey(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Expires At (optional)
              <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
            <button onClick={handleCreate} disabled={saving}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer", fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save Key"}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ background: "transparent", color: "#64748b", border: "1px solid #334155", borderRadius: 8, padding: "0.55rem 1.2rem", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {["all", ...ALL_PROVIDERS].map(p => (
          <button key={p} onClick={() => setFilterProvider(p)}
            style={{ padding: "0.35rem 0.85rem", borderRadius: 20, border: "1px solid", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
              background: filterProvider === p ? (PROVIDER_COLORS[p] ?? "#3b82f6") : "transparent",
              borderColor: filterProvider === p ? (PROVIDER_COLORS[p] ?? "#3b82f6") : "#334155",
              color: filterProvider === p ? "#fff" : "#64748b" }}>
            {p === "all" ? "All" : (PROVIDER_LABELS[p] ?? p.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Credentials list */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: "4rem" }}>Loading credentials…</div>
      ) : creds.length === 0 ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: "4rem" }}>
          <Key size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
          <p>No credentials stored yet. Add your first API key above.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {creds.map(cred => {
            const testResult = testResults[cred.cred_id];
            const isAI = AI_PROVIDERS.includes(cred.provider);
            return (
              <div key={cred.cred_id}
                style={{ background: "#1e293b", borderRadius: 12,
                  border: `1px solid ${cred.provider === preferredAI && isAI ? PROVIDER_COLORS[cred.provider] + "55" : cred.is_active ? "#334155" : "#1e293b"}`,
                  padding: "1rem 1.25rem", opacity: cred.is_active ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: PROVIDER_COLORS[cred.provider] ?? "#6b7280" }} />
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                        {cred.label}
                        <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 400, background: "#0f172a", padding: "0 6px", borderRadius: 4 }}>
                          {PROVIDER_LABELS[cred.provider] ?? cred.provider.toUpperCase()}
                        </span>
                        {isAI && cred.provider === preferredAI && (
                          <span style={{ fontSize: "0.7rem", color: PROVIDER_COLORS[cred.provider], background: PROVIDER_COLORS[cred.provider] + "22", padding: "0 6px", borderRadius: 4, display: "flex", alignItems: "center", gap: 3 }}>
                            <Zap size={9} /> Preferred AI
                          </span>
                        )}
                        {!cred.is_active && <span style={{ fontSize: "0.7rem", color: "#f59e0b", background: "#78350f22", padding: "0 6px", borderRadius: 4 }}>Inactive</span>}
                      </div>
                      <div style={{ color: "#475569", fontSize: "0.8rem", fontFamily: "monospace" }}>
                        {cred.key_hint} · added {new Date(cred.created_at).toLocaleDateString()}
                        {cred.expires_at && <> · expires {new Date(cred.expires_at).toLocaleDateString()}</>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {testResult && <StatusBadge status={testResult.status} />}
                    {isAI && cred.provider !== preferredAI && cred.is_active && (
                      <button onClick={() => handleSetAIPref(cred.provider)} disabled={aiPrefSaving}
                        style={{ background: "#0f172a", border: `1px solid ${PROVIDER_COLORS[cred.provider]}55`, color: PROVIDER_COLORS[cred.provider], borderRadius: 6, padding: "0.35rem 0.7rem", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 4 }}>
                        <Zap size={11} /> Set Preferred
                      </button>
                    )}
                    <button onClick={() => handleTest(cred.cred_id)} disabled={testing[cred.cred_id]}
                      style={{ background: "#0f172a", border: "1px solid #334155", color: "#3b82f6", borderRadius: 6, padding: "0.4rem 0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem" }}>
                      <RefreshCw size={13} style={testing[cred.cred_id] ? { animation: "spin 1s linear infinite" } : {}} />
                      {testing[cred.cred_id] ? "Testing…" : "Test"}
                    </button>
                    <button onClick={() => handleToggle(cred)} title={cred.is_active ? "Deactivate" : "Activate"}
                      style={{ background: "transparent", border: "1px solid #334155", color: cred.is_active ? "#10b981" : "#64748b", borderRadius: 6, padding: "0.4rem 0.75rem", cursor: "pointer", display: "flex", alignItems: "center" }}>
                      {cred.is_active ? <CheckCircle size={15} /> : <XCircle size={15} />}
                    </button>
                    <button onClick={() => handleDelete(cred.cred_id)} title="Delete"
                      style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#ef4444", borderRadius: 6, padding: "0.4rem 0.75rem", cursor: "pointer" }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {testResult?.error && (
                  <div style={{ marginTop: 8, padding: "0.5rem 0.75rem", background: "#7f1d1d22", borderRadius: 6, color: "#f87171", fontSize: "0.8rem" }}>
                    {testResult.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
