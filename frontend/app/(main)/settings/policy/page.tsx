"use client";

import { useEffect, useState } from "react";
import { Shield, Save, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { fetchPolicy, savePolicy, PolicyResult } from "../../../../lib/api";

const DEFAULT_POLICY = {
  max_depth: 300,
  min_shots: 512,
  require_calibration: false,
  required_project: false,
};

export default function PolicyPage() {
  const [policy, setPolicy] = useState<PolicyResult | null>(null);
  const [rules, setRules] = useState<string>("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicy()
      .then(p => {
        setPolicy(p);
        setRules(JSON.stringify(p.rules && Object.keys(p.rules).length ? p.rules : DEFAULT_POLICY, null, 2));
        setDescription(p.description ?? "");
      })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load policy"));
  }, []);

  function handleRulesChange(val: string) {
    setRules(val);
    setParseError(null);
    try { JSON.parse(val); }
    catch (e) { setParseError((e as Error).message); }
  }

  async function handleSave() {
    setParseError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rules);
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }
    setSaving(true);
    try {
      await savePolicy("default", description, parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setPolicy(prev => prev ? { ...prev, rules: parsed, active: true } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setRules(JSON.stringify(DEFAULT_POLICY, null, 2));
    setParseError(null);
  }

  if (error) return (
    <main className="page"><div className="empty" style={{ color: "var(--danger)" }}>{error}</div></main>
  );

  const ruleDocs = policy?.rule_docs ?? {};

  return (
    <main className="page">
      <div className="toolbar">
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>
          <Shield size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />
          Policy-as-Code Gates
        </h1>
        {policy?.active && (
          <span style={{ fontSize: 12, background: "var(--ok-bg)", color: "var(--ok)", padding: "3px 10px", borderRadius: 999, fontWeight: 600 }}>
            Policy Active
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 18, alignItems: "start" }}>
        {/* Editor panel */}
        <section className="panel">
          <div className="panel-header">
            <h2>Policy Rules (JSON)</h2>
            <button className="button secondary" onClick={handleReset} style={{ fontSize: 12, height: 28, padding: "0 10px", marginLeft: "auto" }}>
              <RefreshCw size={12} /> Reset defaults
            </button>
          </div>

          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Description</label>
              <input
                className="input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Production circuit quality gate"
                style={{ height: 32 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--muted)" }}>Rules JSON</label>
              <textarea
                value={rules}
                onChange={e => handleRulesChange(e.target.value)}
                rows={20}
                spellCheck={false}
                style={{
                  fontFamily: "monospace",
                  fontSize: 13,
                  width: "100%",
                  resize: "vertical",
                  border: `1px solid ${parseError ? "var(--danger)" : "var(--input-border)"}`,
                  borderRadius: 6,
                  padding: "8px 10px",
                  background: "var(--input-bg)",
                  color: "var(--text)",
                  lineHeight: 1.5,
                }}
              />
              {parseError && (
                <div style={{ fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 5 }}>
                  <XCircle size={12} /> JSON error: {parseError}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="button"
                onClick={() => void handleSave()}
                disabled={saving || !!parseError}
                style={{ height: 36, fontSize: 14 }}
              >
                <Save size={14} /> {saving ? "Saving…" : "Save Policy"}
              </button>
              {saved && (
                <span style={{ fontSize: 13, color: "var(--ok)", display: "flex", alignItems: "center", gap: 5 }}>
                  <CheckCircle size={14} /> Policy saved
                </span>
              )}
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 10px", background: "var(--panel-2)", borderRadius: 6 }}>
              The SDK checks this policy before submitting runs. Violations block submission and print a clear error.
              Set <code>QLAB_POLICY_ENFORCE=true</code> in the SDK to enforce hard blocks.
            </div>
          </div>
        </section>

        {/* Rule reference */}
        <section className="panel">
          <div className="panel-header"><h2>Available Rules</h2></div>
          <div style={{ padding: "0 0 8px" }}>
            {Object.entries(ruleDocs).map(([key, doc]) => (
              <div key={key} style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "monospace", color: "var(--strong)" }}>{key}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{doc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* How to use in SDK */}
      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header"><h2>SDK Usage</h2></div>
        <pre style={{ margin: 0, padding: "14px 18px", fontSize: 12, lineHeight: 1.6, overflow: "auto" }}>{`# qlab automatically checks the policy before submitting.
# Set QLAB_POLICY_ENFORCE=true to block violations (default: warn only).

import os
os.environ["QLAB_POLICY_ENFORCE"] = "true"

qlab.init(api_url="...", api_key="...")

# If circuit violates the policy, this raises PolicyViolationError:
qlab.track(qc, backend)
# PolicyViolationError: max_depth: 450 > 300 violated.
#   → Reduce circuit depth before submitting.

# Check manually:
violations = qlab.check_policy(qc, parameters={"shots": 100})
for v in violations:
    print(v["message"])`}</pre>
      </section>
    </main>
  );
}
