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
  if (prob >= 70) return "text-emerald-400";
  if (prob >= 40) return "text-yellow-400";
  return "text-red-400";
}

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
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-300">{label}</h3>
        <button
          onClick={handleCopy}
          className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600 transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

function ProposalResult({ proposal }: { proposal: GrantProposal }) {
  const [activeSection, setActiveSection] = useState<SectionKey>("specific_aims");

  return (
    <div className="space-y-6 rounded-xl border border-slate-700 bg-slate-800/60 p-6">
      {/* Success probability */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
          Success Probability
        </p>
        <p className={`text-6xl font-black ${successColor(proposal.success_probability)}`}>
          {proposal.success_probability.toFixed(1)}%
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <p className="text-xs text-slate-400 mb-1">Recommended Program</p>
          <p className="text-sm font-semibold text-indigo-300">{proposal.recommended_program}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <p className="text-xs text-slate-400 mb-1">Word Count</p>
          <p className="text-xl font-bold text-white">{proposal.total_word_count.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <p className="text-xs text-slate-400 mb-1">Est. Pages</p>
          <p className="text-xl font-bold text-white">{proposal.estimated_page_count}</p>
        </div>
      </div>

      {/* Checklist */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Checklist
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {proposal.checklist.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg bg-slate-700/50 px-3 py-2"
            >
              <span
                className={`mt-0.5 ${item.done ? "text-emerald-400" : "text-slate-500"}`}
              >
                {item.done ? "✓" : "○"}
              </span>
              <span
                className={`text-sm ${item.done ? "text-slate-200" : "text-slate-400"}`}
              >
                {item.item}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div>
        <div className="flex flex-wrap gap-1 border-b border-slate-700 mb-4">
          {SECTION_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveSection(k)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                activeSection === k
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
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
    <div className="flex min-h-screen bg-slate-950 text-white">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        <h1 className="mb-1 text-3xl font-black tracking-tight text-white">
          Grant Proposal Generator
        </h1>
        <p className="mb-8 text-slate-400">
          NSF / DOE / DARPA proposals generated from your experimental data.
        </p>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-slate-700 bg-slate-800/60 p-6 mb-8"
        >
          {/* Title + Agency */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Proposal Title *
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="Quantum Error Mitigation for Near-Term Devices"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Agency *
              </label>
              <select
                value={agency}
                onChange={(e) => setAgency(e.target.value as Agency)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                PI Name *
              </label>
              <input
                required
                value={piName}
                onChange={(e) => setPiName(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Institution *
              </label>
              <input
                required
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="MIT"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Program (optional)
              </label>
              <input
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="e.g. QISE"
              />
            </div>
          </div>

          {/* Algorithm + Backend + Qubits */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Algorithm *
              </label>
              <input
                required
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="VQE"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Backend *
              </label>
              <input
                required
                value={backend}
                onChange={(e) => setBackend(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="ibm_brisbane"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Qubits *
              </label>
              <input
                type="number"
                min={1}
                max={127}
                required
                value={nQubits}
                onChange={(e) => setNQubits(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Fidelity + Budget + Duration */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Fidelity (optional)
              </label>
              <input
                type="number"
                step="0.001"
                min={0}
                max={1}
                value={fidelity}
                onChange={(e) => setFidelity(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="0.95"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Budget Total $ (optional)
              </label>
              <input
                type="number"
                min={0}
                value={budgetTotal}
                onChange={(e) => setBudgetTotal(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                placeholder="500000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Duration (years) *
              </label>
              <select
                value={durationYears}
                onChange={(e) => setDurationYears(parseInt(e.target.value))}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
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
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Key Results *
              </label>
              <button
                type="button"
                onClick={addKeyResult}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                + Add result
              </button>
            </div>
            <div className="space-y-2">
              {keyResults.map((kr, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={kr}
                    onChange={(e) => updateKeyResult(i, e.target.value)}
                    required={i === 0}
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    placeholder={`Key result ${i + 1}...`}
                  />
                  {keyResults.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeKeyResult(i)}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-slate-400 hover:border-red-700 hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {loading ? "Generating Proposal..." : "Generate Grant Proposal"}
          </button>
        </form>

        {result && <ProposalResult proposal={result} />}
      </div>

      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-700 bg-slate-900 p-5 lg:block">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
          Past Proposals
        </h2>
        {pastLoading ? (
          <p className="text-slate-500 text-sm">Loading...</p>
        ) : pastProposals.length === 0 ? (
          <p className="text-slate-500 text-sm">No proposals yet.</p>
        ) : (
          <div className="space-y-3">
            {pastProposals.map((p) => (
              <div
                key={p.proposal_id}
                className="rounded-lg border border-slate-700 bg-slate-800 p-3"
              >
                <p className="text-sm font-medium text-white line-clamp-2 mb-1">
                  {p.title}
                </p>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-slate-600 bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                    {p.agency}
                  </span>
                  <span
                    className={`text-sm font-bold ${successColor(p.success_probability)}`}
                  >
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
