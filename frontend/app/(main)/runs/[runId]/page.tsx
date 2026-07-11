"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink, FileCode, GitCompare, Package, Activity, Search, Share2, ZoomIn, ZoomOut, Maximize2, MessageSquare, Pencil, Trash2, Send } from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  fetchRun, fetchRunHealth, generateShareLink, qlabApiPath,
  listRunNotes, createRunNote, updateRunNote, deleteRunNote,
  deleteRun, updateRunTags, getRunBadgeUrl,
  getPaperPackageUrl, getOverleafLink,
  QLabRun, RunNote, healthColor,
} from "../../../../lib/api";
import { useToast } from "../../../../lib/toast";
import { useAuth } from "../../../../lib/auth";
import MetricsPanel from "./MetricsPanel";
import MeasurementHistogram from "./MeasurementHistogram";
import TranspilerPanel from "./TranspilerPanel";
import ResourceEstimatePanel from "./ResourceEstimatePanel";
import AssertionsPanel from "./AssertionsPanel";
import ContextPanel from "./ContextPanel";
import ShadowSimPanel from "./ShadowSimPanel";
import RootCausePanel from "./RootCausePanel";
import ErrorBudgetPanel from "./ErrorBudgetPanel";
import RobustnessPanel from "./RobustnessPanel";
import TopologyPanel from "./TopologyPanel";
import QuantumVolumePanel from "./QuantumVolumePanel";
import CitationsPanel from "./CitationsPanel";
import GateFlameChart from "./GateFlameChart";
import ConvergencePanel from "./ConvergencePanel";
import MitigationPanel from "./MitigationPanel";
import AnomalyPanel from "./AnomalyPanel";
import QubitMapPanel from "./QubitMapPanel";
import LandscapePanel from "./LandscapePanel";
import InsightsPanel, { LiteratureSection } from "./InsightsPanel";
import NoiseModelPanel from "./NoiseModelPanel";
import ZXSimplifyPanel from "./ZXSimplifyPanel";
import ShadowTomoPanel from "./ShadowTomoPanel";
import MagicPanel from "./MagicPanel";
import CircuitTopologyPanel from "./CircuitTopologyPanel";
import PauliNoisePanel from "./PauliNoisePanel";
import QOETelemetryPanel from "./QOETelemetryPanel";
import UAFCPTPanel from "./UAFCPTPanel";
import AEMDPanel from "./AEMDPanel";
import AnsatzDiscoveryPanel from "./AnsatzDiscoveryPanel";
import AdvantageOraclePanel from "./AdvantageOraclePanel";
import TransferPredictionPanel from "./TransferPredictionPanel";
import EvoOptimizerPanel from "./EvoOptimizerPanel";
import BugDatabasePanel from "./BugDatabasePanel";
import ReproScorePanel from "./ReproScorePanel";
import EntanglementPanel from "./EntanglementPanel";
import TomographyPanel from "./TomographyPanel";

