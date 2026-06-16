"use client";
import { useState, useEffect } from "react";
import { listChallenges, getChallengeLeaderboard, submitToChallenge, Challenge, ChallengeSubmission } from "@/lib/api";

const DIFFICULTY_COLORS: Record<string, string> = {
  medium: "text-yellow-400 bg-yellow-900/30",
  hard: "text-orange-400 bg-orange-900/30",
  expert: "text-red-400 bg-red-900/30",
};

export default function ChallengesPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selected, setSelected] = useState<Challenge | null>(null);
  const [leaderboard, setLeaderboard] = useState<object[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitValue, setSubmitValue] = useState("");
  const [submitLabel, setSubmitLabel] = useState("My Team");
  const [mySubmission, setMySubmission] = useState<ChallengeSubmission | null>(null);

  useEffect(() => {
    listChallenges()
      .then(r => { setChallenges(r.challenges); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  async function selectChallenge(c: Challenge) {
    setSelected(c); setMySubmission(null);
    try {
      const lb = await getChallengeLeaderboard(c.challenge_id);
      setLeaderboard(lb.entries);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function submit() {
    if (!selected || !submitValue) return;
    setSubmitting(true); setError("");
    try {
      const r = await submitToChallenge(selected.challenge_id, { value: Number(submitValue), label: submitLabel });
      setMySubmission(r);
      const lb = await getChallengeLeaderboard(selected.challenge_id);
      setLeaderboard(lb.entries);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading challenges...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Community Challenges</h1>
      <p className="text-gray-400">Compete on curated quantum computing benchmarks, track your rank against global researchers, and claim prizes.</p>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          {challenges.map(c => (
            <div key={c.challenge_id}
              onClick={() => selectChallenge(c)}
              className={`bg-gray-900 rounded-lg p-5 cursor-pointer border transition-colors ${selected?.challenge_id === c.challenge_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${DIFFICULTY_COLORS[c.difficulty] ?? "text-gray-400 bg-gray-800"}`}>
                      {c.difficulty}
                    </span>
                    <span className="font-semibold text-sm">{c.title}</span>
                  </div>
                  <p className="text-xs text-gray-400 line-clamp-2">{c.description}</p>
                  <div className="flex gap-3 mt-2 text-xs text-gray-500">
                    <span>{c.participants} participants</span>
                    <span>· Metric: {c.metric}</span>
                    <span>· Target: {c.target_value}</span>
                  </div>
                </div>
              </div>
              {c.leader && (
                <div className="mt-2 text-xs text-indigo-400">Leader: {c.leader} ({c.leader_value})</div>
              )}
              <div className="mt-2 text-xs text-yellow-400">{c.prize}</div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="space-y-4">
            <div className="bg-gray-900 rounded-lg p-5 space-y-4">
              <h2 className="font-semibold">{selected.title}</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Baseline:</span> <span className="font-mono">{selected.baseline_value}</span></div>
                <div><span className="text-gray-500">Target:</span> <span className="font-mono text-green-400">{selected.target_value}</span></div>
                <div><span className="text-gray-500">Qubits:</span> {selected.n_qubits_min}–{selected.n_qubits_max}</div>
                <div><span className="text-gray-500">Deadline:</span> {selected.deadline.slice(0, 10)}</div>
              </div>

              <div className="space-y-2">
                <label className="text-sm text-gray-400">Your {selected.metric} value</label>
                <div className="flex gap-2">
                  <input type="number" step="any" value={submitValue} onChange={e => setSubmitValue(e.target.value)}
                    placeholder="0.00" className="flex-1 bg-gray-800 text-white font-mono px-3 py-2 rounded border border-gray-700" />
                  <input value={submitLabel} onChange={e => setSubmitLabel(e.target.value)}
                    placeholder="Team name" className="w-32 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm" />
                </div>
                <button onClick={submit} disabled={submitting}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium disabled:opacity-50">
                  {submitting ? "Submitting..." : "Submit Score"}
                </button>
              </div>

              {mySubmission && (
                <div className="bg-indigo-900/30 border border-indigo-700 rounded p-4 text-center">
                  <div className="text-2xl font-bold text-indigo-300">Rank #{mySubmission.rank}</div>
                  <div className="text-sm text-gray-400">{mySubmission.percentile.toFixed(1)}th percentile</div>
                </div>
              )}
            </div>

            {leaderboard && (
              <div className="bg-gray-900 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700 font-medium text-sm">Leaderboard</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs">
                      {["#", "Team", selected.metric, "Backend"].map(h => <th key={h} className="text-left py-2 px-4">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(leaderboard as { rank: number; label: string; value: number; backend: string }[]).map((e, i) => (
                      <tr key={i} className={`border-b border-gray-800 ${i === 0 ? "bg-yellow-900/10" : ""}`}>
                        <td className="py-2 px-4 font-mono text-gray-500">{e.rank ?? i + 1}</td>
                        <td className="py-2 px-4">{e.label}</td>
                        <td className="py-2 px-4 font-mono">{e.value}</td>
                        <td className="py-2 px-4 text-gray-500 text-xs">{e.backend}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
