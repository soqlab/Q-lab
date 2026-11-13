"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { qlabApiPath } from "../lib/api";
import { DETAILS, DETAIL_LABEL, useDetail, withDetail, type Detail } from "../lib/dial";
import { isCorePath, useLabs } from "../lib/labs";
import { PLACES } from "../lib/places";

/*
 * The one input. Ctrl K, Cmd K or "/" opens it anywhere in the app. What you type is recognised
 * as you type it: a run id, a circuit hash, a project, a backend, a circuit name, or a page or
 * command. Runs, circuits, projects and backends come from the server (/api/v1/lookup), which
 * only finds what you are allowed to see; every result is a link with its own address.
 */

export type Match = { id: string; kind: Kind; title: string; hint: string; href?: string; run?: () => void; group: string };
type Kind = "run" | "circuit" | "project" | "backend" | "hardware" | "page" | "command" | "here";

const KIND_LABEL: Record<Kind, string> = {
  run: "RUN", circuit: "CIRCUIT", project: "PROJECT", backend: "BACKEND", hardware: "QPU", page: "PAGE", command: "DO", here: "HERE",
};
const GROUP_OF: Record<string, string> = {
  run: "Runs", circuit: "Circuits", project: "Projects", backend: "Backends", hardware: "Hardware board",
};

const OPEN_EVENT = "qlab:command";
export function openCommand(q = "") {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: q }));
}

// Context commands: a page says what makes sense to do from it (a run page offers its comparison,
// its project's timeline, its verification page). Kept in a tiny store so any page can set them.
let contextItems: Match[] = [];
const CONTEXT_EVENT = "qlab:context";
export function setCommandContext(items: Omit<Match, "group">[]) {
  contextItems = items.map((m) => ({ ...m, group: "On this page" }));
  window.dispatchEvent(new Event(CONTEXT_EVENT));
}
function useContextItems(): Match[] {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(CONTEXT_EVENT, cb); return () => window.removeEventListener(CONTEXT_EVENT, cb); },
    () => contextItems,
    () => contextItems,
  );
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{5,63}$/;
const HEX = /^[0-9a-f]{8,64}$/i;

/** What the text looks like before the server answers, so the first suggestion appears at once. */
export function shapeOf(raw: string): Kind[] {
  const s = raw.trim();
  const out: Kind[] = [];
  if (HEX.test(s)) out.push("circuit");
  if (/^(ibm|ibmq|fake|ionq|rigetti|quantinuum|iqm|aer|braket)[_-]?/i.test(s)) out.push("backend");
  if (RUN_ID.test(s) && /\d/.test(s)) out.push("run");
  return out;
}