function CircuitDiagram({ runId }: { runId: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const src = qlabApiPath(`/api/v1/runs/${runId}/circuit.svg`);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Circuit Diagram</h2>
        <span style={{ fontSize: 12, color: "#5f6f80" }}>Scroll to zoom · drag to pan · double-click to reset</span>
        <a className="button secondary" href={src} download={`circuit-${runId}.svg`}
          style={{ fontSize: 12, height: 28, padding: "0 10px", marginLeft: "auto" }}>
          <Download size={13} aria-hidden="true" /> SVG
        </a>
      </div>

      <div style={{ background: "var(--panel-2)", borderRadius: "0 0 8px 8px", overflow: "hidden", minHeight: 120 }}>
        {state === "loading" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, fontSize: 13, color: "var(--muted)" }}>
            Rendering circuit…
          </div>
        )}
        {state === "error" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, fontSize: 13, color: "var(--danger)" }}>
            Circuit diagram unavailable — QASM may use unsupported gates.
          </div>
        )}
        {/* Always mount TransformWrapper so the img loads; hide until ready */}
        <div style={{ display: state === "ok" ? "block" : "none" }}>
          <TransformWrapper
            initialScale={1}
            minScale={0.2}
            maxScale={5}
            doubleClick={{ mode: "reset" }}
            wheel={{ step: 0.1 }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                {/* Toolbar */}
                <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
                  <button className="button secondary" style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                    onClick={() => zoomIn()} type="button">
                    <ZoomIn size={13} aria-hidden="true" /> Zoom in
                  </button>
                  <button className="button secondary" style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                    onClick={() => zoomOut()} type="button">
                    <ZoomOut size={13} aria-hidden="true" /> Zoom out
                  </button>
                  <button className="button secondary" style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                    onClick={() => resetTransform()} type="button">
                    <Maximize2 size={13} aria-hidden="true" /> Reset
                  </button>
                </div>
                {/* Canvas */}
                <TransformComponent
                  wrapperStyle={{ width: "100%", height: "420px", cursor: "grab" }}
                  contentStyle={{ padding: "24px" }}
                >
                  <img
                    src={src}
                    alt="Quantum circuit diagram"
                    style={{ display: "block", maxWidth: "none" }}
                  />
                </TransformComponent>
              </>
            )}
          </TransformWrapper>
        </div>

        {/* Hidden loader img — triggers onLoad/onError outside the transform */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          style={{ display: "none" }}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      </div>
    </section>
  );
}

