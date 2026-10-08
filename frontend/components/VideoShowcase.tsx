"use client";

import { useEffect, useRef } from "react";

const CSS = `
  .vs-wrap { position: relative; max-width: 1000px; margin: 0 auto; }
  .vs-circuit { position: absolute; top: -70px; bottom: -70px; left: 50%; width: 100vw; transform: translateX(-50%); pointer-events: none; z-index: 0; }
  .vs-frame { position: relative; z-index: 1; padding: 1px; border-radius: 16px; overflow: hidden; background: rgba(99,102,241,0.22); box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 90px rgba(99,102,241,0.14); }
  .vs-frame::before { content: ""; position: absolute; inset: -60%; background: conic-gradient(from 0deg, transparent 0 68%, rgba(129,140,248,0.95) 78%, rgba(192,132,252,0.95) 84%, transparent 92%); animation: vs-spin 7s linear infinite; }
  .vs-inner { position: relative; border-radius: 15px; overflow: hidden; background: #000; }
  .vs-inner video { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; }
  @keyframes vs-spin { to { transform: rotate(360deg); } }
  .vs-tag { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px;
    background: rgba(13,17,23,0.92); border: 1px solid rgba(99,102,241,0.35); backdrop-filter: blur(8px);
    font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; color: #c7d2fe; white-space: nowrap;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45); animation: vs-float 6s ease-in-out infinite; }
  .vs-tag b { color: #f1f5f9; font-weight: 600; }
  .vs-tag .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 10px #34d399; animation: vs-blink 1.6s ease-in-out infinite; }
  .vs-tag.t1 { top: -18px; left: 56px; }
  .vs-tag.t2 { top: 24%; right: -84px; animation-delay: -1.5s; }
  .vs-tag.t3 { top: 58%; left: -96px; animation-delay: -3s; }
  .vs-tag.t4 { bottom: -44px; right: 56px; animation-delay: -4.5s; }
  @keyframes vs-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  @keyframes vs-blink { 50% { opacity: 0.35; } }
  @media (max-width: 1180px) { .vs-tag { display: none; } }
  @media (prefers-reduced-motion: reduce) { .vs-frame::before, .vs-tag, .vs-tag .dot { animation: none; } }
`;

type Gate = { col: number; q: number; kind: "H" | "X" | "SX" | "RZ" | "CX" | "M"; t?: number };

// A quantum circuit streaming right-to-left behind the video: wires, single-qubit gates, CNOTs, measurements.
function CircuitBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0, start = 0, visible = true;

    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const QUBITS = 7;
    const gates: Gate[] = [];
    for (let col = 0; col < 400; col++) {
      const used = new Set<number>();
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const q = Math.floor(rnd() * QUBITS);
        if (used.has(q)) continue;
        const r = rnd();
        if (r < 0.28 && q < QUBITS - 1 && !used.has(q + 1)) {
          const t = q + 1 + Math.floor(rnd() * Math.min(3, QUBITS - 1 - q));
          for (let x = q; x <= t; x++) used.add(x);
          gates.push({ col, q, kind: "CX", t });
        } else {
          used.add(q);
          gates.push({ col, q, kind: r < 0.5 ? "H" : r < 0.66 ? "X" : r < 0.8 ? "SX" : r < 0.93 ? "RZ" : "M" });
        }
      }
    }

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (ts: number) => {
      if (!start) start = ts;
      const t = reduced ? 0 : (ts - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const top = h * 0.08, bottom = h * 0.92;
      const yq = (q: number) => top + ((bottom - top) * q) / (QUBITS - 1);
      const colW = 64, speed = 26;
      const shift = (t * speed) % (colW * 400);

      for (let q = 0; q < QUBITS; q++) {
        ctx.strokeStyle = "rgba(129,140,248,0.22)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, yq(q)); ctx.lineTo(w, yq(q)); ctx.stroke();
        ctx.font = "11px 'Cascadia Code', Consolas, monospace"; ctx.fillStyle = "rgba(129,140,248,0.55)"; ctx.textAlign = "left";
        ctx.fillText(`q${q}`, 14, yq(q) - 6);
      }

      for (let p = 0; p < QUBITS; p++) {
        const u = ((t * 0.09 + p * 0.37) % 1);
        const x = w - u * w, y = yq(p);
        const g = ctx.createLinearGradient(x, y, x + 140, y);
        g.addColorStop(0, "rgba(192,132,252,0.9)"); g.addColorStop(1, "rgba(192,132,252,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 140, y); ctx.stroke();
      }

      for (const g of gates) {
        const x = g.col * colW - shift + 60;
        if (x < -40 || x > w + 40) continue;
        const y = yq(g.q);
        const fade = Math.min(1, x / 120, (w - x) / 120);
        if (fade <= 0) continue;
        const a = 0.75 * fade;
        if (g.kind === "CX" && g.t !== undefined) {
          const yt = yq(g.t);
          ctx.strokeStyle = `rgba(167,139,250,${a})`; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yt); ctx.stroke();
          ctx.fillStyle = `rgba(167,139,250,${a})`;
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x, yt, 10, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 10, yt); ctx.lineTo(x + 10, yt); ctx.moveTo(x, yt - 10); ctx.lineTo(x, yt + 10); ctx.stroke();
          continue;
        }
        const bw = g.kind === "SX" || g.kind === "RZ" ? 30 : 24, bh = 24;
        ctx.fillStyle = `rgba(11,14,22,${0.95 * fade})`;
        ctx.strokeStyle = g.kind === "M" ? `rgba(52,211,153,${a})` : `rgba(129,140,248,${a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4); ctx.fill(); ctx.stroke();
        if (g.kind === "M") {
          ctx.beginPath(); ctx.arc(x, y + 5, 7, Math.PI, 0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x + 6, y - 6); ctx.stroke();
        } else {
          ctx.font = "11px 'Cascadia Code', Consolas, monospace"; ctx.textAlign = "center";
          ctx.fillStyle = `rgba(199,210,254,${a})`; ctx.fillText(g.kind, x, y + 4);
        }
      }

      const eg = ctx.createLinearGradient(0, 0, w, 0);
      eg.addColorStop(0, "rgba(10,10,15,1)"); eg.addColorStop(0.06, "rgba(10,10,15,0)");
      eg.addColorStop(0.94, "rgba(10,10,15,0)"); eg.addColorStop(1, "rgba(10,10,15,1)");
      ctx.fillStyle = eg; ctx.fillRect(0, 0, w, h);

      if (visible && !reduced) raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(performance.now()); });
    ro.observe(canvas);
    resize();
    const io = new IntersectionObserver(([e]) => {
      const was = visible; visible = e.isIntersecting;
      if (visible && !was && !reduced) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  return <canvas ref={ref} className="vs-circuit" aria-hidden="true" />;
}

export default function VideoShowcase() {
  return (
    <div className="vs-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <CircuitBackdrop />
      <span className="vs-tag t1"><i className="dot" />capturing <b>r-9f2a</b></span>
      <span className="vs-tag t2">backend <b>ibm_brisbane</b></span>
      <span className="vs-tag t3">depth <b>42</b> · qubits <b>8</b></span>
      <span className="vs-tag t4">fidelity <b>0.973</b></span>
      <div className="vs-frame">
        <div className="vs-inner">
          <video controls playsInline preload="metadata" poster="/videos/qlab-commercial-poster.jpg">
            <source src="/videos/qlab-commercial.mp4" type="video/mp4" />
            Your browser can&apos;t play this video. <a href="/videos/qlab-commercial.mp4">Download it</a> instead.
          </video>
        </div>
      </div>
    </div>
  );
}
