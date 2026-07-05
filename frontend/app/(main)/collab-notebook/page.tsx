"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  createCollabNotebook,
  listCollabNotebooks,
  getCollabNotebook,
  addCollabCell,
  updateCollabCell,
  executeCollabNotebook,
  CollabNotebook,
  CollabCell,
  CollabExecutionResult,
} from "../../../lib/api";

const KERNELS = ["python", "julia", "q_sharp"];
const CELL_TYPES = ["code", "markdown"];

const cellTypeBadge: Record<string, string> = {
  code: "bg-indigo-900/40 text-indigo-400 border border-indigo-800",
  markdown: "bg-gray-700/60 text-gray-400 border border-gray-600",
  output: "bg-green-900/40 text-green-400 border border-green-800",
};

const kernelBadge: Record<string, string> = {
  python: "bg-yellow-900/40 text-yellow-400 border border-yellow-800",
  julia: "bg-purple-900/40 text-purple-400 border border-purple-800",
  q_sharp: "bg-blue-900/40 text-blue-400 border border-blue-800",
};

const statusDot: Record<string, string> = {
  idle: "bg-green-400",
  running: "bg-blue-400 animate-pulse",
  error: "bg-red-400",
};

export default function CollabNotebookPage() {
  const [ownerFilter, setOwnerFilter] = useState("");
  const [notebooks, setNotebooks] = useState<CollabNotebook[]>([]);
  const [loadingNotebooks, setLoadingNotebooks] = useState(true);
  const [notebooksError, setNotebooksError] = useState<string | null>(null);

  const [selectedNotebook, setSelectedNotebook] = useState<CollabNotebook | null>(null);
  const [loadingNotebook, setLoadingNotebook] = useState(false);

  // WebSocket real-time collaboration
  const wsRef = useRef<WebSocket | null>(null);
  const [peers, setPeers] = useState(0);

  // Execution results by cell id
  const [cellResults, setCellResults] = useState<Record<string, CollabExecutionResult>>({});
  const [runningCell, setRunningCell] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runAllResults, setRunAllResults] = useState<CollabExecutionResult[]>([]);

  // Editing cells
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingCell, setSavingCell] = useState(false);

  // Add cell panel
  const [showAddCell, setShowAddCell] = useState(false);
  const [newCellType, setNewCellType] = useState("code");
  const [newCellContent, setNewCellContent] = useState("");
  const [addingCell, setAddingCell] = useState(false);
  const [addCellError, setAddCellError] = useState<string | null>(null);

  // New notebook form
  const [showNewNb, setShowNewNb] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newCollabs, setNewCollabs] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newKernel, setNewKernel] = useState("python");
  const [creatingNb, setCreatingNb] = useState(false);
  const [createNbError, setCreateNbError] = useState<string | null>(null);

  // Stable sender id for this session
  const senderIdRef = useRef(Math.random().toString(36).slice(2));

  // ---------------------------------------------------------------------------
  // WebSocket helpers
  // ---------------------------------------------------------------------------

  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setPeers(0);
  }, []);

  const openWs = useCallback((notebookId: string) => {
    closeWs();
    // Derive WS URL from the current page origin so it works in production
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host  = window.location.host;
    const ws = new WebSocket(
      `${proto}://${host}/qlab-ws/api/v1/collab-notebook/notebook/${notebookId}/ws`
    );
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (msg.type === "init") {
        // Server sends full notebook on connect — use it directly
        setSelectedNotebook(msg.notebook as CollabNotebook);
        setPeers(msg.peers as number);
      } else if (msg.type === "cell_update") {
        // A peer edited a cell — update that cell's content in local state
        setSelectedNotebook((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            cells: prev.cells.map((c) =>
              c.cell_id === (msg.cell_id as string)
                ? { ...c, content: msg.source as string }
                : c
            ),
          };
        });
      } else if (msg.type === "peer_left" || msg.type === "peer_joined") {
        setPeers(msg.peers as number);
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setPeers(0);
      }
    };
  }, [closeWs]);

  // Clean up WS on unmount
  useEffect(() => {
    return () => closeWs();
  }, [closeWs]);

  // Send a cell_update over WS when content changes locally (after save)
  const sendCellUpdate = useCallback((cellId: string, source: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "cell_update",
          cell_id: cellId,
          source,
          sender_id: senderIdRef.current,
        })
      );
    }
  }, []);

  // Send a cell_execute notification over WS
  const sendCellExecute = useCallback((cellId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cell_execute", cell_id: cellId }));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // REST data loading
  // ---------------------------------------------------------------------------

  const loadNotebooks = useCallback(async (owner?: string) => {
    setLoadingNotebooks(true);
    setNotebooksError(null);
    try {
      const data = await listCollabNotebooks(owner || undefined);
      setNotebooks(data);
    } catch {
      setNotebooksError("Failed to load notebooks.");
    } finally {
      setLoadingNotebooks(false);
    }
  }, []);

  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  const handleLoadOwner = () => loadNotebooks(ownerFilter);

  const handleOpenNotebook = async (id: string) => {
    // Close previous WS before opening a new notebook
    closeWs();
    setLoadingNotebook(true);
    setSelectedNotebook(null);
    setCellResults({});
    setRunAllResults([]);
    setEditingCell(null);
    setShowAddCell(false);
    setPeers(0);
    try {
      const nb = await getCollabNotebook(id);
      setSelectedNotebook(nb);
      // Open WS after confirming notebook exists
      openWs(id);
    } catch {
      setSelectedNotebook(null);
    } finally {
      setLoadingNotebook(false);
    }
  };

  const handleRunAll = async () => {
    if (!selectedNotebook) return;
    setRunningAll(true);
    setRunAllResults([]);
    try {
      const results = await executeCollabNotebook(selectedNotebook.notebook_id);
      setRunAllResults(results);
      // Map by cell id
      const map: Record<string, CollabExecutionResult> = {};
      results.forEach((r) => { if (r.cell_id) map[r.cell_id] = r; });
      setCellResults((prev) => ({ ...prev, ...map }));
      // Refresh notebook to get updated cells
      const nb = await getCollabNotebook(selectedNotebook.notebook_id);
      setSelectedNotebook(nb);
    } catch {
      // silently fail — individual results may still populate
    } finally {
      setRunningAll(false);
    }
  };

  const handleRunCell = async (cellId: string) => {
    if (!selectedNotebook) return;
    setRunningCell(cellId);
    sendCellExecute(cellId);
    try {
      const results = await executeCollabNotebook(selectedNotebook.notebook_id, cellId);
      const result = results.find((r) => r.cell_id === cellId) ?? results[0];
      if (result) {
        setCellResults((prev) => ({ ...prev, [cellId]: result }));
      }
      const nb = await getCollabNotebook(selectedNotebook.notebook_id);
      setSelectedNotebook(nb);
    } catch {
      // leave previous result
    } finally {
      setRunningCell(null);
    }
  };

  const handleEditCell = (cell: CollabCell) => {
    setEditingCell(cell.cell_id);
    setEditContent(cell.content);
  };

  const handleSaveCell = async (cellId: string) => {
    if (!selectedNotebook) return;
    setSavingCell(true);
    try {
      const nb = await updateCollabCell(selectedNotebook.notebook_id, cellId, editContent);
      setSelectedNotebook(nb);
      setEditingCell(null);
      // Broadcast the update to peers over WS
      sendCellUpdate(cellId, editContent);
    } catch {
      // keep edit mode
    } finally {
      setSavingCell(false);
    }
  };

  const handleAddCell = async () => {
    if (!selectedNotebook) return;
    setAddingCell(true);
    setAddCellError(null);
    try {
      const nb = await addCollabCell(selectedNotebook.notebook_id, { type: newCellType, content: newCellContent });
      setSelectedNotebook(nb);
      setShowAddCell(false);
      setNewCellContent("");
      setNewCellType("code");
    } catch (e: unknown) {
      setAddCellError(e instanceof Error ? e.message : "Failed to add cell.");
    } finally {
      setAddingCell(false);
    }
  };

  const handleCreateNotebook = async () => {
    setCreatingNb(true);
    setCreateNbError(null);
    try {
      await createCollabNotebook({
        title: newTitle,
        owner: newOwner,
        collaborators: newCollabs ? newCollabs.split(",").map((s) => s.trim()) : [],
        tags: newTags ? newTags.split(",").map((s) => s.trim()) : [],
        kernel: newKernel,
      });
      setShowNewNb(false);
      setNewTitle(""); setNewOwner(""); setNewCollabs(""); setNewTags("");
      loadNotebooks();
    } catch (e: unknown) {
      setCreateNbError(e instanceof Error ? e.message : "Failed to create notebook.");
    } finally {
      setCreatingNb(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 500 }}>
      {/* Left Sidebar */}
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--surface)", maxHeight: "calc(100vh - 130px)", position: "sticky", top: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <h1 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 2px" }}>Collaborative Notebooks</h1>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Shared quantum computing notebooks</p>
        </div>

        {/* Owner filter */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", display: "flex", gap: 6 }}>
          <input
            type="text"
            placeholder="Filter by owner…"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoadOwner()}
            className="input"
            style={{ flex: 1, height: 30, fontSize: 12 }}
          />
          <button onClick={handleLoadOwner} className="button secondary" style={{ height: 30, fontSize: 12, flexShrink: 0 }}>Load</button>
        </div>

        {/* Notebooks list */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {loadingNotebooks ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: 8 }}>Loading…</div>
          ) : notebooksError ? (
            <div style={{ fontSize: 12, color: "var(--danger)", padding: 8 }}>{notebooksError}</div>
          ) : notebooks.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: 8 }}>No notebooks found.</div>
          ) : (
            notebooks.map((nb) => {
              const isActive = selectedNotebook?.notebook_id === nb.notebook_id;
              return (
                <div
                  key={nb.notebook_id}
                  onClick={() => handleOpenNotebook(nb.notebook_id)}
                  style={{
                    padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                    background: isActive ? "var(--info-bg)" : "transparent",
                    border: `1px solid ${isActive ? "var(--strong)" : "transparent"}`,
                    display: "flex", flexDirection: "column", gap: 6,
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: nb.status === "running" ? "#3b82f6" : nb.status === "error" ? "var(--danger)" : "var(--ok)" }} />
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nb.title}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "var(--info-bg)", color: "var(--info-text)" }}>{nb.kernel}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{nb.collaborators.length} collabs</span>
                  </div>
                  {nb.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {nb.tags.slice(0, 3).map((t) => (
                        <span key={t} style={{ fontSize: 10, padding: "1px 5px", background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 4 }}>{t}</span>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>{new Date(nb.created_at).toLocaleDateString()}</p>
                </div>
              );
            })
          )}
        </div>

        {/* New Notebook */}
        <div style={{ padding: "12px", borderTop: "1px solid var(--line)", flexShrink: 0 }}>
          <button
            onClick={() => setShowNewNb((v) => !v)}
            className={showNewNb ? "button secondary" : "button"}
            style={{ width: "100%", fontSize: 12 }}
          >
            {showNewNb ? "Cancel" : "New Notebook"}
          </button>
          {showNewNb && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Title", value: newTitle, set: setNewTitle },
                { label: "Owner", value: newOwner, set: setNewOwner },
                { label: "Collaborators", value: newCollabs, set: setNewCollabs, placeholder: "a, b, c" },
                { label: "Tags", value: newTags, set: setNewTags, placeholder: "q, ml" },
              ].map(({ label, value, set, placeholder }) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</label>
                  <input type="text" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                    className="input" style={{ width: "100%", height: 28, fontSize: 12 }} />
                </div>
              ))}
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Kernel</label>
                <select value={newKernel} onChange={(e) => setNewKernel(e.target.value)} className="input" style={{ width: "100%", height: 28, fontSize: 12 }}>
                  {KERNELS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              {createNbError && <p style={{ color: "var(--danger)", fontSize: 11, margin: 0 }}>{createNbError}</p>}
              <button onClick={() => void handleCreateNotebook()} disabled={creatingNb || !newTitle || !newOwner}
                className="button" style={{ width: "100%", fontSize: 12 }}>
                {creatingNb ? "Creating…" : "Create"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Area */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loadingNotebook ? (
          <div style={{ padding: 32, fontSize: 14, color: "var(--muted)" }}>Loading notebook…</div>
        ) : !selectedNotebook ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>Select a notebook to open it</p>
          </div>
        ) : (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Notebook Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold">{selectedNotebook.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${kernelBadge[selectedNotebook.kernel] ?? "bg-gray-700 text-gray-400"}`}>{selectedNotebook.kernel}</span>
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${statusDot[selectedNotebook.status] ?? "bg-gray-400"}`} />
                    <span className="text-xs text-gray-400">{selectedNotebook.status}</span>
                  </span>
                  {/* Live presence indicator */}
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${peers > 1 ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
                    <span className={`text-xs font-medium ${peers > 1 ? "text-green-400" : "text-gray-500"}`}>
                      {peers > 1 ? `${peers} online` : "1 online"}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">Owner: <span className="text-gray-200">{selectedNotebook.owner}</span></span>
                  {selectedNotebook.collaborators.length > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Collabs:</span>
                      {selectedNotebook.collaborators.map((c) => (
                        <span key={c} className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-300 border border-gray-700 rounded-full">{c}</span>
                      ))}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowAddCell((v) => !v)}
                  className="bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg px-3 py-1.5 text-sm transition-colors"
                >
                  Add Cell
                </button>
                <button
                  onClick={handleRunAll}
                  disabled={runningAll}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  {runningAll ? "Running…" : "Run All"}
                </button>
              </div>
            </div>

            {/* Add Cell Panel */}
            {showAddCell && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-medium text-indigo-400">New Cell</h3>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Type</label>
                  <select value={newCellType} onChange={(e) => setNewCellType(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500">
                    {CELL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Content</label>
                  <textarea
                    value={newCellContent}
                    onChange={(e) => setNewCellContent(e.target.value)}
                    rows={5}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {addCellError && <div className="text-red-400 text-sm">{addCellError}</div>}
                <div className="flex gap-2">
                  <button onClick={handleAddCell} disabled={addingCell || !newCellContent} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 text-sm font-medium transition-colors">
                    {addingCell ? "Adding…" : "Add"}
                  </button>
                  <button onClick={() => setShowAddCell(false)} className="bg-gray-700 hover:bg-gray-600 rounded-lg px-3 py-1.5 text-sm transition-colors">Cancel</button>
                </div>
              </div>
            )}

            {/* Run All Results */}
            {runAllResults.length > 0 && (
              <div className="bg-gray-900 border border-green-900 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-green-400">Run All Results</p>
                {runAllResults.map((r, i) => (
                  <div key={i} className="space-y-1">
                    {r.output.length > 0 && (
                      <pre className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
                        {r.output.join("\n")}
                      </pre>
                    )}
                    <p className="text-xs text-gray-500">{r.execution_time_ms}ms · {r.success ? "success" : "error"}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Cells */}
            <div className="space-y-3">
              {selectedNotebook.cells.length === 0 ? (
                <div className="text-sm text-gray-500">No cells yet. Add one above.</div>
              ) : (
                selectedNotebook.cells.map((cell, idx) => {
                  const result = cellResults[cell.cell_id];
                  const isEditing = editingCell === cell.cell_id;
                  const isRunning = runningCell === cell.cell_id;

                  return (
                    <div key={cell.cell_id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                      {/* Cell header */}
                      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-800">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 font-mono w-5">[{cell.execution_count ?? idx + 1}]</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${cellTypeBadge[cell.type] ?? "bg-gray-700 text-gray-400"}`}>{cell.type}</span>
                          {cell.executed_at && (
                            <span className="text-xs text-gray-500">{new Date(cell.executed_at).toLocaleTimeString()}</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {cell.type === "code" && (
                            <button
                              onClick={() => handleRunCell(cell.cell_id)}
                              disabled={isRunning}
                              className="text-xs bg-indigo-900/40 hover:bg-indigo-900/60 text-indigo-400 border border-indigo-800 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                            >
                              {isRunning ? "Running…" : "Run"}
                            </button>
                          )}
                          <button
                            onClick={() => isEditing ? setEditingCell(null) : handleEditCell(cell)}
                            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded px-2 py-0.5 transition-colors"
                          >
                            {isEditing ? "Cancel" : "Edit"}
                          </button>
                          {isEditing && (
                            <button
                              onClick={() => handleSaveCell(cell.cell_id)}
                              disabled={savingCell}
                              className="text-xs bg-green-900/40 hover:bg-green-900/60 text-green-400 border border-green-800 rounded px-2 py-0.5 transition-colors disabled:opacity-50"
                            >
                              {savingCell ? "Saving…" : "Save"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Cell content */}
                      <div className="px-4 py-3">
                        {isEditing ? (
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={Math.max(3, editContent.split("\n").length + 1)}
                            className="w-full bg-gray-800 border border-indigo-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-indigo-500 resize-y"
                          />
                        ) : cell.type === "code" ? (
                          <pre className="text-sm font-mono text-indigo-200 bg-gray-950 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap border border-gray-800">
                            {cell.content}
                          </pre>
                        ) : cell.type === "markdown" ? (
                          <div className="text-sm text-gray-200 prose-invert leading-relaxed whitespace-pre-wrap">
                            {cell.content}
                          </div>
                        ) : (
                          <pre className="text-sm font-mono text-green-400 bg-gray-950 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap border border-gray-800">
                            {cell.content}
                          </pre>
                        )}
                      </div>

                      {/* Cell outputs (from cell itself) */}
                      {cell.outputs && cell.outputs.length > 0 && !result && (
                        <div className="px-4 pb-3">
                          <pre className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
                            {cell.outputs.join("\n")}
                          </pre>
                        </div>
                      )}

                      {/* Fresh execution result */}
                      {result && (
                        <div className="px-4 pb-3 space-y-1">
                          {result.output.length > 0 && (
                            <pre className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
                              {result.output.join("\n")}
                            </pre>
                          )}
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{result.execution_time_ms}ms</span>
                            <span className={result.success ? "text-green-500" : "text-red-400"}>
                              {result.success ? "success" : "error"}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
