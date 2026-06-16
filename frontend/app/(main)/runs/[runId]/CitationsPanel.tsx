"use client";

import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, Plus, Trash2, Download, X } from "lucide-react";
import { fetchCitations, addCitation, deleteCitation, Citation, CitationsResponse, qlabApiPath } from "../../../../lib/api";

// ------------------------------------------------------------------
// Citation card
// ------------------------------------------------------------------
function CitationCard({ citation, onDelete }: { citation: Citation; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title / ID line */}
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 3 }}>
            {citation.title ?? (citation.arxiv_id ? `arXiv:${citation.arxiv_id}` : citation.doi ?? "Citation")}
          </div>
          {/* Authors + year */}
          {(citation.authors || citation.year) && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {citation.authors}{citation.authors && citation.year && ", "}{citation.year}
              {citation.journal && <> · <em>{citation.journal}</em></>}
            </div>
          )}
          {/* Links */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {citation.arxiv_url && (
              <a href={citation.arxiv_url} target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--strong)" }}>
                <ExternalLink size={11} /> arXiv
              </a>
            )}
            {citation.doi_url && (
              <a href={citation.doi_url} target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--strong)" }}>
                <ExternalLink size={11} /> DOI
              </a>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", padding: 0 }}
            >
              {expanded ? "Hide BibTeX" : "Show BibTeX"}
            </button>
          </div>
          {citation.note && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
              Note: {citation.note}
            </div>
          )}
          {expanded && (
            <pre style={{
              marginTop: 8, padding: "8px 10px", background: "var(--panel-2)", borderRadius: 6,
              fontSize: 11, lineHeight: 1.5, overflowX: "auto", color: "var(--text)",
            }}>
              {citation.bibtex}
            </pre>
          )}
        </div>
        <button
          onClick={onDelete}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: "2px", flexShrink: 0 }}
          title="Remove citation"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Add form
// ------------------------------------------------------------------
type FormState = {
  arxiv_id: string; doi: string; title: string;
  authors: string; journal: string; year: string; note: string;
};
const EMPTY_FORM: FormState = { arxiv_id: "", doi: "", title: "", authors: "", journal: "", year: "", note: "" };

function AddCitationForm({ runId, onAdded }: { runId: string; onAdded: (c: Citation) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        arxiv_id: form.arxiv_id.trim() || undefined,
        doi: form.doi.trim() || undefined,
        title: form.title.trim() || undefined,
        authors: form.authors.trim() || undefined,
        journal: form.journal.trim() || undefined,
        year: form.year ? parseInt(form.year, 10) : undefined,
        note: form.note.trim() || undefined,
      };
      const c = await addCitation(runId, payload);
      onAdded(c);
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add citation");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div style={{ padding: "10px 18px" }}>
        <button className="button secondary" style={{ fontSize: 13, height: 32 }} onClick={() => setOpen(true)} type="button">
          <Plus size={14} /> Add Citation
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 18px", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Add Citation</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={14} /></button>
      </div>
      <form onSubmit={e => void submit(e)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>arXiv ID</label>
          <input className="input" value={form.arxiv_id} onChange={e => update("arxiv_id", e.target.value)} placeholder="e.g. 2305.14832" style={{ height: 32 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>DOI</label>
          <input className="input" value={form.doi} onChange={e => update("doi", e.target.value)} placeholder="e.g. 10.1103/..." style={{ height: 32 }} />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Title</label>
          <input className="input" value={form.title} onChange={e => update("title", e.target.value)} placeholder="Paper title" style={{ height: 32 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Authors</label>
          <input className="input" value={form.authors} onChange={e => update("authors", e.target.value)} placeholder="A. Smith, B. Jones" style={{ height: 32 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Journal / Conference</label>
          <input className="input" value={form.journal} onChange={e => update("journal", e.target.value)} placeholder="PRL, Nature, ICML…" style={{ height: 32 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Year</label>
          <input className="input" type="number" value={form.year} onChange={e => update("year", e.target.value)} placeholder="2024" style={{ height: 32 }} min={1900} max={2100} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Note</label>
          <input className="input" value={form.note} onChange={e => update("note", e.target.value)} placeholder="Optional context" style={{ height: 32 }} />
        </div>
        {error && (
          <div style={{ gridColumn: "1 / -1", padding: "6px 8px", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 6, fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
          <button className="button" type="submit" disabled={saving || (!form.arxiv_id && !form.doi && !form.title)} style={{ height: 32, fontSize: 13 }}>
            {saving ? "Saving…" : "Add Citation"}
          </button>
          <button className="button secondary" type="button" onClick={() => setOpen(false)} style={{ height: 32, fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------
export default function CitationsPanel({ runId }: { runId: string }) {
  const [data, setData] = useState<CitationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCitations(runId)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Unavailable"));
  }, [runId]);

  function handleAdded(citation: Citation) {
    setData(prev => prev ? { ...prev, count: prev.count + 1, citations: [...prev.citations, citation] } : { run_id: runId, count: 1, citations: [citation] });
  }

  async function handleDelete(id: number) {
    try {
      await deleteCitation(runId, id);
      setData(prev => prev ? { ...prev, count: prev.count - 1, citations: prev.citations.filter(c => c.id !== id) } : prev);
    } catch {
      // ignore
    }
  }

  if (error) return null;

  const citations = data?.citations ?? [];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BookOpen size={16} aria-hidden="true" /> Citations
          {citations.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>({citations.length})</span>}
        </h2>
        {citations.length > 0 && (
          <a
            className="button secondary"
            href={qlabApiPath(`/api/v1/runs/${runId}/citations/export.bib`)}
            style={{ fontSize: 12, height: 28, padding: "0 10px", marginLeft: "auto" }}
          >
            <Download size={12} /> .bib
          </a>
        )}
      </div>

      {!data && <div className="empty" style={{ padding: 20 }}>Loading citations…</div>}

      {data && citations.length === 0 && (
        <p style={{ padding: "12px 18px", color: "var(--muted)", fontSize: 13, margin: 0 }}>
          No citations yet. Attach papers that inspired or describe this experiment.
        </p>
      )}

      {citations.map(c => (
        <CitationCard key={c.id} citation={c} onDelete={() => void handleDelete(c.id)} />
      ))}

      <AddCitationForm runId={runId} onAdded={handleAdded} />
    </section>
  );
}
