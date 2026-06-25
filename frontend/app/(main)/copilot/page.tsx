"use client";
import { useState, useRef, useEffect } from "react";
import { chatWithCopilot, CopilotResponse, CopilotMessage } from "@/lib/api";

const STARTERS = [
  "Why is my VQE not converging?",
  "Compare my last 5 runs and suggest next steps",
  "Which backend should I use for my 8-qubit sensing circuit?",
  "Analyze my calibration trend and forecast issues",
];

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
  }, [messages, loading]);

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "calc(100vh - 70px)",
      maxWidth: 860, margin: "0 auto", padding: "20px 24px 0",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16, flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Q-Lab Copilot</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          AI research assistant with full knowledge of your experiment history, calibration data, and quantum computing literature.
        </p>
      </div>

      {/* Empty state with starter prompts */}
      {messages.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            border: "1px solid var(--accent)", color: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
          }}>⚛</div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Ask me anything about your quantum experiments</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", maxWidth: 640 }}>
            {STARTERS.map(s => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="panel"
                style={{
                  padding: "12px 14px", textAlign: "left", fontSize: 13,
                  color: "var(--text)", cursor: "pointer",
                  border: "1px solid var(--line)", borderRadius: 8,
                  background: "var(--panel)", transition: "border-color 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--strong)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--line)")}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message thread */}
      {messages.length > 0 && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8, display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 10, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "assistant" && (
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0, marginTop: 2,
                  border: "1px solid var(--accent)", color: "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, background: "var(--panel)",
                }}>⚛</div>
              )}
              <div style={{
                maxWidth: "72%",
                padding: "10px 14px",
                borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                fontSize: 14, lineHeight: 1.6,
                background: m.role === "user" ? "var(--strong)" : "var(--panel)",
                color: m.role === "user" ? "#fff" : "var(--text)",
                border: m.role === "user" ? "none" : "1px solid var(--line)",
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                border: "1px solid var(--accent)", color: "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, background: "var(--panel)",
              }}>⚛</div>
              <div style={{
                padding: "12px 16px", borderRadius: "12px 12px 12px 4px",
                background: "var(--panel)", border: "1px solid var(--line)",
                display: "flex", gap: 5, alignItems: "center",
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: "var(--muted)", display: "inline-block",
                    animation: "bounce 1.2s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Follow-up suggestions */}
      {lastResponse && lastResponse.follow_up_questions.length > 0 && messages.length > 0 && (
        <div style={{ display: "flex", gap: 8, paddingTop: 10, flexWrap: "wrap", flexShrink: 0 }}>
          {lastResponse.follow_up_questions.map(q => (
            <button
              key={q}
              onClick={() => setInput(q)}
              style={{
                padding: "4px 12px", borderRadius: 999, fontSize: 12,
                border: "1px solid var(--line)", background: "var(--panel)",
                color: "var(--muted)", cursor: "pointer",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--strong)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--muted)"; }}
            >{q}</button>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 8, flexShrink: 0 }}>{error}</div>}

      {/* Input bar */}
      <div style={{
        display: "flex", gap: 8, padding: "12px 0 16px", flexShrink: 0,
        borderTop: messages.length > 0 ? "1px solid var(--line)" : "none",
        marginTop: messages.length > 0 ? 8 : 0,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask about your experiments, calibration, algorithms…"
          className="input"
          style={{ flex: 1, height: 44, fontSize: 14, minWidth: 0, borderRadius: 10 }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="btn btn-primary"
          style={{ height: 44, padding: "0 20px", fontSize: 14, borderRadius: 10, flexShrink: 0 }}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>

      {/* Footer meta */}
      {lastResponse && (
        <div style={{ paddingBottom: 12, fontSize: 11, color: "var(--muted)", display: "flex", gap: 12, flexShrink: 0 }}>
          <span>Confidence: {(lastResponse.confidence * 100).toFixed(0)}%</span>
          {lastResponse.cited_run_ids.length > 0 && (
            <span>· Cited {lastResponse.cited_run_ids.length} run{lastResponse.cited_run_ids.length > 1 ? "s" : ""}</span>
          )}
          {sessionId && <span>· Session {sessionId.slice(0, 8)}</span>}
        </div>
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
