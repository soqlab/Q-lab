"use client";

import { useState, useEffect } from "react";
import {
  Notebook,
  NotebookCell,
  NotebookSummary,
  createNotebook,
  listNotebooks,
  getNotebook,
  addNotebookCell,
  updateNotebookCell,
  runNotebookCell,
  exportNotebook,
  deleteNotebook,
} from "../../../lib/api";
import { BookOpen, Plus, Play, Trash2, Download, FileCode, FileText } from "lucide-react";

function CellCard({
  cell,
  notebookId,
  onRefresh,
}: {
  cell: NotebookCell;
  notebookId: string;
  onRefresh: () => Promise<void>;
}) {
  const [content, setContent] = useState(cell.content);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const typeColor = cell.cell_type === "python" ? "#3b82f6" : cell.cell_type === "qasm" ? "#8b5cf6" : "#10b981";

  const handleSave = async () => {
    setSaving(true);
    setCellError(null);
    try {
      await updateNotebookCell(notebookId, cell.cell_id, content);
      await onRefresh();
    } catch (e: unknown) {
      setCellError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setCellError(null);
    try {
      await updateNotebookCell(notebookId, cell.cell_id, content);
      await runNotebookCell(notebookId, cell.cell_id);
      await onRefresh();
    } catch (e: unknown) {
      setCellError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const renderOutput = () => {
    if (!cell.output) return null;
    const output = cell.output as Record<string, unknown>;
    const outputType = output.type as string | undefined;

    if (outputType === "python_output") {
      return (
        <pre style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.6rem", color: "#10b981", fontSize: "0.8rem", margin: 0, overflowX: "auto" }}>
          {String(output.stdout ?? "")}
        </pre>
      );
    }
    if (outputType === "markdown") {
      return (
        <div style={{ color: "#94a3b8", fontSize: "0.85rem", padding: "0.4rem 0" }}>
          Rendered Markdown
        </div>
      );
    }
    if (outputType === "qasm_simulation") {
      const counts = output.counts as Record<string, number> | undefined;
      if (counts) {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const entries = Object.entries(counts).slice(0, 10);
        const maxVal = Math.max(...entries.map(([, v]) => v));
        return (
          <div>
            {entries.map(([bitstring, count]) => (
              <div key={bitstring} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ color: "#94a3b8", fontSize: "0.78rem", fontFamily: "monospace", minWidth: 60 }}>{bitstring}</span>
                <div style={{ flex: 1, background: "#0f172a", borderRadius: 3, height: 14 }}>
                  <div style={{ background: "#3b82f6", borderRadius: 3, height: 14, width: `${(count / maxVal) * 100}%` }} />
                </div>
                <span style={{ color: "#64748b", fontSize: "0.75rem", minWidth: 40, textAlign: "right" }}>{((count / total) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        );
      }
    }
    return (
      <pre style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "0.6rem", color: "#94a3b8", fontSize: "0.78rem", margin: 0, overflowX: "auto" }}>
        {JSON.stringify(cell.output, null, 2)}
      </pre>
    );
  };

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, marginBottom: "0.75rem", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.75rem", borderBottom: "1px solid #334155", background: "#0f172a" }}>
        <span style={{
          background: typeColor + "22",
          color: typeColor,
          border: `1px solid ${typeColor}`,
          borderRadius: 12,
          padding: "0.1rem 0.55rem",
          fontSize: "0.75rem",
          fontWeight: 700,
        }}>
          {cell.cell_type}
        </span>
        {cell.execution_count > 0 && (
          <span style={{ color: "#64748b", fontSize: "0.75rem" }}>In [{cell.execution_count}]</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ background: "#334155", border: "none", borderRadius: 6, color: "#94a3b8", cursor: "pointer", padding: "0.25rem 0.6rem", fontSize: "0.78rem", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleRun}
          disabled={running}
          style={{
            background: "#10b981",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            padding: "0.25rem 0.6rem",
            fontSize: "0.78rem",
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
            opacity: running ? 0.6 : 1,
          }}
        >
          <Play size={11} />
          {running ? "Running..." : "Run"}
        </button>
      </div>

      <div style={{ padding: "0.5rem" }}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            fontSize: "0.85rem",
            fontFamily: "monospace",
            padding: "0.5rem",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      {cellError && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", margin: "0 0.5rem", borderRadius: 6, padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>
          {cellError}
        </div>
      )}

      {cell.output && (
        <div style={{ padding: "0.5rem 0.75rem", borderTop: "1px solid #334155" }}>
          <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.4rem" }}>Output:</div>
          {renderOutput()}
        </div>
      )}
    </div>
  );
}

export default function NotebookPage() {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [activeNotebook, setActiveNotebook] = useState<Notebook | null>(null);
  const [view, setView] = useState<"list" | "editor">("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const loadNotebooks = async () => {
    try {
      const data = await listNotebooks();
      setNotebooks(data.notebooks);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    loadNotebooks();
  }, []);

  const refresh = async () => {
    if (!activeNotebook) return;
    const nb = await getNotebook(activeNotebook.notebook_id);
    setActiveNotebook(nb);
  };

  const handleOpenNotebook = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const nb = await getNotebook(id);
      setActiveNotebook(nb);
      setView("editor");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNotebook = async (id: string) => {
    setError(null);
    try {
      await deleteNotebook(id);
      await loadNotebooks();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCreateNotebook = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createNotebook({ title: newTitle, description: newDescription });
      setNewTitle("");
      setNewDescription("");
      setShowCreate(false);
      await loadNotebooks();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddCell = async (cellType: "python" | "qasm" | "markdown") => {
    if (!activeNotebook) return;
    const langMap: Record<string, string> = { python: "python", qasm: "openqasm", markdown: "markdown" };
    try {
      await addNotebookCell(activeNotebook.notebook_id, {
        cell_type: cellType,
        content: "",
        language: langMap[cellType],
      });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExport = async () => {
    if (!activeNotebook) return;
    try {
      const data = await exportNotebook(activeNotebook.notebook_id);
      const blob = new Blob([JSON.stringify(data.notebook, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.notebook.title}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", padding: "2rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {view === "list" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <BookOpen size={28} color="#8b5cf6" />
                <div>
                  <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800, color: "#e2e8f0" }}>Collaborative Notebooks</h1>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>Create and run quantum experiment notebooks</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreate(!showCreate)}
                style={{
                  background: "#8b5cf6",
                  border: "none",
                  borderRadius: 8,
                  padding: "0.6rem 1.1rem",
                  cursor: "pointer",
                  fontWeight: 700,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <Plus size={16} />
                New Notebook
              </button>
            </div>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem" }}>{error}</div>
            )}

            {showCreate && (
              <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: "0.75rem" }}>New Notebook</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <input
                    type="text"
                    placeholder="Title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem" }}
                  />
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 0.8rem", color: "#e2e8f0", fontSize: "0.9rem" }}
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={handleCreateNotebook}
                      disabled={loading || !newTitle.trim()}
                      style={{ background: "#8b5cf6", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", fontWeight: 700, color: "#fff", opacity: loading || !newTitle.trim() ? 0.6 : 1 }}
                    >
                      {loading ? "Creating..." : "Create"}
                    </button>
                    <button
                      onClick={() => { setShowCreate(false); setNewTitle(""); setNewDescription(""); }}
                      style={{ background: "transparent", border: "1px solid #334155", borderRadius: 8, padding: "0.6rem 1.2rem", cursor: "pointer", color: "#94a3b8" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {notebooks.length === 0 ? (
              <div style={{ textAlign: "center", height: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                <BookOpen size={56} color="#334155" />
                <p style={{ marginTop: "1rem" }}>No notebooks yet. Create your first one above.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {notebooks.map((nb) => (
                  <div
                    key={nb.notebook_id}
                    style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}
                  >
                    <BookOpen size={20} color="#8b5cf6" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.95rem" }}>{nb.title}</div>
                      {nb.description && <div style={{ color: "#94a3b8", fontSize: "0.82rem", marginTop: "0.15rem" }}>{nb.description}</div>}
                      <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.25rem" }}>
                        {nb.n_cells} cell{nb.n_cells !== 1 ? "s" : ""} · Updated {new Date(nb.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => handleOpenNotebook(nb.notebook_id)}
                        style={{ background: "#8b5cf622", border: "1px solid #8b5cf6", borderRadius: 8, color: "#8b5cf6", cursor: "pointer", padding: "0.4rem 0.9rem", fontSize: "0.85rem", fontWeight: 600 }}
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeleteNotebook(nb.notebook_id)}
                        style={{ background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#64748b", cursor: "pointer", padding: "0.4rem 0.5rem", display: "flex", alignItems: "center" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.25rem" }}>
              <button
                onClick={() => { setView("list"); setActiveNotebook(null); loadNotebooks(); }}
                style={{ background: "transparent", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", cursor: "pointer", padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
              >
                ← Back
              </button>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800, color: "#e2e8f0" }}>{activeNotebook?.title}</h2>
                {activeNotebook?.description && (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>{activeNotebook.description}</p>
                )}
              </div>
              <button
                onClick={handleExport}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <Download size={15} />
                Export
              </button>
            </div>

            {error && (
              <div style={{ background: "#7f1d1d22", border: "1px solid #ef4444", color: "#f87171", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem" }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
              <button
                onClick={() => handleAddCell("python")}
                style={{
                  background: "#3b82f622",
                  border: "1px solid #3b82f6",
                  borderRadius: 8,
                  color: "#3b82f6",
                  cursor: "pointer",
                  padding: "0.45rem 0.9rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <FileCode size={15} />
                + Code (Python)
              </button>
              <button
                onClick={() => handleAddCell("qasm")}
                style={{
                  background: "#8b5cf622",
                  border: "1px solid #8b5cf6",
                  borderRadius: 8,
                  color: "#8b5cf6",
                  cursor: "pointer",
                  padding: "0.45rem 0.9rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <FileCode size={15} />
                + QASM
              </button>
              <button
                onClick={() => handleAddCell("markdown")}
                style={{
                  background: "#10b98122",
                  border: "1px solid #10b981",
                  borderRadius: 8,
                  color: "#10b981",
                  cursor: "pointer",
                  padding: "0.45rem 0.9rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <FileText size={15} />
                + Markdown
              </button>
            </div>

            {activeNotebook && activeNotebook.cells.length === 0 ? (
              <div style={{ textAlign: "center", height: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                <Plus size={40} color="#334155" />
                <p style={{ marginTop: "1rem" }}>This notebook has no cells yet. Add one above.</p>
              </div>
            ) : (
              activeNotebook?.cells.map((cell: NotebookCell) => (
                <CellCard
                  key={cell.cell_id}
                  cell={cell}
                  notebookId={activeNotebook.notebook_id}
                  onRefresh={refresh}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
