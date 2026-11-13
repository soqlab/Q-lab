import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "40px 16px", background: "var(--bg)" }}>
      <div className="frame" style={{ maxWidth: 460, width: "100%" }}>
        <div className="frame-head"><span className="inst-label">404 · nothing at this address</span></div>
        <div className="frame-body" style={{ display: "grid", gap: 14 }}>
          <p className="summary-line">There is no page here. If you followed a link to a run, it may have been deleted or its share link turned off.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/runs" className="button">Your runs</Link>
            <Link href="/" className="button secondary">Q-Lab home</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
