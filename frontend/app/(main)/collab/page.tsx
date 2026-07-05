"use client";
import { useState, useEffect, useRef } from "react";
import { createCollabRoom, joinCollabRoom, sendCollabChat, addCollabAnnotation, listCollabRooms, CollabRoom } from "@/lib/api";

export default function CollabPage() {
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [active, setActive] = useState<CollabRoom | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [roomName, setRoomName] = useState("VQE Collaboration");
  const [username, setUsername] = useState(`researcher_${Math.random().toString(36).slice(2, 8)}`);
  const [message, setMessage] = useState("");
  const [annotation, setAnnotation] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [active?.chat]);

  async function load() {
    try {
      const r = await listCollabRooms();
      setRooms(r.rooms as CollabRoom[]);
    } catch { /* ignore */ }
  }

  async function create() {
    setLoading(true); setError("");
    try {
      const room = await createCollabRoom({ name: roomName, owner: username });
      setActive(room);
      setShowCreate(false);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function join(room: CollabRoom) {
    setLoading(true);
    try {
      const updated = await joinCollabRoom({ room_id: room.room_id, username });
      setActive(updated);
    } catch { setActive(room); }
    finally { setLoading(false); }
  }

  async function send() {
    if (!active || !message.trim()) return;
    setLoading(true);
    try {
      const updated = await sendCollabChat({ room_id: active.room_id, username, message });
      setActive(updated);
      setMessage("");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  async function addNote() {
    if (!active || !annotation.trim()) return;
    setLoading(true);
    try {
      const updated = await addCollabAnnotation({ room_id: active.room_id, username, text: annotation });
      setActive(updated);
      setAnnotation("");
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const chatMessages = active?.chat as { username: string; message: string; timestamp: string }[] | undefined;
  const annotations = active?.annotations as { username: string; text: string; color?: string; timestamp: string }[] | undefined;
  const participants = active?.participants as { username: string; role?: string }[] | undefined;

  return (
    <div style={{ padding: 24, maxWidth: 1152, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Collaboration Rooms</h1>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Real-time shared workspaces for quantum experiments. Share parameters, discuss results, annotate circuits together.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Username:</span>
            <input value={username} onChange={e => setUsername(e.target.value)}
              style={{ background: "var(--surface)", color: "var(--text)", fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)", width: 144 }} />
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            style={{ padding: "8px 16px", background: "var(--strong)", borderRadius: 6, fontWeight: 500, cursor: "pointer" }}>
            + Create Room
          </button>
        </div>
      </div>

      {error && <div style={{ color: "var(--danger)", background: "rgba(239,68,68,0.1)", borderRadius: 6, padding: 12 }}>{error}</div>}

      {showCreate && (
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 16, display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 13, color: "var(--muted)" }}>Room Name</label>
            <input value={roomName} onChange={e => setRoomName(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--surface)", color: "var(--text)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
          </div>
          <button onClick={create} disabled={loading} style={{ padding: "8px 16px", background: "var(--ok)", borderRadius: 6, fontSize: 13, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>Create</button>
          <button onClick={() => setShowCreate(false)} style={{ padding: "8px 16px", background: "var(--line)", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", textTransform: "uppercase" }}>Rooms</h2>
          {rooms.map(r => (
            <div key={r.room_id} onClick={() => join(r)}
              style={{ background: "var(--surface)", borderRadius: 8, padding: 12, cursor: "pointer", border: active?.room_id === r.room_id ? "1px solid var(--strong)" : "1px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{r.name}</div>
                <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, marginTop: 4, background: r.status === "active" ? "var(--ok)" : "var(--line)", display: "inline-block" }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{r.experiment_name}</div>
            </div>
          ))}
        </div>

        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ fontWeight: 700 }}>{active.name}</h2>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{active.experiment_name} · room {active.room_id.slice(0, 8)}</div>
              </div>
              {participants && participants.length > 0 && (
                <div style={{ display: "flex", gap: 4 }}>
                  {(participants ?? []).slice(0, 5).map((p, i) => (
                    <div key={i} style={{ width: 28, height: 28, borderRadius: 999, background: "var(--strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}
                      title={p.username}>{p.username.slice(0, 2).toUpperCase()}</div>
                  ))}
                </div>
              )}
            </div>

            {active.current_params && Object.keys(active.current_params).length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Shared Parameters</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {Object.entries(active.current_params).map(([k, v]) => (
                    <div key={k} style={{ background: "var(--surface)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "ui-monospace,monospace", border: "1px solid var(--line)" }}>
                      <span style={{ color: "var(--muted)" }}>{k}: </span><span style={{ color: "var(--strong)" }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {annotations && annotations.length > 0 && (
              <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(161,98,7,0.5)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>📌 Annotations</div>
                {(annotations ?? []).map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#f59e0b" }}>
                    <span style={{ color: "#f59e0b" }}>{a.username}: </span>{a.text}
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "var(--surface)", borderRadius: 8, display: "flex", flexDirection: "column", height: 288 }}>
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {chatMessages && (chatMessages ?? []).map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, justifyContent: m.username === username ? "flex-end" : "flex-start" }}>
                    {m.username !== username && (
                      <div style={{ width: 24, height: 24, borderRadius: 999, background: "var(--strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, marginTop: 4 }}>{m.username.slice(0, 2).toUpperCase()}</div>
                    )}
                    <div style={{ maxWidth: 280, borderRadius: 12, padding: "8px 12px", fontSize: 13, background: m.username === username ? "var(--strong)" : "var(--line)" }}>
                      {m.username !== username && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{m.username}</div>}
                      {m.message}
                      <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{new Date(m.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div style={{ borderTop: "1px solid var(--line)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
                    placeholder="Type a message..."
                    style={{ flex: 1, background: "var(--surface)", color: "var(--text)", fontSize: 13, padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }} />
                  <button onClick={send} disabled={!message.trim() || loading}
                    style={{ padding: "8px 12px", background: "var(--strong)", borderRadius: 6, fontSize: 13, opacity: (!message.trim() || loading) ? 0.5 : 1, cursor: (!message.trim() || loading) ? "not-allowed" : "pointer" }}>Send</button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={annotation} onChange={e => setAnnotation(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
                    placeholder="Add annotation..."
                    style={{ flex: 1, background: "var(--surface)", color: "var(--text)", fontSize: 13, padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(161,98,7,0.5)" }} />
                  <button onClick={addNote} disabled={!annotation.trim() || loading}
                    style={{ padding: "8px 12px", background: "rgba(245,158,11,0.15)", borderRadius: 6, fontSize: 13, opacity: (!annotation.trim() || loading) ? 0.5 : 1, cursor: (!annotation.trim() || loading) ? "not-allowed" : "pointer" }}>📌 Pin</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
