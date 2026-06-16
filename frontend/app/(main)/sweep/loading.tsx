export default function SweepLoading() {
  return (
    <main className="page">
      <div className="toolbar" style={{ gap: 8 }}>
        {[140, 120, 140, 120].map((w, i) => (
          <div key={i} className="shimmer" style={{ height: 36, width: w, borderRadius: 6 }} />
        ))}
      </div>
      <div className="panel shimmer" style={{ height: 400 }} />
    </main>
  );
}
