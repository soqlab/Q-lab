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
    <>
      <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚗️</span>
        <span><strong style={{ color: "#f59e0b" }}>Simulated Preview</strong><span style={{ color: "var(--muted)", marginLeft: 8 }}>Cell execution generates template outputs — not from a live kernel.</span></span>
      </div>
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
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Notebook Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{selectedNotebook.title}</h2>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--info-bg)", color: "var(--info-text)" }}>{selectedNotebook.kernel}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0, background: selectedNotebook.status === "running" ? "#3b82f6" : selectedNotebook.status === "error" ? "var(--danger)" : "var(--ok)" }} />
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{selectedNotebook.status}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0, background: peers > 1 ? "var(--ok)" : "var(--line)" }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: peers > 1 ? "var(--ok)" : "var(--muted)" }}>
                      {peers > 1 ? `${peers} online` : "1 online"}
                    </span>
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                  <span>Owner: <span style={{ color: "var(--text)" }}>{selectedNotebook.owner}</span></span>
                  {selectedNotebook.collaborators.length > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>Collabs:</span>
                      {selectedNotebook.collaborators.map((c) => (
                        <span key={c} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--text)" }}>{c}</span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => setShowAddCell((v) => !v)} className={showAddCell ? "button secondary" : "button"} style={{ fontSize: 13 }}>
                  Add Cell
                </button>
                <button onClick={() => void handleRunAll()} disabled={runningAll} className="button" style={{ fontSize: 13 }}>
                  {runningAll ? "Running…" : "Run All"}
                </button>
              </div>
            </div>

            {/* Add Cell Panel */}
            {showAddCell && (
              <div className="panel" style={{ margin: 0 }}>
                <div className="panel-header"><h2>New Cell</h2></div>
                <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Type</label>
                    <select value={newCellType} onChange={(e) => setNewCellType(e.target.value)} className="input">
                      {CELL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Content</label>
                    <textarea
                      value={newCellContent}
                      onChange={(e) => setNewCellContent(e.target.value)}
                      rows={5}
                      className="input"
                      style={{ width: "100%", fontFamily: "ui-monospace,monospace", resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                  {addCellError && <div style={{ color: "var(--danger)", fontSize: 13 }}>{addCellError}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void handleAddCell()} disabled={addingCell || !newCellContent} className="button" style={{ fontSize: 13 }}>
                      {addingCell ? "Adding…" : "Add"}
                    </button>
                    <button onClick={() => setShowAddCell(false)} className="button secondary" style={{ fontSize: 13 }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Run All Results */}
            {runAllResults.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--ok)", borderRadius: 10, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ok)" }}>Run All Results</p>
                {runAllResults.map((r, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.output.length > 0 && (
                      <pre style={{ margin: 0, background: "rgba(0,0,0,0.25)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--ok)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                        {r.output.join("\n")}
                      </pre>
                    )}
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>{r.execution_time_ms}ms · {r.success ? "success" : "error"}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Cells */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedNotebook.cells.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>No cells yet. Add one above.</div>
              ) : (
                selectedNotebook.cells.map((cell, idx) => {
                  const result = cellResults[cell.cell_id];
                  const isEditing = editingCell === cell.cell_id;
                  const isRunning = runningCell === cell.cell_id;

                  return (
                    <div key={cell.cell_id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                      {/* Cell header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--line)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--muted)", minWidth: 20 }}>[{cell.execution_count ?? idx + 1}]</span>
                          <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: "var(--info-bg)", color: "var(--info-text)" }}>{cell.type}</span>
                          {cell.executed_at && (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(cell.executed_at).toLocaleTimeString()}</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {cell.type === "code" && (
                            <button
                              onClick={() => void handleRunCell(cell.cell_id)}
                              disabled={isRunning}
                              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--info-bg)", color: "var(--info-text)", cursor: isRunning ? "default" : "pointer", opacity: isRunning ? 0.5 : 1 }}
                            >
                              {isRunning ? "Running…" : "Run"}
                            </button>
                          )}
                          <button
                            onClick={() => isEditing ? setEditingCell(null) : handleEditCell(cell)}
                            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}
                          >
                            {isEditing ? "Cancel" : "Edit"}
                          </button>
                          {isEditing && (
                            <button
                              onClick={() => void handleSaveCell(cell.cell_id)}
                              disabled={savingCell}
                              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid var(--ok)", background: "rgba(16,185,129,0.1)", color: "var(--ok)", cursor: savingCell ? "default" : "pointer", opacity: savingCell ? 0.5 : 1 }}
                            >
                              {savingCell ? "Saving…" : "Save"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Cell content */}
                      <div style={{ padding: "12px 16px" }}>
                        {isEditing ? (
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={Math.max(3, editContent.split("\n").length + 1)}
                            className="input"
                            style={{ width: "100%", fontFamily: "ui-monospace,monospace", resize: "vertical", boxSizing: "border-box" }}
                          />
                        ) : cell.type === "code" ? (
                          <pre style={{ margin: 0, fontSize: 13, fontFamily: "ui-monospace,monospace", color: "var(--info-text)", background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", border: "1px solid var(--line)" }}>
                            {cell.content}
                          </pre>
                        ) : cell.type === "markdown" ? (
                          <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                            {cell.content}
                          </div>
                        ) : (
                          <pre style={{ margin: 0, fontSize: 13, fontFamily: "ui-monospace,monospace", color: "var(--ok)", background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 14px", overflowX: "auto", whiteSpace: "pre-wrap", border: "1px solid var(--line)" }}>
                            {cell.content}
                          </pre>
                        )}
                      </div>

                      {/* Cell outputs */}
                      {cell.outputs && cell.outputs.length > 0 && !result && (
                        <div style={{ padding: "0 16px 12px" }}>
                          <pre style={{ margin: 0, background: "rgba(0,0,0,0.25)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--ok)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                            {cell.outputs.join("\n")}
                          </pre>
                        </div>
                      )}

                      {/* Fresh execution result */}
                      {result && (
                        <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                          {result.output.length > 0 && (
                            <pre style={{ margin: 0, background: "rgba(0,0,0,0.25)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--ok)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                              {result.output.join("\n")}
                            </pre>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--muted)" }}>
                            <span>{result.execution_time_ms}ms</span>
                            <span style={{ color: result.success ? "var(--ok)" : "var(--danger)" }}>
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
    </>
  );
}
