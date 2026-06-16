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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Collaboration Rooms</h1>
          <p className="text-gray-400 text-sm">Real-time shared workspaces for quantum experiments. Share parameters, discuss results, annotate circuits together.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Username:</span>
            <input value={username} onChange={e => setUsername(e.target.value)}
              className="bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 w-36" />
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium">
            + Create Room
          </button>
        </div>
      </div>

      {error && <div className="text-red-400 bg-red-900/20 rounded p-3">{error}</div>}

      {showCreate && (
        <div className="bg-gray-900 rounded-lg p-4 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm text-gray-400">Room Name</label>
            <input value={roomName} onChange={e => setRoomName(e.target.value)}
              className="w-full mt-1 bg-gray-800 text-white px-3 py-2 rounded border border-gray-700" />
          </div>
          <button onClick={create} disabled={loading} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50">Create</button>
          <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-700 rounded text-sm">Cancel</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase">Rooms</h2>
          {rooms.map(r => (
            <div key={r.room_id} onClick={() => join(r)}
              className={`bg-gray-900 rounded-lg p-3 cursor-pointer border transition-colors ${active?.room_id === r.room_id ? "border-indigo-500" : "border-transparent hover:border-gray-600"}`}>
              <div className="flex justify-between items-start">
                <div className="font-medium text-sm">{r.name}</div>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${r.status === "active" ? "bg-green-400" : "bg-gray-600"}`} />
              </div>
              <div className="text-xs text-gray-500 mt-1">{r.experiment_name}</div>
            </div>
          ))}
        </div>

        {active && (
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-gray-900 rounded-lg p-3 flex items-center justify-between">
              <div>
                <h2 className="font-bold">{active.name}</h2>
                <div className="text-xs text-gray-500">{active.experiment_name} · room {active.room_id.slice(0, 8)}</div>
              </div>
              {participants && participants.length > 0 && (
                <div className="flex gap-1">
                  {participants.slice(0, 5).map((p, i) => (
                    <div key={i} className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-medium"
                      title={p.username}>{p.username.slice(0, 2).toUpperCase()}</div>
                  ))}
                </div>
              )}
            </div>

            {active.current_params && Object.keys(active.current_params).length > 0 && (
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2">Shared Parameters</div>
                <div className="flex gap-3 flex-wrap">
                  {Object.entries(active.current_params).map(([k, v]) => (
                    <div key={k} className="bg-gray-800 rounded px-2 py-1 text-xs font-mono">
                      <span className="text-gray-400">{k}: </span><span className="text-indigo-300">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {annotations && annotations.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 space-y-1">
                <div className="text-xs text-yellow-400 mb-2">📌 Annotations</div>
                {annotations.map((a, i) => (
                  <div key={i} className="text-xs text-yellow-200">
                    <span className="text-yellow-500">{a.username}: </span>{a.text}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-gray-900 rounded-lg flex flex-col h-72">
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chatMessages && chatMessages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.username === username ? "justify-end" : "justify-start"}`}>
                    {m.username !== username && (
                      <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">{m.username.slice(0, 2).toUpperCase()}</div>
                    )}
                    <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${m.username === username ? "bg-indigo-600" : "bg-gray-700"}`}>
                      {m.username !== username && <div className="text-xs text-gray-400 mb-0.5">{m.username}</div>}
                      {m.message}
                      <div className="text-xs opacity-50 mt-0.5">{new Date(m.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-gray-700 p-3 space-y-2">
                <div className="flex gap-2">
                  <input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
                    placeholder="Type a message..."
                    className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700" />
                  <button onClick={send} disabled={!message.trim() || loading}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">Send</button>
                </div>
                <div className="flex gap-2">
                  <input value={annotation} onChange={e => setAnnotation(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
                    placeholder="Add annotation..."
                    className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded border border-yellow-700/50" />
                  <button onClick={addNote} disabled={!annotation.trim() || loading}
                    className="px-3 py-2 bg-yellow-800 hover:bg-yellow-700 rounded text-sm disabled:opacity-50">📌 Pin</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
