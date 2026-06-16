"use client";

import { useState, useRef, useEffect } from "react";
import {
  chatQFM,
  predictFidelityQFM,
  QFMSession,
  QFMFidelityPrediction,
} from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string | QFMSession;
};

type FidelityForm = {
  circuit_qasm: string;
  backend: string;
  n_qubits: number;
  depth: number;
};

export default function QFMPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [fidelityForm, setFidelityForm] = useState<FidelityForm>({
    circuit_qasm: "",
    backend: "ibm_brisbane",
    n_qubits: 5,
    depth: 10,
  });
  const [prediction, setPrediction] = useState<QFMFidelityPrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [predError, setPredError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setChatError(null);
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    try {
      const res = await chatQFM({
        session_id: sessionId ?? undefined,
        message: trimmed,
      });
      setSessionId(res.session_id);
      setMessages((prev) => [...prev, { role: "assistant", content: res }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setSending(false);
    }
  }

  async function handlePredict() {
    setPredError(null);
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await predictFidelityQFM(fidelityForm);
      setPrediction(res);
    } catch (e) {
      setPredError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  }

  function handleFollowUp(text: string) {
    setInput(text);
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Quantum Foundation Model</h1>
      <p className="text-gray-400 text-sm mb-6">
        AI-powered quantum research assistant backed by physics knowledge and
        literature.
      </p>

      <div className="flex gap-6">
        {/* ── Left: Chat ── */}
        <div className="flex-1 flex flex-col bg-gray-800 rounded-xl overflow-hidden min-h-[70vh]">
          {/* Message history */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-12">
                Ask anything about quantum circuits, backends, or error
                mitigation…
              </p>
            )}
            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2 max-w-[75%] text-sm">
                      {msg.content as string}
                    </div>
                  </div>
                );
              }
              const session = msg.content as QFMSession;
              return (
                <div key={i} className="flex flex-col gap-2 max-w-[85%]">
                  <div className="bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-gray-300 leading-relaxed">
                        {session.reply}
                      </span>
                      <span
                        className={`ml-auto shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          session.confidence >= 0.8
                            ? "bg-green-700 text-green-200"
                            : session.confidence >= 0.5
                            ? "bg-yellow-700 text-yellow-200"
                            : "bg-red-800 text-red-200"
                        }`}
                      >
                        {Math.round(session.confidence * 100)}% conf
                      </span>
                    </div>

                    {session.citations.length > 0 && (
                      <div className="mt-2 border-t border-gray-600 pt-2">
                        <p className="text-gray-400 text-xs mb-1">Citations</p>
                        <ul className="space-y-1">
                          {session.citations.map((c, ci) => (
                            <li key={ci} className="text-xs text-indigo-300">
                              [{c.arxiv_id}] {c.title}{" "}
                              <span className="text-gray-500">
                                ({Math.round(c.relevance * 100)}%)
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {session.follow_ups.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {session.follow_ups.map((fu, fi) => (
                        <button
                          key={fi}
                          onClick={() => handleFollowUp(fu)}
                          className="text-xs bg-gray-700 hover:bg-gray-600 text-indigo-300 border border-gray-600 rounded-full px-3 py-1 transition-colors"
                        >
                          {fu}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {sending && (
              <div className="flex">
                <div className="bg-gray-700 rounded-2xl px-4 py-2 text-sm text-gray-400 animate-pulse">
                  Thinking…
                </div>
              </div>
            )}
            {chatError && (
              <p className="text-red-400 text-sm">{chatError}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="p-4 border-t border-gray-700 flex gap-2">
            <input
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="Ask the Quantum Foundation Model…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              disabled={sending}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Send
            </button>
          </div>
        </div>

        {/* ── Right: Fidelity Predictor ── */}
        <div className="w-80 shrink-0 flex flex-col gap-4">
          <div className="bg-gray-800 rounded-xl p-4">
            <h2 className="font-semibold text-gray-200 mb-3">
              Fidelity Predictor
            </h2>

            <label className="block text-xs text-gray-400 mb-1">
              Circuit QASM
            </label>
            <textarea
              rows={4}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-3 font-mono"
              placeholder="OPENQASM 2.0; …"
              value={fidelityForm.circuit_qasm}
              onChange={(e) =>
                setFidelityForm((f) => ({ ...f, circuit_qasm: e.target.value }))
              }
            />

            <label className="block text-xs text-gray-400 mb-1">Backend</label>
            <select
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 mb-3"
              value={fidelityForm.backend}
              onChange={(e) =>
                setFidelityForm((f) => ({ ...f, backend: e.target.value }))
              }
            >
              <option value="ibm_brisbane">ibm_brisbane</option>
              <option value="ibm_kyoto">ibm_kyoto</option>
              <option value="ionq_aria_1">ionq_aria_1</option>
              <option value="quantinuum_h2">quantinuum_h2</option>
            </select>

            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">
                  Qubits
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={fidelityForm.n_qubits}
                  onChange={(e) =>
                    setFidelityForm((f) => ({
                      ...f,
                      n_qubits: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">
                  Depth
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={fidelityForm.depth}
                  onChange={(e) =>
                    setFidelityForm((f) => ({
                      ...f,
                      depth: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <button
              onClick={handlePredict}
              disabled={predicting || !fidelityForm.circuit_qasm.trim()}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {predicting ? "Predicting…" : "Predict Fidelity"}
            </button>

            {predError && (
              <p className="text-red-400 text-xs mt-2">{predError}</p>
            )}
          </div>

          {prediction && (
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              {/* Big fidelity number */}
              <div className="text-center">
                <div className="text-5xl font-bold text-violet-400">
                  {Math.round(prediction.predicted_fidelity * 100)}%
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  Predicted Fidelity
                </div>
              </div>

              <div className="text-center text-gray-300 text-sm">
                &plusmn;{(prediction.uncertainty * 100).toFixed(1)}% uncertainty
              </div>

              <div className="bg-gray-900 rounded-lg p-2 text-xs text-gray-300 text-center">
                CI [{(prediction.confidence_interval[0] * 100).toFixed(1)}%,{" "}
                {(prediction.confidence_interval[1] * 100).toFixed(1)}%]
              </div>

              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Dominant noise</span>
                  <span className="text-yellow-300 font-medium">
                    {prediction.dominant_noise}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Mitigation</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      prediction.mitigation_recommended === "recommended" ||
                      prediction.mitigation_recommended === "strongly_recommended"
                        ? "bg-orange-700 text-orange-200"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {prediction.mitigation_recommended}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Improvement potential</span>
                  <span className="text-green-400 font-medium">
                    +{(prediction.improvement_potential * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
