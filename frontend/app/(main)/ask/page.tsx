"use client";

import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, Loader, AlertCircle } from "lucide-react";
import Link from "next/link";
import { createAskStream, fetchAskStatus, type AskStatus } from "../../../lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  cited_run_ids?: string[];
  run_count?: number;
  streaming?: boolean;
};

type Filters = {
  project: string;
  backend: string;
  days: number;
  max_runs: number;
};

export default function AskPage() {
  const [status, setStatus] = useState<AskStatus | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [filters, setFilters] = useState<Filters>({ project: "", backend: "", days: 30, max_runs: 50 });
  const [showFilters, setShowFilters] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAskStatus().then(setStatus);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleStop() {
    stopRef.current?.();
    stopRef.current = null;
    setStreaming(false);
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 && m.streaming ? { ...m, streaming: false } : m
    ));
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || streaming) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setStreaming(true);

    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: "assistant", content: "", streaming: true }]);

    let runIds: string[] = [];
    let runCount = 0;
    let fullText = "";

    const stop = createAskStream(
      {
        question: q,
        project: filters.project || undefined,
        backend: filters.backend || undefined,
        days: filters.days,
        max_runs: filters.max_runs,
      },
      (meta) => {
        runIds = meta.run_ids;
        runCount = meta.run_count;
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, run_count: runCount, cited_run_ids: runIds } : m
        ));
      },
      (token) => {
        fullText += token;
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, content: fullText } : m
        ));
      },
      () => {
        stopRef.current = null;
        setStreaming(false);
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, streaming: false, cited_run_ids: runIds, run_count: runCount } : m
        ));
      },
      (err) => {
        stopRef.current = null;
        setStreaming(false);
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { ...m, content: `Error: ${err}`, streaming: false } : m
        ));
      },
    );
    stopRef.current = stop;
  }

  const unavailable = status && !status.available;

  return (
    <main className="page">
      <section className="panel">
        <div className="panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare size={17} /> AI Research Assistant
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {status && (
              <span style={{ fontSize: 12, color: status.available ? "#27ae60" : "#e74c3c", fontWeight: 600 }}>
                {status.available ? `● ${status.model}` : "● AI unavailable (no API key)"}
              </span>
            )}
            <button className="button secondary" style={{ height: 30, fontSize: 12 }}
              onClick={() => setShowFilters(s => !s)}>
              Filters {filters.project || filters.backend ? "●" : ""}
            </button>
          </div>
        </div>

        {showFilters && (
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--panel-2, #f7f8fa)", display: "grid", gridTemplateColumns: "1fr 1fr 120px 120px", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Project</label>
              <input className="input" value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))} placeholder="project-slug" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Backend</label>
              <input className="input" value={filters.backend} onChange={e => setFilters(f => ({ ...f, backend: e.target.value }))} placeholder="ibm_kyoto" style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Days</label>
              <input className="input" type="number" value={filters.days} onChange={e => setFilters(f => ({ ...f, days: Number(e.target.value) }))} min={1} max={365} style={{ width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 3 }}>Max runs</label>
              <input className="input" type="number" value={filters.max_runs} onChange={e => setFilters(f => ({ ...f, max_runs: Number(e.target.value) }))} min={5} max={200} style={{ width: "100%" }} />
            </div>
          </div>
        )}
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: 400 }}>
        {messages.length === 0 ? (
          <div className="panel" style={{ padding: "40px 24px", textAlign: "center" }}>
            <MessageSquare size={40} style={{ color: "#ccd", margin: "0 auto 12px" }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ask about your experiments</div>
            <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 500, margin: "0 auto 20px", lineHeight: 1.6 }}>
              Ask questions across your full run history. Claude scans recent experiments and cites specific run IDs.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {[
                "Which backend had the highest average health score this month?",
                "What's the best TVD I've achieved and on which circuit?",
                "Compare QAOA performance across backends",
                "Which circuits have the highest non-Clifford ratio?",
              ].map(q => (
                <button key={q} className="button secondary" style={{ fontSize: 12, height: "auto", padding: "6px 12px", maxWidth: 220, textAlign: "left", whiteSpace: "normal", lineHeight: 1.4 }}
                  onClick={() => { setInput(q); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {unavailable && (
        <div className="panel" style={{ padding: "12px 18px", background: "#fff8ed", border: "1px solid #f5c06a" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <AlertCircle size={16} style={{ color: "#e67e22", flexShrink: 0 }} />
            <span>Set <code>ANTHROPIC_API_KEY</code> in the backend environment to enable AI chat.</span>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            className="input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder="Ask a question about your experiments… (Enter to send, Shift+Enter for newline)"
            disabled={streaming || !!unavailable}
            style={{ flex: 1, resize: "none", minHeight: 60, lineHeight: 1.5, fontSize: 14 }}
            rows={2}
          />
          {streaming ? (
            <button className="button secondary" onClick={handleStop} style={{ width: 44, flexShrink: 0 }}>
              ■
            </button>
          ) : (
            <button className="button" onClick={handleSend} disabled={!input.trim() || !!unavailable} style={{ width: 44, flexShrink: 0 }}>
              <Send size={16} />
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          Scanning last {filters.days} days{filters.project ? `, project: ${filters.project}` : ""}{filters.backend ? `, backend: ${filters.backend}` : ""}
        </div>
      </div>
    </main>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: "80%", background: "#1d6f8f", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "10px 16px", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: "14px 18px" }}>
      {msg.run_count !== undefined && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          Analyzed {msg.run_count} experiments
          {msg.cited_run_ids && msg.cited_run_ids.length > 0 && (
            <> · cited: {msg.cited_run_ids.slice(0, 5).map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link href={`/runs/${id}`} style={{ color: "#1d6f8f", fontFamily: "monospace" }}>
                  {id.slice(0, 8)}
                </Link>
              </span>
            ))}{msg.cited_run_ids.length > 5 && ` +${msg.cited_run_ids.length - 5} more`}
          </>
          )}
        </div>
      )}
      <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", color: "#17202a" }}>
        {msg.content || (msg.streaming ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "")}
        {msg.streaming && msg.content && <span style={{ opacity: 0.4, animation: "pulse 1s infinite" }}>▌</span>}
      </div>
    </div>
  );
}
