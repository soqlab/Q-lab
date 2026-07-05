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
    <div style={{ minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Quantum Foundation Model</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        AI-powered quantum research assistant backed by physics knowledge and
        literature.
      </p>

      <div style={{ display: "flex", gap: 24 }}>
        {/* ── Left: Chat ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--line)", borderRadius: 12, overflow: "hidden", minHeight: "70vh" }}>
          {/* Message history */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 48 }}>
                Ask anything about quantum circuits, backends, or error
                mitigation…
              </p>
            )}
            {(messages ?? []).map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ background: "var(--strong)", color: "var(--text)", borderRadius: 16, borderTopRightRadius: 4, padding: "8px 16px", maxWidth: "75%", fontSize: 13 }}>
                      {msg.content as string}
                    </div>
                  </div>
                );
              }
              const session = msg.content as QFMSession;
              const confBadgeStyle: React.CSSProperties =
                session.confidence >= 0.8
                  ? { background: "rgba(16,185,129,0.2)", color: "var(--ok)" }
                  : session.confidence >= 0.5
                  ? { background: "rgba(245,158,11,0.2)", color: "#f59e0b" }
                  : { background: "rgba(239,68,68,0.2)", color: "var(--danger)" };
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "85%" }}>
                  <div style={{ background: "var(--line)", borderRadius: 16, borderTopLeftRadius: 4, padding: "12px 16px", fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ color: "var(--text)", lineHeight: 1.6 }}>
                        {session.reply}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          flexShrink: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 999,
                          ...confBadgeStyle,
                        }}
                      >
                        {Math.round(session.confidence * 100)}% conf
                      </span>
                    </div>

                    {(session.citations ?? []).length > 0 && (
                      <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                        <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Citations</p>
                        <ul style={{ display: "flex", flexDirection: "column", gap: 4, listStyle: "none", margin: 0, padding: 0 }}>
                          {(session.citations ?? []).map((c, ci) => (
                            <li key={ci} style={{ fontSize: 12, color: "var(--strong)" }}>
                              [{c.arxiv_id}] {c.title}{" "}
                              <span style={{ color: "var(--muted)" }}>
                                ({Math.round(c.relevance * 100)}%)
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {(session.follow_ups ?? []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {(session.follow_ups ?? []).map((fu, fi) => (
                        <button
                          key={fi}
                          onClick={() => handleFollowUp(fu)}
                          style={{ fontSize: 12, background: "var(--line)", color: "var(--strong)", border: "1px solid var(--line)", borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}
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
              <div style={{ display: "flex" }}>
                <div style={{ background: "var(--line)", borderRadius: 16, padding: "8px 16px", fontSize: 13, color: "var(--muted)" }}>
                  Thinking…
                </div>
              </div>
            )}
            {chatError && (
              <p style={{ color: "var(--danger)", fontSize: 13 }}>{chatError}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={{ padding: 16, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Ask the Quantum Foundation Model…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              disabled={sending}
            />
            <button
              className="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              style={{ opacity: sending || !input.trim() ? 0.5 : 1, cursor: sending || !input.trim() ? "not-allowed" : "pointer" }}
            >
              Send
            </button>
          </div>
        </div>

        {/* ── Right: Fidelity Predictor ── */}
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16 }}>
            <h2 style={{ fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
              Fidelity Predictor
            </h2>

            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              Circuit QASM
            </label>
            <textarea
              rows={4}
              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)", marginBottom: 12, fontFamily: "ui-monospace,monospace", boxSizing: "border-box" }}
              placeholder="OPENQASM 2.0; …"
              value={fidelityForm.circuit_qasm}
              onChange={(e) =>
                setFidelityForm((f) => ({ ...f, circuit_qasm: e.target.value }))
              }
            />

            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Backend</label>
            <select
              className="input"
              style={{ width: "100%", marginBottom: 12 }}
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

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Qubits
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={fidelityForm.n_qubits}
                  onChange={(e) =>
                    setFidelityForm((f) => ({
                      ...f,
                      n_qubits: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  Depth
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  style={{ width: "100%", boxSizing: "border-box" }}
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
              style={{ width: "100%", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 500, padding: "8px 0", borderRadius: 8, border: "none", opacity: predicting || !fidelityForm.circuit_qasm.trim() ? 0.5 : 1, cursor: predicting || !fidelityForm.circuit_qasm.trim() ? "not-allowed" : "pointer" }}
            >
              {predicting ? "Predicting…" : "Predict Fidelity"}
            </button>

            {predError && (
              <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{predError}</p>
            )}
          </div>

          {prediction && (
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Big fidelity number */}
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, fontWeight: 700, color: "#a78bfa" }}>
                  {Math.round(prediction.predicted_fidelity * 100)}%
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  Predicted Fidelity
                </div>
              </div>

              <div style={{ textAlign: "center", color: "var(--text)", fontSize: 13 }}>
                &plusmn;{(prediction.uncertainty * 100).toFixed(1)}% uncertainty
              </div>

              <div style={{ background: "var(--surface)", borderRadius: 8, padding: 8, fontSize: 12, color: "var(--text)", textAlign: "center", border: "1px solid var(--line)" }}>
                CI [{(prediction.confidence_interval[0] * 100).toFixed(1)}%,{" "}
                {(prediction.confidence_interval[1] * 100).toFixed(1)}%]
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Dominant noise</span>
                  <span style={{ color: "#f59e0b", fontWeight: 500 }}>
                    {prediction.dominant_noise}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--muted)" }}>Mitigation</span>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontWeight: 600,
                      ...(
                        prediction.mitigation_recommended === "recommended" ||
                        prediction.mitigation_recommended === "strongly_recommended"
                          ? { background: "rgba(249,115,22,0.2)", color: "#f97316" }
                          : { background: "var(--line)", color: "var(--text)" }
                      ),
                    }}
                  >
                    {prediction.mitigation_recommended}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Improvement potential</span>
                  <span style={{ color: "var(--ok)", fontWeight: 500 }}>
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
