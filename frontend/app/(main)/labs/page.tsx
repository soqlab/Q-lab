"use client";

import Link from "next/link";
import { useLabs } from "../../../lib/labs";
import { LABS_PLACES, type Place } from "../../../lib/places";
import { useDetail, withDetail } from "../../../lib/dial";

// Labs: every experimental tool, by area. They are kept out of the command bar so it only offers
// what the tracker is for; this list is where they live.
export default function LabsPage() {
  const [labs, setLabs, ready] = useLabs();
  const [d] = useDetail();
  const groups: { name: string; items: Place[] }[] = [];
  for (const p of LABS_PLACES) {
    const g = groups.find((x) => x.name === p.group) ?? (groups.push({ name: p.group, items: [] }), groups[groups.length - 1]);
    g.items.push(p);
  }

  return (
    <main className="page">
      <section className="frame" aria-labelledby="labs-h">
        <div className="frame-head">
          <h1 id="labs-h" className="inst-label">Labs</h1>
          {ready && (
            <button type="button" className={labs ? "button secondary" : "button"} onClick={() => setLabs(!labs)} aria-pressed={labs}>
              {labs ? "Turn Labs off" : "Turn Labs on"}
            </button>
          )}
        </div>
        <div className="frame-body">
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, maxWidth: 680 }}>
            Early tools that are less tested than the run tracker. {labs
              ? "Labs is on in this browser: every tool below opens."
              : "Turn Labs on to open them; the choice is kept in this browser."}
          </p>
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.name} className="frame" aria-labelledby={`labs-${g.name}`}>
          <div className="frame-head"><h2 id={`labs-${g.name}`} className="inst-label">{g.name}</h2></div>
          <ul className="frame-body" style={{ listStyle: "none", margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "6px 16px" }}>
            {g.items.map((p) => (
              <li key={p.href}>
                {labs
                  ? <Link href={withDetail(p.href, d)}>{p.title}</Link>
                  : <span style={{ color: "var(--muted)" }}>{p.title}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