function jsonBlock(value: unknown): string {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) return "—";
  return JSON.stringify(value, null, 2);
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 14 }}>
      <span style={{ color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ScoreGauge({ score }: { score: number | null | undefined }) {
  const color = healthColor(score);
  const pct = score !== null && score !== undefined ? score : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0" }}>
      <div style={{ fontSize: 48, fontWeight: 700, color }}>
        {score !== null && score !== undefined ? score : "—"}
      </div>
      <div style={{ width: "100%", height: 8, background: "var(--line)", borderRadius: 4, marginTop: 8 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width .5s" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>out of 100 (estimated)</div>
    </div>
  );
}

function ShareButton({ runId }: { runId: string }) {
  const { token } = useAuth();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (!token) return;
    setSharing(true);
    try {
      const { share_url } = await generateShareLink(token, runId);
      setShareUrl(share_url);
    } finally {
      setSharing(false);
    }
  }

  function copyLink() {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (shareUrl) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <code style={{ fontSize: 12, background: "var(--panel-2)", padding: "4px 8px", borderRadius: 6, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {shareUrl}
        </code>
        <button className="button secondary" style={{ height: 34, fontSize: 12, padding: "0 10px" }} onClick={copyLink} type="button">
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
        <a className="button secondary" href={shareUrl} target="_blank" rel="noreferrer" style={{ height: 34, fontSize: 12, padding: "0 10px", textDecoration: "none" }}>
          Open
        </a>
      </div>
    );
  }

  return (
    <button className="button secondary" onClick={() => void handleShare()} disabled={sharing || !token} style={{ height: 34 }}>
      <Share2 size={16} aria-hidden="true" /> {sharing ? "Generating…" : "Share"}
    </button>
  );
}

// -------------------------------------------------------------------
// Badge button — shows badge preview + embed markdown
// -------------------------------------------------------------------
function BadgeButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const badgeUrl = getRunBadgeUrl(runId);
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const verifyUrl = `${origin}/verify/${runId}`;
  const markdown = `[![Q-Lab](${origin}${badgeUrl})](${verifyUrl})`;

  function copyMarkdown() {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) {
    return (
      <button
        className="button secondary"
        style={{ height: 34 }}
        onClick={() => setOpen(true)}
        type="button"
        title="Embed badge for paper"
      >
        Badge
      </button>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "14px 16px",
        minWidth: 340,
        boxShadow: "0 4px 20px rgba(0,0,0,.2)",
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Badge embed</span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 18, lineHeight: 1, padding: 0 }}
          type="button"
          aria-label="Close badge panel"
        >
          ×
        </button>
      </div>

      {/* Live badge preview */}
      <div style={{ marginBottom: 12 }}>
        <img
          src={badgeUrl}
          alt="Q-Lab health badge"
          style={{ height: 20 }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      </div>

      {/* Markdown */}
      <code
        style={{
          display: "block",
          background: "var(--panel-2)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 11,
          lineHeight: 1.5,
          wordBreak: "break-all",
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        {markdown}
      </code>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="button secondary"
          style={{ height: 30, fontSize: 12, padding: "0 12px" }}
          onClick={copyMarkdown}
          type="button"
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy markdown</>}
        </button>
        <a
          href={`/verify/${runId}`}
          target="_blank"
          rel="noreferrer"
          className="button secondary"
          style={{ height: 30, fontSize: 12, padding: "0 12px", textDecoration: "none" }}
        >
          View certificate
        </a>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Tag editor
// -------------------------------------------------------------------
function TagEditor({ runId, initialTags, onSaved }: { runId: string; initialTags: string[]; onSaved: (tags: string[]) => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function addTag() {
    const t = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!t || tags.includes(t)) { setDraft(""); return; }
    setTags(prev => [...prev, t]);
    setDraft("");
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag));
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await updateRunTags(token, runId, tags);
      onSaved(tags);
      toast("Tags saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save tags", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tags.map(tag => (
          <span key={tag} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: "var(--info-bg)", color: "var(--info-text)",
            fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 999,
          }}>
            {tag}
            {token && (
              <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, fontSize: 14 }} aria-label={`Remove tag ${tag}`}>×</button>
            )}
          </span>
        ))}
        {!tags.length && <span style={{ fontSize: 13, color: "var(--muted)" }}>No tags</span>}
      </div>
      {token && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Add tag…"
            style={{ height: 32, minWidth: 0, flex: 1 }}
          />
          <button className="button secondary" style={{ height: 32, fontSize: 13, padding: "0 10px" }} onClick={addTag} type="button">Add</button>
          <button className="button" style={{ height: 32, fontSize: 13, padding: "0 12px" }} onClick={() => void save()} disabled={saving} type="button">
            {saving ? "Saving…" : "Save tags"}
          </button>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// Delete run button
// -------------------------------------------------------------------
function DeleteRunButton({ runId }: { runId: string }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!token) return null;

  if (!confirming) {
    return (
      <button
        className="button secondary"
        onClick={() => setConfirming(true)}
        style={{ height: 34, fontSize: 13, color: "var(--danger)", borderColor: "var(--danger)" }}
        type="button"
      >
        <Trash2 size={15} aria-hidden="true" /> Delete
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "var(--danger)" }}>Delete this run?</span>
      <button
        className="button"
        style={{ height: 32, fontSize: 13, background: "var(--danger)", borderColor: "var(--danger)" }}
        disabled={deleting}
        onClick={async () => {
          setDeleting(true);
          try {
            await deleteRun(token, runId);
            toast("Run deleted", "success");
            router.push("/runs");
          } catch (e) {
            toast(e instanceof Error ? e.message : "Delete failed", "error");
            setConfirming(false);
          } finally {
            setDeleting(false);
          }
        }}
        type="button"
      >
        {deleting ? "Deleting…" : "Yes, delete"}
      </button>
      <button className="button secondary" style={{ height: 32, fontSize: 13 }} onClick={() => setConfirming(false)} type="button">
        Cancel
      </button>
    </div>
  );
}

