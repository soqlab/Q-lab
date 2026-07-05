"use client";

import { useState, useEffect, useCallback } from "react";
import {
  generateGrantProposal,
  listGrantProposals,
  GrantProposal,
} from "@/lib/api";

const AGENCIES = ["NSF", "DOE", "DARPA", "IARPA"] as const;
type Agency = typeof AGENCIES[number];
const DURATION_YEARS = [1, 2, 3, 4, 5] as const;

const SECTION_KEYS = [
  "specific_aims",
  "significance",
  "innovation",
  "approach",
  "preliminary_results",
  "broader_impacts",
  "budget_justification",
] as const;
type SectionKey = typeof SECTION_KEYS[number];

const SECTION_LABELS: Record<SectionKey, string> = {
  specific_aims: "Specific Aims",
  significance: "Significance",
  innovation: "Innovation",
  approach: "Approach",
  preliminary_results: "Preliminary Results",
  broader_impacts: "Broader Impacts",
  budget_justification: "Budget Justification",
};

function successColor(prob: number): string {
  if (prob >= 70) return "var(--ok)";
  if (prob >= 40) return "#f59e0b";
  return "var(--danger)";
}

const fieldLabelStyle = {
  display: "block" as const,
  marginBottom: 4,
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.12em",
  color: "var(--muted)",
};

function SectionTab({
  content,
  label,
}: {
  content: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</h3>
        <button
          onClick={handleCopy}
          style={{ borderRadius: 6, background: "var(--line)", padding: "4px 8px", fontSize: 12, color: "var(--text)", cursor: "pointer", border: "none" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre style={{ maxHeight: 320, overflowY: "auto", borderRadius: 8, background: "var(--surface)", padding: 16, fontSize: 12, color: "var(--text)", fontFamily: "ui-monospace,monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, border: "1px solid var(--line)" }}>
        {content}
      </pre>
    </div>
  );
}

function ProposalResult({ proposal }: { proposal: GrantProposal }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("specific_aims");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 24 }}>
      {/* Success probability */}
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", marginBottom: 8 }}>
          Success Probability
        </p>
        <p style={{ fontSize: 60, fontWeight: 900, color: successColor(proposal.success_probability) }}>
          {proposal.success_probability.toFixed(1)}%
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, textAlign: "center" }}>
        <div style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 12 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Recommended Program</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--strong)" }}>{proposal.recommended_program}</p>
        </div>
        <div style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 12 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Word Count</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{proposal.total_word_count.toLocaleString()}</p>
        </div>
        <div style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 12 }}>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Est. Pages</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{proposal.estimated_page_count}</p>
        </div>
      </div>

      {/* Checklist */}
      <div>
        <p style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
          Checklist
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
          {(proposal.checklist ?? []).map((item, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 8, background: "rgba(255,255,255,0.05)", padding: "8px 12px" }}
            >
              <span style={{ marginTop: 2, color: item.done ? "var(--ok)" : "var(--muted)" }}>
                {item.done ? "✓" : "○"}
              </span>
              <span style={{ fontSize: 13, color: item.done ? "var(--text)" : "var(--muted)" }}>
                {item.item}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
          {SECTION_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveSection(k)}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 500,
                background: "none",
                border: "none",
                borderBottom: activeSection === k ? "2px solid var(--strong)" : "2px solid transparent",
                color: activeSection === k ? "var(--strong)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {SECTION_LABELS[k]}
            </button>
          ))}
        </div>
        <SectionTab
          content={proposal.sections[activeSection]}
          label={SECTION_LABELS[activeSection]}
        />
      </div>
    </div>
  );
}

