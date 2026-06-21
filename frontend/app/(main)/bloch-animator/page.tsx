"use client";
import { useState, useEffect } from "react";
import { animateBloch, BlochAnimResult, BlochFrame } from "@/lib/api";

const PRESETS: Record<string, { gates: string[]; state: string }> = {
  "Bell Prep": { gates: ["h", "x"], state: "0" },
  "X Gate": { gates: ["x"], state: "0" },
  "H + T": { gates: ["h", "t", "h"], state: "0" },
  "Z Rotation": { gates: ["s", "s", "z"], state: "+" },
  "Full Bloch": { gates: ["h", "t", "s", "x", "z", "h", "y"], state: "0" },
};
const ALL_GATES = ["h", "x", "y", "z", "s", "sdg", "t", "tdg", "rx45", "ry", "reset"];

export default function BlochAnimatorPage() {
  const [gateSeq, setGateSeq] = useState(["h", "t", "h", "s"]);
  const [initState, setInitState] = useState("0");
  const [nFrames, setNFrames] = useState(30);
  const [noise, setNoise] = useState(0.0);
  const [result, setResult] = useState<BlochAnimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [gateInput, setGateInput] = useState("");

  async function run() {
    setLoading(true); setError(null); setFrameIdx(0);
    try { setResult(await animateBloch({ gate_sequence: gateSeq, initial_state: initState, n_frames: nFrames, noise_level: noise })); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);

  function applyPreset(name: string) {
    const p = PRESETS[name];
    setGateSeq(p.gates); setInitState(p.state);
  }

  function addGate(g: string) { setGateSeq(prev => [...prev, g]); }
  function removeGate(i: number) { setGateSeq(prev => prev.filter((_, idx) => idx !== i)); }

  const currentFrame: BlochFrame | undefined = result?.frames[frameIdx];

  function blochSVG(bx: number, by: number, bz: number, traj?: Array<{ bx: number; by: number; bz: number }>) {
    const cx = 100, cy = 100, r = 70;
    const px = cx + r * bx;
    const pz = cy - r * bz;
    const trajPts = traj?.map(t => `${cx + r * t.bx},${cy - r * t.bz}`).join(" ");
    return (
      <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: 220 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#334155" strokeWidth={1} />
        <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.3} fill="none" stroke="#1e293b" strokeWidth={1} />
        <line x1={cx} y1={cy - r - 10} x2={cx} y2={cy + r + 10} stroke="#334155" strokeWidth={1} />
        <line x1={cx - r - 10} y1={cy} x2={cx + r + 10} y2={cy} stroke="#334155" strokeWidth={1} />
        <text x={cx} y={cy - r - 14} textAnchor="middle" fontSize={10} fill="#94a3b8">|0⟩</text>
        <text x={cx} y={cy + r + 20} textAnchor="middle" fontSize={10} fill="#94a3b8">|1⟩</text>
        {traj && traj.length > 1 && <polyline fill="none" stroke="#6366f1" strokeWidth={1.5} opacity={0.5} points={trajPts} />}
        <line x1={cx} y1={cy} x2={px} y2={pz} stroke="#f59e0b" strokeWidth={2.5} />
        <circle cx={px} cy={pz} r={5} fill="#f59e0b" />
      </svg>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Presets</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {Object.keys(PRESETS).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                style={{ padding: "4px 10px", background: "#0f172a", color: "#94a3b8", border: "1px solid #334155", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                {p}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Gate Sequence</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, minHeight: 32 }}>
            {gateSeq.map((g, i) => (
              <span key={i} onClick={() => removeGate(i)}
                style={{ padding: "3px 8px", borderRadius: 6, background: "#6366f1", color: "#e2e8f0", fontSize: 13, fontFamily: "monospace", cursor: "pointer" }}>
                {g} ×
              </span>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
            {ALL_GATES.map(g => (
              <button key={g} onClick={() => addGate(g)}
                style={{ padding: "3px 8px", background: "#0f172a", color: "#94a3b8", border: "1px solid #334155", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>
                {g}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, color: "#64748b" }}>Initial State</label>
          <select value={initState} onChange={e => setInitState(e.target.value)}
            style={{ width: "100%", marginTop: 4, marginBottom: 10, padding: "8px 10px", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6 }}>
            {["0", "1", "+", "-", "+i", "-i"].map(s => <option key={s} value={s}>|{s}⟩</option>)}
          </select>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Frames: {nFrames}</div>
            <input type="range" min={5} max={100} step={1} value={nFrames} onChange={e => setNFrames(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Noise: {noise.toFixed(3)}</div>
            <input type="range" min={0} max={0.1} step={0.005} value={noise} onChange={e => setNoise(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
          <button onClick={run} disabled={loading}
            style={{ width: "100%", padding: "8px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
            {loading ? "Animating…" : "Animate"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: 12, borderRadius: 8 }}>{error}</div>}
        {result && (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ width: 220, flexShrink: 0 }}>
                {currentFrame && blochSVG(currentFrame.bx, currentFrame.by, currentFrame.bz, result.trajectory)}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                {currentFrame && (
                  <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                    <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Step {currentFrame.step} — {currentFrame.gate}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      {[["Bx", currentFrame.bx.toFixed(4), "#f87171"], ["By", currentFrame.by.toFixed(4), "#34d399"], ["Bz", currentFrame.bz.toFixed(4), "#6366f1"]].map(([l, v, c]) => (
                        <div key={l} style={{ background: "#0f172a", borderRadius: 6, padding: 10, textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "#64748b" }}>{l}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: String(c) }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ background: "#0f172a", borderRadius: 6, padding: 8 }}>
                        <div style={{ fontSize: 10, color: "#64748b" }}>|0⟩</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{(result.prob_0 * 100).toFixed(1)}%</div>
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: 6, padding: 8 }}>
                        <div style={{ fontSize: 10, color: "#64748b" }}>|1⟩</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{(result.prob_1 * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>Final State</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Purity: <span style={{ color: "#e2e8f0" }}>{result.purity.toFixed(4)}</span> {result.is_pure_state ? <span style={{ color: "#34d399" }}>✓ Pure</span> : <span style={{ color: "#f87171" }}>Mixed</span>}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>α = {result.amplitude_0.real.toFixed(4)} + {result.amplitude_0.imag.toFixed(4)}i</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>β = {result.amplitude_1.real.toFixed(4)} + {result.amplitude_1.imag.toFixed(4)}i</div>
                </div>
              </div>
            </div>

            <div style={{ background: "#1e293b", borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>Animation Timeline</div>
              <input type="range" min={0} max={result.frames.length - 1} step={1} value={frameIdx}
                onChange={e => setFrameIdx(Number(e.target.value))} style={{ width: "100%" }} />
              <div style={{ display: "flex", gap: 4, overflowX: "auto", marginTop: 8 }}>
                {result.frames.map((f, i) => (
                  <button key={i} onClick={() => setFrameIdx(i)}
                    style={{ padding: "4px 8px", borderRadius: 4, border: "none", cursor: "pointer", flexShrink: 0, background: frameIdx === i ? "#6366f1" : "#0f172a", color: frameIdx === i ? "#fff" : "#64748b", fontSize: 11, fontFamily: "monospace" }}>
                    {f.gate}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {!result && !loading && <div style={{ color: "#475569", textAlign: "center", padding: 60 }}>Build gate sequence and animate</div>}
      </div>
    </div>
  );
}