// -------------------------------------------------------------------
// Simple markdown → safe HTML (no dependencies)
// -------------------------------------------------------------------
function renderMd(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/^### (.+)$/gm, "<strong>$1</strong>")
    .replace(/^## (.+)$/gm, "<strong>$1</strong>")
    .replace(/^# (.+)$/gm, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code style=\"background:var(--panel-2);padding:1px 5px;border-radius:4px;font-size:12px\">$1</code>")
    .replace(/^- (.+)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}

// -------------------------------------------------------------------
// NotesPanel
// -------------------------------------------------------------------
function NotesPanel({ runId }: { runId: string }) {
  const { user, token } = useAuth();
  const [notes, setNotes] = useState<RunNote[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRunNotes(runId).then(setNotes).catch(() => setNotes([]));
  }, [runId]);

  async function submitNote() {
    if (!draft.trim() || !token) return;
    setSaving(true);
    setErr(null);
    try {
      const note = await createRunNote(token, runId, draft.trim());
      setNotes(prev => [...prev, note]);
      setDraft("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(noteId: number) {
    if (!editContent.trim() || !token) return;
    try {
      const updated = await updateRunNote(token, noteId, editContent.trim());
      setNotes(prev => prev.map(n => n.id === noteId ? updated : n));
      setEditId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update note");
    }
  }

  async function removeNote(noteId: number) {
    if (!token) return;
    try {
      await deleteRunNote(token, noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete note");
    }
  }

  const canEdit = (note: RunNote) => !!user && (note.user_id === user.id || ["owner", "admin"].includes(user.role));

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare size={17} aria-hidden="true" /> Notes
          {notes.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>({notes.length})</span>
          )}
        </h2>
      </div>

      {/* Note list */}
      {notes.length === 0 ? (
        <p style={{ padding: "16px 18px", color: "var(--muted)", fontSize: 14, margin: 0 }}>
          No notes yet. Add the first one below.
        </p>
      ) : (
        <div style={{ padding: "4px 0" }}>
          {notes.map(note => (
            <div key={note.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", background: "var(--strong)", color: "#fff",
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>
                    {note.author_name.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{note.author_name}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {new Date(note.created_at).toLocaleString()}
                    {note.updated_at !== note.created_at && " (edited)"}
                  </span>
                </div>
                {canEdit(note) && editId !== note.id && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="button secondary"
                      style={{ height: 26, fontSize: 12, padding: "0 8px" }}
                      onClick={() => { setEditId(note.id); setEditContent(note.content); }}
                      type="button"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      className="button secondary"
                      style={{ height: 26, fontSize: 12, padding: "0 8px", color: "var(--danger)", borderColor: "var(--danger)" }}
                      onClick={() => void removeNote(note.id)}
                      type="button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {editId === note.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={3}
                    style={{
                      width: "100%", resize: "vertical", border: "1px solid var(--input-border)",
                      borderRadius: 6, padding: "8px 10px", background: "var(--input-bg)", color: "var(--text)",
                      fontSize: 13, fontFamily: "inherit",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="button" style={{ height: 30, fontSize: 12, padding: "0 10px" }}
                      onClick={() => void saveEdit(note.id)} type="button">
                      Save
                    </button>
                    <button className="button secondary" style={{ height: 30, fontSize: 12, padding: "0 10px" }}
                      onClick={() => setEditId(null)} type="button">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)" }}
                  dangerouslySetInnerHTML={{ __html: renderMd(note.content) }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add note */}
      {token ? (
        <div style={{ padding: "14px 18px", borderTop: notes.length > 0 ? undefined : "none" }}>
          {err && (
            <div style={{ marginBottom: 8, padding: "8px 10px", background: "var(--danger-bg)", color: "var(--danger-text)", borderRadius: 6, fontSize: 13 }}>
              {err}
            </div>
          )}
          <textarea
            ref={textRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submitNote();
              }
            }}
            placeholder="Add a note… (supports **bold**, *italic*, `code`, # headers, - lists)"
            rows={3}
            style={{
              width: "100%", resize: "vertical", border: "1px solid var(--input-border)",
              borderRadius: 6, padding: "8px 10px", background: "var(--input-bg)", color: "var(--text)",
              fontSize: 13, fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Ctrl+Enter to submit</span>
            <button
              className="button"
              onClick={() => void submitNote()}
              disabled={saving || !draft.trim()}
              style={{ height: 32, fontSize: 13, padding: "0 14px" }}
              type="button"
            >
              <Send size={13} aria-hidden="true" /> {saving ? "Saving…" : "Add note"}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ padding: "12px 18px", color: "var(--muted)", fontSize: 13, margin: 0 }}>
          <Link href="/login" style={{ color: "var(--strong)" }}>Sign in</Link> to add notes.
        </p>
      )}
    </section>
  );
}

// -------------------------------------------------------------------
// Diff button — opens inline input to enter another run ID
// -------------------------------------------------------------------
function DiffButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [otherId, setOtherId] = useState("");
  const router = useRouter();

  function go() {
    const id = otherId.trim();
    if (!id) return;
    router.push(`/runs/${runId}/diff/${id}`);
  }

  if (!open) {
    return (
      <button className="button secondary" style={{ height: 34 }} onClick={() => setOpen(true)} type="button">
        <GitCompare size={15} aria-hidden="true" /> Diff
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        value={otherId}
        onChange={e => setOtherId(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") go(); if (e.key === "Escape") setOpen(false); }}
        placeholder="Other run ID…"
        autoFocus
        style={{ height: 34, width: 220, fontSize: 13 }}
      />
      <button className="button" style={{ height: 34, fontSize: 13 }} onClick={go} type="button">Compare</button>
      <button className="button secondary" style={{ height: 34, fontSize: 13 }} onClick={() => setOpen(false)} type="button">Cancel</button>
    </div>
  );
}

// -------------------------------------------------------------------
// Overleaf deep-link button
// -------------------------------------------------------------------
function OverleafButton({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function openOverleaf() {
    setLoading(true);
    try {
      const { overleaf_url } = await getOverleafLink(runId);
      window.open(overleaf_url, "_blank", "noreferrer");
    } catch {
      toast("Could not generate Overleaf link", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="button secondary"
      style={{ height: 34 }}
      onClick={() => void openOverleaf()}
      disabled={loading}
      type="button"
      title="Open paper package directly in Overleaf"
    >
      <ExternalLink size={15} aria-hidden="true" /> {loading ? "Loading…" : "Overleaf"}
    </button>
  );
}

export default function RunDetailPage({ params }: { params: { runId: string } }) {
  const [run, setRun] = useState<QLabRun | null>(null);
  const [health, setHealth] = useState<Record<string, number | null>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [r, h] = await Promise.all([fetchRun(params.runId), fetchRunHealth(params.runId).catch(() => ({}))]);
        setRun(r);
        setTags(r.tags);
        setHealth(h);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      }
    }
    void load();
  }, [params.runId]);

  if (error) return <main className="page"><div className="empty">{error}</div></main>;
  if (!run) return <main className="page"><div className="empty">Loading run…</div></main>;

  const hasCalibration = run.calibration && Object.keys(run.calibration).length > 0;
  const hasTiming = run.timing && Object.keys(run.timing).length > 0;
  const hasTranspiler = run.transpiler && Object.keys(run.transpiler).length > 0;
  const hc = healthColor(run.health_score);

  return (
    <main className="page">
      <div className="toolbar">
        <Link className="button secondary" href="/"><ArrowLeft size={17} aria-hidden="true" /> Back</Link>
        <a className="button" href={qlabApiPath(`/api/v1/runs/${run.run_id}/bundle.zip`)}>
          <Package size={17} aria-hidden="true" /> Bundle
        </a>
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/qasm`)}>
          <Download size={17} aria-hidden="true" /> QASM
        </a>
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/rerun.py`)}>
          <FileCode size={17} aria-hidden="true" /> Rerun
        </a>
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/health`)}>
          <Activity size={17} aria-hidden="true" /> Health JSON
        </a>
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/capsule.zip`)} title="Reproducibility Time Capsule — hermetic zip with SHA256 manifest">
          <Package size={17} aria-hidden="true" /> Capsule
        </a>
        <Link className="button secondary" href={`/search/circuits?anchor=${run.run_id}`} title="Find structurally similar circuits">
          <Search size={17} aria-hidden="true" /> Similar
        </Link>
        <DiffButton runId={run.run_id} />
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/report.md`)} download title="Download Markdown report for paper appendix">
          <Download size={17} aria-hidden="true" /> Report.md
        </a>
        <a className="button secondary" href={qlabApiPath(`/api/v1/runs/${run.run_id}/report.tex`)} download title="Download LaTeX tables for paper appendix">
          <FileCode size={17} aria-hidden="true" /> Report.tex
        </a>
        <a className="button secondary" href={getPaperPackageUrl(run.run_id)} download title="Download complete LaTeX paper package (methods, results, calibration, bibliography, main.tex)">
          <Package size={17} aria-hidden="true" /> Paper ZIP
        </a>
        <OverleafButton runId={run.run_id} />
        <ShareButton runId={run.run_id} />
        <BadgeButton runId={run.run_id} />
        <DeleteRunButton runId={run.run_id} />
      </div>

      <section className="summary-grid" aria-label="Circuit metrics">
        <div className="metric">
          <div className="metric-label">Qubits</div>
          <div className="metric-value">{run.fingerprint.num_qubits ?? 0}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Depth</div>
          <div className="metric-value">{run.fingerprint.depth ?? 0}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Gates</div>
          <div className="metric-value">{run.fingerprint.size ?? 0}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Non-Clifford</div>
          <div className="metric-value">{(((run.fingerprint.non_clifford_ratio ?? 0) * 100)).toFixed(1)}%</div>
        </div>
        <div className="metric" style={{ borderColor: hc }}>
          <div className="metric-label">Execution Quality</div>
          <div className="metric-value" style={{ color: hc }}>{run.health_score ?? "—"}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>{run.circuit_name || run.run_id}</h2></div>
        <div style={{ padding: "0 16px 12px" }}>
          <KeyValue label="Run ID" value={<code style={{ fontSize: 12 }}>{run.run_id}</code>} />
          <KeyValue label="Project" value={run.project || "—"} />
          <KeyValue label="Backend" value={run.backend || "—"} />
          <KeyValue label="Status" value={<span style={{ fontWeight: 600 }}>{run.status}</span>} />
          <KeyValue label="Benchmark" value={run.benchmark_id || "—"} />
          <KeyValue label="Created" value={new Date(run.created_at).toLocaleString()} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)", fontSize: 14, alignItems: "flex-start", gap: 12 }}>
            <span style={{ color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>Tags</span>
            <div style={{ flex: 1 }}>
              <TagEditor runId={run.run_id} initialTags={tags} onSaved={setTags} />
            </div>
          </div>
        </div>
      </section>

      <InsightsPanel runId={run.run_id} />
      <LiteratureSection runId={run.run_id} />
      <AnomalyPanel runId={run.run_id} />
      <RootCausePanel runId={run.run_id} />
      <ErrorBudgetPanel runId={run.run_id} />
      <RobustnessPanel runId={run.run_id} />
      <QuantumVolumePanel runId={run.run_id} />
      <MitigationPanel runId={run.run_id} />
      <GateFlameChart run={run} />
      <MetricsPanel runId={run.run_id} />
      <ConvergencePanel runId={run.run_id} />
      <LandscapePanel runId={run.run_id} />
      <AssertionsPanel runId={run.run_id} />

      <section className="panel">
        <div className="panel-header"><h2>Execution Quality Score</h2></div>
        <div style={{ padding: "12px 16px" }}>
          <ScoreGauge score={run.health_score} />
          <div style={{ margin: "10px 0 12px", padding: "8px 12px", background: "var(--panel-2)", borderRadius: 6, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            Weighted heuristic: success probability 40% + gate fidelity 30% + readout fidelity 20% + circuit efficiency 10%. Weights may not reflect the dominant noise source for all workload types.
          </div>
          <div style={{ marginTop: 12 }}>
            {Object.entries(health).filter(([k]) => k !== "overall").map(([k, v]) => (
              <KeyValue key={k} label={k.replace(/_/g, " ")} value={v !== null ? String(v) : "—"} />
            ))}
          </div>
        </div>
      </section>

      {run.results && Object.keys(run.results).length > 0 && (
        <MeasurementHistogram results={run.results} />
      )}

      <ShadowSimPanel runId={run.run_id} />

      <QubitMapPanel runId={run.run_id} />

      {hasCalibration && (
        <TopologyPanel calibration={run.calibration as Record<string, unknown>} />
      )}

      {hasCalibration && (
        <section className="panel">
          <div className="panel-header"><h2>Hardware Calibration</h2></div>
          <div style={{ padding: "0 16px 12px" }}>
            {!!run.calibration.snapshot_time && (
              <KeyValue label="Snapshot time" value={String(run.calibration.snapshot_time)} />
            )}
          </div>
          <pre className="code">{jsonBlock(run.calibration)}</pre>
        </section>
      )}

      {hasTiming && (
        <section className="panel">
          <div className="panel-header"><h2>Phase Timing</h2></div>
          <div style={{ padding: "0 16px 12px" }}>
            {Object.entries(run.timing).map(([k, v]) => (
              <KeyValue key={k} label={k.replace(/_/g, " ")} value={String(v)} />
            ))}
          </div>
        </section>
      )}

      {hasTranspiler && <TranspilerPanel transpiler={run.transpiler} />}

      <ResourceEstimatePanel runId={run.run_id} />

      {run.qasm && <CircuitDiagram runId={run.run_id} />}

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-header"><h2>QASM</h2></div>
          <pre className="code">{run.qasm || "QASM not available."}</pre>
        </section>
        <div style={{ display: "grid", gap: 18 }}>
          <section className="panel">
            <div className="panel-header"><h2>Fingerprint</h2></div>
            <pre className="code">{jsonBlock(run.fingerprint)}</pre>
          </section>
          <section className="panel">
            <div className="panel-header"><h2>Parameters</h2></div>
            <pre className="code">{jsonBlock(run.parameters)}</pre>
          </section>
          <section className="panel">
            <div className="panel-header"><h2>Execution</h2></div>
            <pre className="code">{jsonBlock(run.execution)}</pre>
          </section>
          <section className="panel">
            <div className="panel-header"><h2>Results</h2></div>
            <pre className="code">{jsonBlock(run.results)}</pre>
          </section>
        </div>
      </div>

      {run.context && Object.keys(run.context).length > 0
        ? <ContextPanel context={run.context as Record<string, unknown>} />
        : (
          <section className="panel">
            <div className="panel-header"><h2>Runtime Context</h2></div>
            <p style={{ padding: "12px 18px", fontSize: 13, color: "var(--muted)", margin: 0 }}>No context captured.</p>
          </section>
        )
      }

      <PauliNoisePanel runId={run.run_id} />
      <AdvantageOraclePanel runId={run.run_id} />
      <AnsatzDiscoveryPanel runId={run.run_id} />
      <TransferPredictionPanel runId={run.run_id} />
      <EvoOptimizerPanel runId={run.run_id} />
      <BugDatabasePanel runId={run.run_id} />
      <ReproScorePanel runId={run.run_id} />
      <EntanglementPanel runId={run.run_id} />
      <TomographyPanel runId={run.run_id} />
      <MagicPanel runId={run.run_id} />
      <CircuitTopologyPanel runId={run.run_id} />
      <UAFCPTPanel runId={run.run_id} />
      <AEMDPanel runId={run.run_id} />
      <ZXSimplifyPanel runId={run.run_id} hasQasm={!!run.qasm} />
      <QOETelemetryPanel runId={run.run_id} />
      <ShadowTomoPanel runId={run.run_id} />
      <NoiseModelPanel runId={run.run_id} />
      <CitationsPanel runId={run.run_id} />
      <NotesPanel runId={run.run_id} />
    </main>
  );
}