function words(q: string) {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function localMatches(q: string, labs: boolean, detail: Detail, setDetail: (d: Detail) => void, setLabs: (v: boolean) => void): Match[] {
  const ws = words(q);
  const commands: Match[] = [
    ...DETAILS.map((d) => ({
      id: `detail:${d}`, kind: "command" as Kind, group: "Commands",
      title: `Show ${DETAIL_LABEL[d].toLowerCase()} detail`, hint: d === detail ? "Current level" : d === "plain" ? "Plain words, the answer and little else" : d === "expert" ? "Everything: counts, transpiler settings, raw records" : "The usual view",
      run: () => setDetail(d),
    })),
    { id: "labs", kind: "command", group: "Commands", title: labs ? "Turn Labs off" : "Turn Labs on", hint: labs ? "Hide the experimental tools" : "Show the experimental tools (less tested)", run: () => setLabs(!labs) },
  ];
  const places: Match[] = [];
  const seen = new Set<string>();
  for (const p of PLACES) {
    if (seen.has(p.href)) continue;
    seen.add(p.href);
    const core = isCorePath(p.href);
    if (!core && !labs) continue;
    places.push({ id: `page:${p.href}`, kind: "page", group: core ? "Pages" : "Labs pages", title: p.title, hint: core ? p.group : `${p.group} · Labs`, href: p.href });
  }
  const all = [...commands, ...places];
  if (!ws.length) return [...places.filter((p) => p.group === "Pages").slice(0, 8), ...commands];
  return all
    .map((m) => {
      const hay = `${m.title} ${m.hint} ${m.href ?? ""} ${(PLACES.find((p) => p.href === m.href)?.keywords ?? []).join(" ")}`.toLowerCase();
      if (!ws.every((w) => hay.includes(w))) return null;
      const t = m.title.toLowerCase();
      return { m, score: (t.startsWith(ws[0]) ? 3 : 0) + (t.includes(q.toLowerCase()) ? 2 : 0) + (m.group === "Pages" ? 1 : 0) };
    })
    .filter((x): x is { m: Match; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m)
    .slice(0, 12);
}

type Remote = { q: string; state: "idle" | "loading" | "ok" | "error"; matches: Match[] };

function useLookup(q: string): Remote {
  const [r, setR] = useState<Remote>({ q: "", state: "idle", matches: [] });
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return;
    let on = true;
    const t = window.setTimeout(() => {
      setR({ q: s, state: "loading", matches: [] });
      fetch(qlabApiPath(`/api/v1/lookup?q=${encodeURIComponent(s)}`), { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((d: { matches: { kind: Kind; title: string; href: string; hint: string }[] }) => {
          if (!on) return;
          setR({ q: s, state: "ok", matches: d.matches.map((m) => ({ ...m, id: `${m.kind}:${m.href}`, group: GROUP_OF[m.kind] ?? "Results" })) });
        })
        .catch(() => { if (on) setR({ q: s, state: "error", matches: [] }); });
    }, 140);
    return () => { on = false; window.clearTimeout(t); };
  }, [q]);
  return q.trim().length < 2 ? { q: "", state: "idle", matches: [] } : r;
}

function Box({ initial, onDone }: { initial: string; onDone: () => void }) {
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const [detail, setDetail] = useDetail();
  const [labs, setLabs] = useLabs();
  const context = useContextItems();
  const remote = useLookup(q);
  const uid = useId().replace(/:/g, "");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const ws = words(q);
    const here = ws.length ? context.filter((m) => ws.every((w) => `${m.title} ${m.hint}`.toLowerCase().includes(w))) : context;
    const server = remote.q === q.trim() ? remote.matches : [];
    const out: Match[] = [...server, ...here, ...localMatches(q, labs, detail, setDetail, setLabs)];
    const seen = new Set<string>();
    return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).slice(0, 24);
  }, [q, context, remote, labs, detail, setDetail, setLabs]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`#${uid}-o${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, uid]);

  const choose = useCallback((m?: Match) => {
    if (!m) return;
    onDone();
    if (m.run) m.run();
    else if (m.href) router.push(withDetail(m.href, detail));
  }, [onDone, router, detail]);

  const shapes = shapeOf(q);
  const pending = remote.state === "loading" || (q.trim().length >= 2 && remote.q !== q.trim());

  const groups: { name: string; items: { m: Match; i: number }[] }[] = [];
  matches.forEach((m, i) => {
    const g = groups.find((x) => x.name === m.group) ?? (groups.push({ name: m.group, items: [] }), groups[groups.length - 1]);
    g.items.push({ m, i });
  });

  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); choose(matches[active]); }}>
      <div className="palette-field">
        <span aria-hidden="true">›</span>
        <input
          ref={input} value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off"
          role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-autocomplete="list"
          aria-activedescendant={matches[active] ? `${uid}-o${active}` : undefined}
          aria-label="Run id, project, backend, circuit hash, page or command"
          placeholder="Run id, project, backend, circuit hash, page…"
          onKeyDown={(e) => {
            const n = matches.length;
            if (e.key === "ArrowDown") { e.preventDefault(); if (n) setActive((a) => (a + 1) % n); }
            else if (e.key === "ArrowUp") { e.preventDefault(); if (n) setActive((a) => (a - 1 + n) % n); }
            else if (e.key === "Escape") { e.preventDefault(); if (q) setQ(""); else onDone(); }
          }}
        />
      </div>
      <div ref={list} id={`${uid}-list`} role="listbox" aria-label="Results" className="palette-list">
        {groups.map((g, gi) => (
          <div role="group" key={g.name} aria-labelledby={`${uid}-g${gi}`}>
            <div className="palette-group" id={`${uid}-g${gi}`} role="presentation">{g.name}</div>
            {g.items.map(({ m, i }) => (
              <div key={m.id} id={`${uid}-o${i}`} role="option" aria-selected={i === active} className="palette-opt"
                onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => choose(m)}>
                <span className="palette-kind">{KIND_LABEL[m.kind]}</span>
                <span className="palette-title">{m.title}</span>
                <span className="palette-hint">{m.hint}{m.href ? ` · ${m.href}` : ""}</span>
              </div>
            ))}
          </div>
        ))}
        {pending && shapes.length > 0 && (
          <div className="palette-empty">Looks like a {shapes.map((s) => KIND_LABEL[s].toLowerCase()).join(" or ")}; looking it up…</div>
        )}
        {!pending && !matches.length && (
          <div className="palette-empty">
            Nothing matches “{q}”{remote.state === "error" ? " (the server didn't answer the lookup)" : ""}. Try a run id, a project name, a backend such as ibm_torino, or the first characters of a circuit hash.
          </div>
        )}
      </div>
      <div className="palette-foot" aria-hidden="true">
        <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span>
        <span>Detail: {DETAIL_LABEL[detail]}</span>
      </div>
      <p className="sr-only" aria-live="polite">{matches.length} results</p>
    </form>
  );
}

/** Mounted once in the app shell. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const back = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const show = useCallback((q = "") => {
    back.current = document.activeElement as HTMLElement | null;
    setSeed(q);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => back.current?.focus?.(), 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); if (open) hide(); else show(); }
      else if (e.key === "/" && !typing && !open && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); show(); }
    };
    const onOpen = (e: Event) => show(typeof (e as CustomEvent).detail === "string" ? (e as CustomEvent).detail : "");
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, [open, show, hide]);

  // A page change closes it (the context commands belong to the old page).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) { setLastPath(pathname); if (open) setOpen(false); }

  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command bar">
        <Box initial={seed} onDone={hide} />
      </div>
    </div>
  );
}
