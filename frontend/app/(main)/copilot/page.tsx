"use client";
import { useState, useRef, useEffect } from "react";
import { chatWithCopilot, CopilotResponse, CopilotMessage } from "@/lib/api";

export default function CopilotPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResponse, setLastResponse] = useState<CopilotResponse | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg: CopilotMessage = { role: "user", content: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    const userInput = input;
    setInput(""); setLoading(true); setError("");
    try {
      const r = await chatWithCopilot({ session_id: sessionId ?? undefined, message: userInput });
      setSessionId(r.session_id);
      setLastResponse(r);
      setMessages(prev => [...prev, { role: "assistant", content: r.reply, timestamp: new Date().toISOString() }]);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const STARTERS = [
    "Why is my VQE not converging?",
    "Compare my last 5 runs and suggest next steps",
    "Which backend should I use for my 8-qubit sensing circuit?",
    "Analyze my calibration trend and forecast issues",
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Q-Lab Copilot</h1>
        <p className="text-gray-400 text-sm">AI research assistant with full knowledge of your experiment history, calibration data, and quantum computing literature.</p>
      </div>

      {messages.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="text-4xl">⚛️</div>
          <p className="text-gray-400">Ask me anything about your quantum experiments</p>
          <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
            {STARTERS.map(s => (
              <button key={s} onClick={() => setInput(s)}
                className="bg-gray-800 hover:bg-gray-700 rounded-lg p-3 text-left text-sm text-gray-300 border border-gray-700 hover:border-indigo-500 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs flex-shrink-0 mt-1">⚛️</div>
              )}
              <div className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-gray-800 text-gray-100 rounded-bl-sm"}`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs">⚛️</div>
              <div className="bg-gray-800 rounded-2xl px-4 py-3 flex gap-1">
                {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {lastResponse && lastResponse.follow_up_questions.length > 0 && messages.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {lastResponse.follow_up_questions.map(q => (
            <button key={q} onClick={() => setInput(q)}
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-full px-3 py-1 text-gray-300">
              {q}
            </button>
          ))}
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <div className="flex gap-3">
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask about your experiments, calibration, algorithms..."
          className="flex-1 bg-gray-800 text-white px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm"
        />
        <button onClick={send} disabled={loading || !input.trim()}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-medium disabled:opacity-50 text-sm">
          Send
        </button>
      </div>

      {lastResponse && (
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
          <span>Confidence: {(lastResponse.confidence * 100).toFixed(0)}%</span>
          {lastResponse.cited_run_ids.length > 0 && <span>· Cited {lastResponse.cited_run_ids.length} run{lastResponse.cited_run_ids.length > 1 ? "s" : ""}</span>}
          {sessionId && <span>· Session {sessionId.slice(0, 8)}</span>}
        </div>
      )}
    </div>
  );
}