export default function GrantProposalPage() {
  // Form state
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState<Agency>("NSF");
  const [program, setProgram] = useState("");
  const [piName, setPiName] = useState("");
  const [institution, setInstitution] = useState("");
  const [algorithm, setAlgorithm] = useState("");
  const [backend, setBackend] = useState("ibm_brisbane");
  const [nQubits, setNQubits] = useState(10);
  const [fidelity, setFidelity] = useState("");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [durationYears, setDurationYears] = useState<number>(3);
  const [keyResults, setKeyResults] = useState<string[]>([""]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrantProposal | null>(null);

  const [pastProposals, setPastProposals] = useState<GrantProposal[]>([]);
  const [pastLoading, setPastLoading] = useState(true);

  const loadPast = useCallback(async () => {
    setPastLoading(true);
    try {
      const data = await listGrantProposals();
      setPastProposals(data.proposals);
    } catch {
      // non-blocking
    } finally {
      setPastLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPast();
  }, [loadPast]);

  const addKeyResult = () => setKeyResults((prev) => [...prev, ""]);
  const removeKeyResult = (i: number) =>
    setKeyResults((prev) => prev.filter((_, idx) => idx !== i));
  const updateKeyResult = (i: number, val: string) =>
    setKeyResults((prev) => prev.map((v, idx) => (idx === i ? val : v)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const req = {
        title,
        agency,
        ...(program.trim() ? { program: program.trim() } : {}),
        pi_name: piName,
        institution,
        key_results: keyResults.filter(Boolean),
        algorithm,
        backend,
        n_qubits: nQubits,
        ...(fidelity !== "" ? { fidelity: parseFloat(fidelity) } : {}),
        ...(budgetTotal !== "" ? { budget_total: parseFloat(budgetTotal) } : {}),
        duration_years: durationYears,
      };
      const proposal = await generateGrantProposal(req);
      setResult(proposal);
      loadPast();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", color: "var(--text)" }}>
      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <h1 style={{ marginBottom: 4, fontSize: 30, fontWeight: 900, color: "var(--text)" }}>
          Grant Proposal Generator
        </h1>
        <p style={{ marginBottom: 32, color: "var(--muted)" }}>
          NSF / DOE / DARPA proposals generated from your experimental data.
        </p>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 20, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", padding: 24, marginBottom: 32 }}
        >
          {/* Title + Agency */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <div>
              <label style={fieldLabelStyle}>
                Proposal Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="Quantum Error Mitigation for Near-Term Devices"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Agency *
              </label>
              <select
                value={agency}
                onChange={(e) => setAgency(e.target.value as Agency)}
                className="input"
                style={{ width: "100%" }}
              >
                {AGENCIES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* PI + Institution + Program */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            <div>
              <label style={fieldLabelStyle}>
                PI Name *
              </label>
              <input
                required
                value={piName}
                onChange={(e) => setPiName(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Institution *
              </label>
              <input
                required
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="MIT"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Program (optional)
              </label>
              <input
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="e.g. QISE"
              />
            </div>
          </div>

          {/* Algorithm + Backend + Qubits */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            <div>
              <label style={fieldLabelStyle}>
                Algorithm *
              </label>
              <input
                required
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="VQE"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Backend *
              </label>
              <input
                required
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="ibm_brisbane"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Qubits *
              </label>
              <input
                type="number"
                min={1}
                max={127}
                required
                value={nQubits}
                onChange={(e) => setNQubits(parseInt(e.target.value) || 1)}
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {/* Fidelity + Budget + Duration */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            <div>
              <label style={fieldLabelStyle}>
                Fidelity (optional)
              </label>
              <input
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={fidelity}
                onChange={(e) => setFidelity(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="0.95"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Budget Total $ (optional)
              </label>
              <input
                type="number"
                min={0}
                value={budgetTotal}
                onChange={(e) => setBudgetTotal(e.target.value)}
                className="input"
                style={{ width: "100%" }}
                placeholder="500000"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>
                Duration (years) *
              </label>
              <select
                value={durationYears}
                onChange={(e) => setDurationYears(parseInt(e.target.value))}
                className="input"
                style={{ width: "100%" }}
              >
                {DURATION_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y} year{y > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Key Results */}
          <div>
            <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
                Key Results *
              </label>
              <button
                type="button"
                onClick={addKeyResult}
                style={{ fontSize: 12, color: "var(--strong)", background: "none", border: "none", cursor: "pointer" }}
              >
                + Add result
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {keyResults.map((kr, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <input
                    value={kr}
                    onChange={(e) => updateKeyResult(i, e.target.value)}
                    required={i === 0}
                    className="input"
                    style={{ flex: 1 }}
                    placeholder={`Key result ${i + 1}...`}
                  />
                  {keyResults.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeKeyResult(i)}
                      style={{ borderRadius: 8, border: "1px solid var(--line)", padding: "8px 12px", color: "var(--muted)", background: "none", cursor: "pointer" }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ borderRadius: 8, border: "1px solid var(--danger)", background: "rgba(239,68,68,0.1)", padding: "12px 16px", fontSize: 13, color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="button"
            style={{ width: "100%", opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}
          >
            {loading ? "Generating Proposal..." : "Generate Grant Proposal"}
          </button>
        </form>

        {result && <ProposalResult proposal={result} />}
      </div>

      {/* Sidebar */}
      <aside style={{ width: 288, flexShrink: 0, overflowY: "auto", borderLeft: "1px solid var(--line)", background: "var(--surface)", padding: 20 }}>
        <h2 style={{ marginBottom: 16, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
          Past Proposals
        </h2>
        {pastLoading ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>
        ) : pastProposals.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>No proposals yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(pastProposals ?? []).map((p) => (
              <div
                key={p.proposal_id}
                style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", padding: 12 }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", WebkitLineClamp: 2, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 4 }}>
                  {p.title}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ borderRadius: 999, border: "1px solid var(--line)", background: "var(--line)", padding: "2px 8px", fontSize: 12, color: "var(--text)" }}>
                    {p.agency}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: successColor(p.success_probability) }}>
                    {p.success_probability.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
