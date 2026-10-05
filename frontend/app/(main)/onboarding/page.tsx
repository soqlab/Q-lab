"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../../lib/auth";
import { Copy, CheckCircle2, Key, Package, Code2, Rocket, ExternalLink } from "lucide-react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} title="Copy" style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#10b981" : "#64748b", padding: "2px 4px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
      {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div style={{ position: "relative", background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b", overflow: "hidden", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 14px", borderBottom: "1px solid #1e293b", background: "#0b1120" }}>
        <span style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre style={{ margin: 0, padding: "14px 16px", overflowX: "auto", fontSize: 13, lineHeight: 1.65, color: "#e2e8f0", fontFamily: "ui-monospace, 'Cascadia Code', monospace" }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 20, marginBottom: 36 }}>
      <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, color: "#fff", marginTop: 2 }}>
        {n}
      </div>
      <div style={{ flex: 1 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "#e2e8f0" }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const { token, user } = useAuth();
  const [apiKeys, setApiKeys] = useState<{ name: string; prefix: string; created_at: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("My SDK Key");

  const apiUrl = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}/qlab-api`
    : "https://qlab-backend.onrender.com";

  useEffect(() => {
    if (!token) return;
    fetch("/qlab-api/api/v1/users/me/api-keys", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(d => setApiKeys(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [token]);

  async function createKey() {
    if (!token) return;
    setCreating(true);
    try {
      const res = await fetch("/qlab-api/api/v1/users/me/api-keys", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setNewKey(data.key);
      setApiKeys(prev => [{ name: keyName, prefix: data.key.slice(0, 10) + "…", created_at: new Date().toISOString() }, ...prev]);
    } catch {
    } finally {
      setCreating(false);
    }
  }

  const displayKey = newKey || apiKeys[0]?.prefix?.replace("…", "...") || "qlab_YOUR_API_KEY";

  const installCode = `pip install git+https://github.com/soqlab/Q-lab.git#subdirectory=qlab_sdk`;

  const autoTrackCode = `import qlab

# One line — patches Qiskit automatically
qlab.auto_track(api_key="${displayKey}")

# Now just use Qiskit normally — every run is logged automatically
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

sim = AerSimulator()
job = sim.run(qc, shots=1024)   # ← captured automatically
result = job.result()`;

  const basicCode = `import qlab

qlab.init(
    api_key="${displayKey}",
    api_url="${apiUrl}",
)

# Manually log a completed run
qlab.log_result(
    run_id=qlab.track(qc, backend="ibm_brisbane"),
    result={"00": 512, "11": 512},
    status="completed",
)`;

  const qiskitCode = `import qlab
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qlab.auto_track(api_key="${displayKey}")
sim = AerSimulator()

with qlab.RunContext("bell-circuit", project="my-project") as run:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()

    job = sim.run(qc, shots=1024)
    result = job.result()
    counts = result.get_counts()

    run.log(results=counts, status="completed")
    # submits automatically on context exit`;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 64px" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Rocket size={22} style={{ color: "#6366f1" }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#e2e8f0" }}>Quick Start</h1>
        </div>
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
          Track your Qiskit experiments in Q-Lab in under 5 minutes.
        </p>
      </div>

      <Step n={1} title="Get an API key">
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#94a3b8" }}>
          API keys authenticate your SDK calls. They&apos;re tied to your account.
        </p>
        {newKey ? (
          <div style={{ background: "#052e16", border: "1px solid #16a34a", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, color: "#4ade80", fontWeight: 600 }}>
              Key created — copy it now, it won&apos;t be shown again.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ fontSize: 13, color: "#86efac", background: "#064e1e", padding: "6px 10px", borderRadius: 6, flex: 1, wordBreak: "break-all" }}>{newKey}</code>
              <CopyButton text={newKey} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder="Key name"
              style={{ flex: 1, maxWidth: 240, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13 }}
            />
            <button
              onClick={createKey}
              disabled={creating}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: creating ? "not-allowed" : "pointer", opacity: creating ? 0.7 : 1 }}
            >
              <Key size={14} />
              {creating ? "Creating…" : "Create API key"}
            </button>
          </div>
        )}
        {apiKeys.length > 0 && (
          <div style={{ fontSize: 12, color: "#475569" }}>
            Your key: <code style={{ marginRight: 8, color: "#86efac", background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>{apiKeys[0].prefix}</code>
            <a href="/credentials" style={{ color: "#6366f1", marginLeft: 4 }}>Manage all keys →</a>
          </div>
        )}
      </Step>

      <Step n={2} title="Install the SDK">
        <p style={{ margin: "0 0 4px", fontSize: 14, color: "#94a3b8" }}>Works in any Python 3.9+ environment.</p>
        <CodeBlock code={installCode} lang="bash" />
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#475569" }}>
          With Qiskit: <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>pip install "git+https://github.com/soqlab/Q-lab.git#subdirectory=qlab_sdk" qiskit qiskit-aer</code>
        </p>
      </Step>

      <Step n={3} title="Enable auto-tracking — one line">
        <p style={{ margin: "0 0 4px", fontSize: 14, color: "#94a3b8" }}>
          Call <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>qlab.auto_track()</code> once and every Qiskit run is captured automatically — no other code changes needed.
        </p>
        <CodeBlock code={autoTrackCode} lang="python" />
      </Step>

      <Step n={4} title="Or use the context manager for full control">
        <p style={{ margin: "0 0 4px", fontSize: 14, color: "#94a3b8" }}>
          Attach results, tags, and project metadata explicitly with <code style={{ background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>RunContext</code>.
        </p>
        <CodeBlock code={qiskitCode} lang="python" />
      </Step>

      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 24, marginTop: 8 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>What happens next?</h3>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["Run History", "/runs", "Every submitted run appears here with health scores and metadata."],
            ["Analytics", "/analytics", "Charts for success rates, qubit distributions, and timing trends."],
            ["Compare Runs", "/compare", "Side-by-side diff of any two runs."],
            ["Projects", "/projects", "Group runs by project slug for team organisation."],
          ].map(([label, href, desc]) => (
            <li key={href as string} style={{ fontSize: 14, color: "#94a3b8" }}>
              <a href={href as string} style={{ color: "#6366f1", fontWeight: 600 }}>{label as string}</a>
              {" — "}{desc as string}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: "#1c1b2e", borderRadius: 8, border: "1px solid #312e81", display: "flex", alignItems: "center", gap: 12 }}>
        <Code2 size={18} style={{ color: "#818cf8", flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          Need help? Open an issue on <a href="https://github.com/soqlab/Q-lab" style={{ color: "#a5b4fc" }} target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </div>
    </main>
  );
}
