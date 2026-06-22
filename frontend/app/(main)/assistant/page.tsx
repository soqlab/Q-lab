"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, Loader, AlertCircle, Plus, MessageSquare, Trash2, Copy, Check } from "lucide-react";
import Link from "next/link";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type Message = {
  role: "user" | "assistant";
  content: string;
  cited_runs?: string[];
  relevant_run_count?: number;
};

type ConversationSummary = {
  conversation_id: string;
  preview: string;
  message_count: number;
  created_at: string;
  last_active: string;
};

type SuggestedQuestions = {
  questions: string[];
  total_runs: number;
};

// -----------------------------------------------------------------------
// API helpers
// -----------------------------------------------------------------------

function apiUrl(path: string): string {
  return `/qlab-api${path}`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("qlab_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postChat(message: string, conversationId: string | null, backendFilter: string) {
  const res = await fetch(apiUrl("/api/v1/assistant/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      message,
      conversation_id: conversationId ?? undefined,
      backend_filter: backendFilter || undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).detail ?? "Chat failed");
  }
  return res.json() as Promise<{ answer: string; conversation_id: string; cited_runs: string[]; relevant_run_count: number }>;
}

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(apiUrl("/api/v1/assistant/conversations"), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchConversation(id: string): Promise<{ conversation_id: string; messages: Message[] }> {
  const res = await fetch(apiUrl(`/api/v1/assistant/conversation/${id}`), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Conversation not found");
  return res.json();
}

async function deleteConversation(id: string): Promise<void> {
  await fetch(apiUrl(`/api/v1/assistant/conversation/${id}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
}

async function fetchSuggestedQuestions(): Promise<SuggestedQuestions> {
  const res = await fetch(apiUrl("/api/v1/assistant/suggested-questions"), {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) return { questions: [], total_runs: 0 };
  return res.json();
}

// -----------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------

function RunCitation({ runId }: { runId: string }) {
  return (
    <Link
      href={`/runs/${runId}`}
      style={{
        display: "inline-block",
        background: "rgba(29,111,143,0.12)",
        color: "#1d6f8f",
        borderRadius: 4,
        padding: "1px 6px",
        fontSize: 12,
        fontFamily: "monospace",
        textDecoration: "none",
        margin: "0 2px",
        border: "1px solid rgba(29,111,143,0.25)",
      }}
    >
      {runId}...
    </Link>
  );
}

function AssistantMessage({ msg }: { msg: Message }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Render [Run abc12345] citations as clickable links
  function renderContent(text: string) {
    const parts = text.split(/(\[Run [a-f0-9]{8}\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[Run ([a-f0-9]{8})\]$/);
      if (match) {
        return <RunCitation key={i} runId={match[1]} />;
      }
      return <span key={i}>{part}</span>;
    });
  }

  return (
    <div className="panel" style={{ padding: "14px 18px", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Brain size={14} style={{ color: "#8b5cf6", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#8b5cf6" }}>Lab Assistant</span>
          {msg.relevant_run_count !== undefined && (
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              · {msg.relevant_run_count} runs analyzed
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          title="Copy response"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {copied ? <Check size={14} style={{ color: "#27ae60" }} /> : <Copy size={14} />}
        </button>
      </div>

      {msg.cited_runs && msg.cited_runs.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Cited runs:</span>
          {msg.cited_runs.map((id) => (
            <RunCitation key={id} runId={id} />
          ))}
        </div>
      )}

      <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap", color: "var(--fg, #17202a)" }}>
        {renderContent(msg.content)}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{
          maxWidth: "75%",
          background: "#1d6f8f",
          color: "#fff",
          borderRadius: "14px 14px 4px 14px",
          padding: "10px 16px",
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [suggested, setSuggested] = useState<SuggestedQuestions | null>(null);
  const [backendFilter, setBackendFilter] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);
  const [loadingConvId, setLoadingConvId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation list + suggested questions on mount
  useEffect(() => {
    fetchConversations().then(setConversations).catch(() => {});
    fetchSuggestedQuestions()
      .then(setSuggested)
      .catch(() => setSuggested({ questions: [], total_runs: 0 }));
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversation = useCallback(async (id: string) => {
    if (loadingConvId === id) return;
    setLoadingConvId(id);
    try {
      const conv = await fetchConversation(id);
      setConversationId(conv.conversation_id);
      // The stored messages are plain user/assistant exchanges without run metadata
      setMessages(conv.messages.map((m) => ({ role: m.role, content: m.content })));
    } catch {
      // ignore
    } finally {
      setLoadingConvId(null);
    }
  }, [loadingConvId]);

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setApiError(null);
    fetchConversations().then(setConversations).catch(() => {});
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteConversation(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.conversation_id !== id));
    if (conversationId === id) {
      startNewChat();
    }
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setApiError(null);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await postChat(q, conversationId, backendFilter);
      setConversationId(res.conversation_id);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          cited_runs: res.cited_runs,
          relevant_run_count: res.relevant_run_count,
        },
      ]);
      // Refresh conversation list
      fetchConversations().then(setConversations).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("ANTHROPIC_API_KEY")) {
        setApiError(msg);
        // Remove the user message we added optimistically
        setMessages((prev) => prev.slice(0, -1));
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${msg}` },
        ]);
      }
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const isEmpty = messages.length === 0;
  const shownSuggestions = suggested?.questions.slice(0, 4) ?? [];

  return (
    <div style={{ display: "flex", height: "calc(100vh - 60px)", overflow: "hidden" }}>
      {/* ---- Left Sidebar ---- */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          background: "#0f1923",
          borderRight: "1px solid #1e2d3d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Sidebar header */}
        <div style={{ padding: "16px 12px", borderBottom: "1px solid #1e2d3d" }}>
          <button
            className="button"
            onClick={startNewChat}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "#1d6f8f",
              borderColor: "#1d6f8f",
              fontSize: 13,
              height: 36,
            }}
          >
            <Plus size={15} /> New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
          {conversations.length === 0 ? (
            <div style={{ padding: "16px 8px", fontSize: 12, color: "#4a6278", textAlign: "center" }}>
              No conversations yet
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.conversation_id}
                onClick={() => loadConversation(conv.conversation_id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: conversationId === conv.conversation_id ? "#1e2d3d" : "transparent",
                  marginBottom: 2,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (conversationId !== conv.conversation_id) {
                    (e.currentTarget as HTMLDivElement).style.background = "#161f2a";
                  }
                }}
                onMouseLeave={(e) => {
                  if (conversationId !== conv.conversation_id) {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }
                }}
              >
                <MessageSquare size={13} style={{ color: "#4a6278", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: conversationId === conv.conversation_id ? "#e2e8f0" : "#8fa3b8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {conv.preview || "New conversation"}
                  </div>
                  <div style={{ fontSize: 10, color: "#4a6278", marginTop: 2 }}>
                    {conv.message_count} msgs ·{" "}
                    {new Date(conv.last_active).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteConversation(conv.conversation_id, e)}
                  title="Delete conversation"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 3,
                    color: "#4a6278",
                    display: "flex",
                    alignItems: "center",
                    flexShrink: 0,
                    opacity: 0.6,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ---- Main Chat Area ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg, #f7f8fa)" }}>
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
            background: "var(--panel, #fff)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <Brain size={20} style={{ color: "#8b5cf6" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg, #17202a)", lineHeight: 1.2 }}>
              Q-Lab Lab Assistant
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.2 }}>
              {suggested?.total_runs !== undefined
                ? `${suggested.total_runs} experiments in database`
                : "Loading..."}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {/* Backend filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>Backend filter</label>
              <input
                className="input"
                value={backendFilter}
                onChange={(e) => setBackendFilter(e.target.value)}
                placeholder="e.g. ibm_kyoto"
                style={{ width: 130, height: 28, fontSize: 12 }}
              />
            </div>
            {/* Powered by Claude badge */}
            <span
              style={{
                fontSize: 11,
                color: "#8b5cf6",
                background: "rgba(139,92,246,0.08)",
                border: "1px solid rgba(139,92,246,0.2)",
                borderRadius: 20,
                padding: "3px 10px",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Powered by Claude
            </span>
          </div>
        </div>

        {/* API key missing banner */}
        {apiError && (
          <div
            style={{
              padding: "10px 20px",
              background: "#fff8ed",
              borderBottom: "1px solid #f5c06a",
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            <AlertCircle size={16} style={{ color: "#e67e22", flexShrink: 0 }} />
            <span>
              Set <code>ANTHROPIC_API_KEY</code> in the backend environment to enable the Lab Assistant.
            </span>
          </div>
        )}

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isEmpty ? (
            /* Empty state — suggested questions */
            <div style={{ maxWidth: 640, margin: "0 auto", paddingTop: 40 }}>
              <div style={{ textAlign: "center", marginBottom: 32 }}>
                <Brain size={48} style={{ color: "#8b5cf6", margin: "0 auto 12px", display: "block" }} />
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                  Ask about your experiments
                </div>
                <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
                  I have access to your full experiment history. Ask me anything about results,
                  patterns, comparisons, or next steps.
                </div>
              </div>

              {shownSuggestions.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Suggested questions
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {shownSuggestions.map((q) => (
                      <button
                        key={q}
                        className="button secondary"
                        onClick={() => setInput(q)}
                        style={{
                          textAlign: "left",
                          height: "auto",
                          padding: "10px 14px",
                          fontSize: 13,
                          lineHeight: 1.45,
                          whiteSpace: "normal",
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Message list */
            <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <UserMessage key={i} msg={msg} />
                ) : (
                  <AssistantMessage key={i} msg={msg} />
                )
              )}
              {loading && (
                <div className="panel" style={{ padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
                    <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                    Analyzing experiments...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          className="panel"
          style={{
            borderRadius: 0,
            borderTop: "1px solid var(--border)",
            borderBottom: "none",
            borderLeft: "none",
            borderRight: "none",
            padding: "12px 20px",
            flexShrink: 0,
          }}
        >
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <textarea
                ref={textareaRef}
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your experiments… (Enter to send, Shift+Enter for newline)"
                disabled={loading}
                rows={2}
                style={{
                  flex: 1,
                  resize: "none",
                  minHeight: 60,
                  lineHeight: 1.5,
                  fontSize: 14,
                }}
              />
              <button
                className="button"
                onClick={() => void handleSend()}
                disabled={!input.trim() || loading}
                style={{ width: 44, flexShrink: 0, alignSelf: "flex-end" }}
              >
                {loading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Searching all experiments
              {backendFilter ? ` · backend: ${backendFilter}` : ""}
              {conversationId ? ` · conversation active` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
