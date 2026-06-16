"use client";
import { useEffect, useState } from "react";
import {
  ApiCredential, CredentialTestResult,
  listCredentials, createCredential, deleteCredential, testCredential, updateCredential,
} from "../../../lib/api";
import { Key, Plus, Trash2, CheckCircle, XCircle, RefreshCw, Eye, EyeOff, Shield } from "lucide-react";

const PROVIDERS = ["ibm", "ionq", "braket", "azure", "rigetti", "other"];

const PROVIDER_COLORS: Record<string, string> = {
  ibm: "#6929c4", ionq: "#0f62fe", braket: "#ff9900",
  azure: "#0078d4", rigetti: "#2b5ce6", other: "#6b7280",
};

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

export default function CredentialsPage() {
  const [creds, setCreds] = useState<ApiCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, CredentialTestResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ provider: "ibm", label: "", api_key: "", expires_at: "" });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterProvider, setFilterProvider] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const data = await listCredentials(filterProvider !== "all" ? filterProvider : undefined);
      setCreds(data);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterProvider]);

  const handleCreate = async () => {
    if (!form.label || !form.api_key) return;
    setSaving(true); setError(null);
    try {
      await createCredential({ provider: form.provider, label: form.label, api_key: form.api_key, expires_at: form.expires_at || undefined });
      setShowForm(false); setForm({ provider: "ibm", label: "", api_key: "", expires_at: "" });
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

  const grouped = PROVIDERS.reduce<Record<string, ApiCredential[]>>((acc, p) => {
    acc[p] = creds.filter(c => c.provider === p);
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <Shield size={28} color="#3b82f6" /> Credential Vault
          </h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: 4 }}>
            Encrypted API keys for quantum providers — keys are stored XOR-encrypted and never returned in plaintext.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 600 }}
        >
          <Plus size={16} /> Add Key
        </button>
      </div>

      {error && <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, padding: "0.75rem 1rem", color: "#f87171", marginBottom: "1rem" }}>{error}</div>}

      {showForm && (
        <div style={{ background: "#1e293b", borderRadius: 12, border: "1px solid #334155", padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h3 style={{ color: "#e2e8f0", fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>New API Credential</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Provider
              <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem" }}>
                {PROVIDERS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
              </select>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Label
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. IBM Production Token"
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem", gridColumn: "1 / -1" }}>
              API Key
              <div style={{ position: "relative", marginTop: 4 }}>
                <input type={showKey ? "text" : "password"} value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder="Paste your API key here…"
                  style={{ display: "block", width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 2.5rem 0.5rem 0.75rem", boxSizing: "border-box" }} />
                <button onClick={() => setShowKey(s => !s)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Expires At (optional)
              <input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "0.5rem 0.75rem", boxSizing: "border-box" }} />
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

      <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        {["all", ...PROVIDERS].map(p => (
          <button key={p} onClick={() => setFilterProvider(p)}
            style={{ padding: "0.4rem 0.9rem", borderRadius: 20, border: "1px solid", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
              background: filterProvider === p ? "#3b82f6" : "transparent",
              borderColor: filterProvider === p ? "#3b82f6" : "#334155",
              color: filterProvider === p ? "#fff" : "#94a3b8" }}>
            {p.toUpperCase()}
          </button>
        ))}
      </div>

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
            return (
              <div key={cred.cred_id}
                style={{ background: "#1e293b", borderRadius: 12, border: `1px solid ${cred.is_active ? "#334155" : "#1e293b"}`, padding: "1rem 1.25rem", opacity: cred.is_active ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: PROVIDER_COLORS[cred.provider] ?? "#6b7280" }} />
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                        {cred.label}
                        <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 400, background: "#0f172a", padding: "0 6px", borderRadius: 4 }}>
                          {cred.provider.toUpperCase()}
                        </span>
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
                    <button onClick={() => handleTest(cred.cred_id)} disabled={testing[cred.cred_id]}
                      title="Test credential"
                      style={{ background: "#0f172a", border: "1px solid #334155", color: "#3b82f6", borderRadius: 6, padding: "0.4rem 0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem" }}>
                      <RefreshCw size={13} className={testing[cred.cred_id] ? "spin" : ""} />
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
