"""Figure Generator.

Generates publication-quality inline SVG figures for quantum computing data.
Pure Python string generation — no matplotlib, no external rendering deps.
Supports: circuit_diagram, energy_landscape, probability_histogram,
          convergence_plot, bloch_sphere, density_matrix_heatmap,
          entanglement_graph, decay_curve.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/figure-gen", tags=["figure_gen"])

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class FigureRequest(BaseModel):
    figure_type: str = Field(..., description="Type of figure to generate")
    data: Dict[str, Any] = Field(default_factory=dict)
    style: str = Field("nature", description="nature | science | arxiv")
    title: str = ""
    xlabel: str = ""
    ylabel: str = ""
    format: str = Field("svg", description="svg (only svg supported)")


_FIGURE_TYPES = [
    "circuit_diagram",
    "energy_landscape",
    "probability_histogram",
    "convergence_plot",
    "bloch_sphere",
    "density_matrix_heatmap",
    "entanglement_graph",
    "decay_curve",
]

# ---------------------------------------------------------------------------
# Style themes
# ---------------------------------------------------------------------------

_STYLE_THEMES: Dict[str, Dict[str, Any]] = {
    "nature": {
        "font_family": "Helvetica, Arial, sans-serif",
        "font_size": 11,
        "line_color": "#222222",
        "bg_color": "#ffffff",
        "axis_color": "#444444",
        "grid_color": "#e8e8e8",
        "palette": ["#0077BB", "#EE7733", "#009988", "#CC3311", "#33BBEE", "#EE3377"],
        "line_width": 1.5,
    },
    "science": {
        "font_family": "Times New Roman, serif",
        "font_size": 9,
        "line_color": "#000000",
        "bg_color": "#ffffff",
        "axis_color": "#000000",
        "grid_color": "#cccccc",
        "palette": ["#000000", "#555555", "#888888", "#333333", "#999999", "#666666"],
        "line_width": 1.0,
    },
    "arxiv": {
        "font_family": "Computer Modern, Georgia, serif",
        "font_size": 10,
        "line_color": "#1a1a1a",
        "bg_color": "#fafafa",
        "axis_color": "#333333",
        "grid_color": "#ddd",
        "palette": ["#2166ac", "#d6604d", "#1a9850", "#762a83", "#e08214", "#4d4d4d"],
        "line_width": 1.2,
    },
}


def _theme(style: str) -> Dict[str, Any]:
    return _STYLE_THEMES.get(style, _STYLE_THEMES["nature"])


# ---------------------------------------------------------------------------
# SVG helpers
# ---------------------------------------------------------------------------

def _svg_wrap(inner: str, width: int, height: int, th: Dict[str, Any]) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" '
        f'style="background:{th["bg_color"]};font-family:{th["font_family"]};font-size:{th["font_size"]}px">'
        f'{inner}'
        f'</svg>'
    )


def _text(x: float, y: float, content: str, anchor: str = "middle",
          size: Optional[int] = None, bold: bool = False,
          color: str = "#222") -> str:
    fw = "bold" if bold else "normal"
    fs = f'font-size="{size}px" ' if size else ""
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
        f'fill="{color}" {fs}font-weight="{fw}">{content}</text>'
    )


def _rect(x: float, y: float, w: float, h: float, fill: str = "#4488cc",
          stroke: str = "#000", sw: float = 1.0, rx: float = 2) -> str:
    return (
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}" rx="{rx:.0f}"/>'
    )


def _line(x1: float, y1: float, x2: float, y2: float,
          stroke: str = "#000", sw: float = 1.5) -> str:
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{sw:.1f}"/>'


def _polyline(points: List[tuple], stroke: str, sw: float = 1.5, fill: str = "none") -> str:
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return f'<polyline points="{pts}" stroke="{stroke}" stroke-width="{sw:.1f}" fill="{fill}"/>'


def _circle(cx: float, cy: float, r: float, fill: str, stroke: str = "#000", sw: float = 1.0) -> str:
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}"/>'


def _title_block(title: str, xlabel: str, ylabel: str,
                 W: int, H: int, pad: int, th: Dict[str, Any]) -> str:
    parts = []
    if title:
        parts.append(_text(W / 2, 18, title, bold=True, size=th["font_size"] + 2, color=th["line_color"]))
    if xlabel:
        parts.append(_text(W / 2, H - 5, xlabel, color=th["axis_color"]))
    if ylabel:
        parts.append(
            f'<text x="12" y="{H / 2:.1f}" text-anchor="middle" '
            f'fill="{th["axis_color"]}" '
            f'transform="rotate(-90,12,{H/2:.1f})">{ylabel}</text>'
        )
    return "".join(parts)


def _color_scale(val: float, lo: float, hi: float) -> str:
    """Map float in [lo, hi] to a blue→white→red color hex."""
    if hi == lo:
        t = 0.5
    else:
        t = (val - lo) / (hi - lo)
    t = max(0.0, min(1.0, t))
    if t < 0.5:
        r = int(255 * t * 2)
        g = int(255 * t * 2)
        b = 255
    else:
        r = 255
        g = int(255 * (1 - t) * 2)
        b = int(255 * (1 - t) * 2)
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------------------
# Figure generators
# ---------------------------------------------------------------------------

def _circuit_diagram(data: Dict, style: str, title: str, W: int, H: int) -> str:
    th = _theme(style)
    qasm = data.get("qasm", "")

    # Parse QASM: extract gate lines
    gates: List[Dict[str, Any]] = []
    n_qubits = 0
    for line in qasm.splitlines():
        line = line.strip().rstrip(";")
        if not line or line.startswith("//") or line.startswith("OPENQASM") or line.startswith("include"):
            continue
        if line.startswith("qreg"):
            try:
                n_qubits = int(line.split("[")[1].split("]")[0])
            except Exception:
                n_qubits = 4
        elif line.startswith("creg") or line.startswith("measure"):
            continue
        else:
            parts = line.split()
            if parts:
                gate_name = parts[0].split("(")[0].upper()
                # Parse qubit indices
                qubits_str = line.split(")")[1] if ")" in line else " ".join(parts[1:])
                qidxs = []
                for seg in qubits_str.replace(",", " ").split():
                    if "[" in seg and "]" in seg:
                        try:
                            qidxs.append(int(seg.split("[")[1].split("]")[0]))
                        except Exception:
                            pass
                if qidxs:
                    gates.append({"name": gate_name, "qubits": qidxs})

    n_qubits = max(n_qubits, (max((max(g["qubits"]) for g in gates), default=0) + 1) if gates else 1)

    PAD = 50
    Q_SPACING = max(40, (H - 2 * PAD) // max(n_qubits, 1))
    G_WIDTH = 36
    G_SPACING = 48
    total_cols = max(len(gates), 1)
    draw_W = max(W, PAD * 2 + total_cols * G_SPACING + G_WIDTH)

    svg_parts = []
    # Qubit lines
    for q in range(n_qubits):
        y = PAD + q * Q_SPACING
        svg_parts.append(_line(PAD - 10, y, draw_W - PAD, y, stroke=th["line_color"], sw=1.0))
        svg_parts.append(_text(PAD - 15, y + 4, f"q{q}", anchor="end", color=th["axis_color"]))

    # Gates
    col = 0
    gate_x_map: Dict[int, int] = {}  # qubit → last used column
    placed: List[tuple] = []  # (col, gate)
    for g in gates:
        col_for_gate = max((gate_x_map.get(q, -1) + 1 for q in g["qubits"]), default=0)
        placed.append((col_for_gate, g))
        for q in g["qubits"]:
            gate_x_map[q] = col_for_gate

    for col_idx, g in placed:
        x = PAD + col_idx * G_SPACING
        if len(g["qubits"]) == 1:
            q = g["qubits"][0]
            y = PAD + q * Q_SPACING
            svg_parts.append(_rect(x, y - 14, G_WIDTH, 28, fill="#ddeeff", stroke=th["line_color"], sw=1.0))
            svg_parts.append(_text(x + G_WIDTH / 2, y + 4, g["name"][:3], size=8, color=th["line_color"]))
        elif len(g["qubits"]) >= 2:
            q0, q1 = g["qubits"][0], g["qubits"][1]
            y0 = PAD + q0 * Q_SPACING
            y1 = PAD + q1 * Q_SPACING
            svg_parts.append(_line(x + G_WIDTH / 2, y0, x + G_WIDTH / 2, y1, stroke=th["line_color"]))
            svg_parts.append(_circle(x + G_WIDTH / 2, y0, 5, fill=th["line_color"]))
            # CNOT target
            svg_parts.append(_circle(x + G_WIDTH / 2, y1, 12, fill="none", stroke=th["line_color"], sw=1.5))
            svg_parts.append(_line(x + G_WIDTH / 2 - 12, y1, x + G_WIDTH / 2 + 12, y1, stroke=th["line_color"]))
            svg_parts.append(_line(x + G_WIDTH / 2, y1 - 12, x + G_WIDTH / 2, y1 + 12, stroke=th["line_color"]))

    if title:
        svg_parts.append(_text(draw_W / 2, 15, title, bold=True, size=th["font_size"] + 1, color=th["line_color"]))

    return _svg_wrap("".join(svg_parts), draw_W, H, th)


def _energy_landscape(data: Dict, style: str, title: str, xlabel: str, ylabel: str, W: int, H: int) -> str:
    th = _theme(style)
    grid = data.get("grid", [[]])  # 2D list of floats
    if not grid or not grid[0]:
        grid = [[math.sin(i * 0.3 + j * 0.5) for j in range(10)] for i in range(10)]

    PAD = 40
    rows = len(grid)
    cols = len(grid[0]) if grid else 1
    cell_w = (W - 2 * PAD) / max(cols, 1)
    cell_h = (H - 2 * PAD) / max(rows, 1)

    flat = [v for row in grid for v in row]
    lo, hi = min(flat), max(flat)

    svg_parts = []
    for r, row in enumerate(grid):
        for c, val in enumerate(row):
            color = _color_scale(val, lo, hi)
            svg_parts.append(_rect(
                PAD + c * cell_w, PAD + r * cell_h,
                cell_w + 0.5, cell_h + 0.5, fill=color, stroke="none"
            ))

    svg_parts.append(_title_block(title, xlabel, ylabel, W, H, PAD, th))
    # Colorbar labels
    svg_parts.append(_text(PAD, H - PAD + 12, f"{lo:.2f}", anchor="start", size=8, color=th["axis_color"]))
    svg_parts.append(_text(W - PAD, H - PAD + 12, f"{hi:.2f}", anchor="end", size=8, color=th["axis_color"]))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _probability_histogram(data: Dict, style: str, title: str, xlabel: str, ylabel: str, W: int, H: int) -> str:
    th = _theme(style)
    dist = data.get("distribution", {})
    if not dist:
        dist = {"00": 0.45, "01": 0.05, "10": 0.05, "11": 0.45}

    items = sorted(dist.items())
    n = len(items)
    PAD_L, PAD_R, PAD_T, PAD_B = 45, 15, 30, 40
    bar_area_W = W - PAD_L - PAD_R
    bar_area_H = H - PAD_T - PAD_B
    bar_w = bar_area_W / n * 0.7
    bar_gap = bar_area_W / n

    max_val = max(v for _, v in items) or 1.0
    color = th["palette"][0]

    svg_parts = []
    # Axes
    svg_parts.append(_line(PAD_L, PAD_T, PAD_L, H - PAD_B, stroke=th["axis_color"]))
    svg_parts.append(_line(PAD_L, H - PAD_B, W - PAD_R, H - PAD_B, stroke=th["axis_color"]))

    for i, (label, val) in enumerate(items):
        bar_h = (val / max_val) * bar_area_H
        x = PAD_L + i * bar_gap + (bar_gap - bar_w) / 2
        y = H - PAD_B - bar_h
        svg_parts.append(_rect(x, y, bar_w, bar_h, fill=color, stroke="none", rx=1))
        svg_parts.append(_text(x + bar_w / 2, H - PAD_B + 12, label, size=8, color=th["axis_color"]))
        svg_parts.append(_text(x + bar_w / 2, y - 3, f"{val:.3f}", size=7, color=th["line_color"]))

    # Y-axis ticks
    for tick in [0.0, 0.25, 0.5, 0.75, 1.0]:
        ty = H - PAD_B - tick * bar_area_H
        svg_parts.append(_line(PAD_L - 4, ty, PAD_L, ty, stroke=th["axis_color"]))
        svg_parts.append(_text(PAD_L - 6, ty + 3, f"{tick * max_val:.2f}", anchor="end", size=7, color=th["axis_color"]))

    svg_parts.append(_title_block(title, xlabel or "State", ylabel or "Probability", W, H, 40, th))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _convergence_plot(data: Dict, style: str, title: str, xlabel: str, ylabel: str, W: int, H: int) -> str:
    th = _theme(style)
    curves = data.get("curves", [{"label": "loss", "values": [0.7 - i * 0.01 for i in range(50)]}])

    PAD_L, PAD_R, PAD_T, PAD_B = 50, 120, 30, 40
    plot_W = W - PAD_L - PAD_R
    plot_H = H - PAD_T - PAD_B

    all_vals = [v for c in curves for v in c.get("values", [])]
    lo = min(all_vals) if all_vals else 0.0
    hi = max(all_vals) if all_vals else 1.0
    if hi == lo:
        hi = lo + 1.0

    svg_parts = []
    # Grid lines
    for tick in [0.0, 0.25, 0.5, 0.75, 1.0]:
        ty = PAD_T + plot_H - tick * plot_H
        svg_parts.append(_line(PAD_L, ty, PAD_L + plot_W, ty, stroke=th["grid_color"], sw=0.5))
        val = lo + tick * (hi - lo)
        svg_parts.append(_text(PAD_L - 5, ty + 3, f"{val:.2f}", anchor="end", size=8, color=th["axis_color"]))

    # Axes
    svg_parts.append(_line(PAD_L, PAD_T, PAD_L, PAD_T + plot_H, stroke=th["axis_color"]))
    svg_parts.append(_line(PAD_L, PAD_T + plot_H, PAD_L + plot_W, PAD_T + plot_H, stroke=th["axis_color"]))

    for ci, curve in enumerate(curves):
        values = curve.get("values", [])
        label = curve.get("label", f"curve{ci}")
        color = th["palette"][ci % len(th["palette"])]
        if not values:
            continue
        n = len(values)
        pts = []
        for i, v in enumerate(values):
            px = PAD_L + (i / max(n - 1, 1)) * plot_W
            py = PAD_T + plot_H - ((v - lo) / (hi - lo)) * plot_H
            pts.append((px, py))
        svg_parts.append(_polyline(pts, stroke=color, sw=float(th["line_width"])))
        # Legend
        leg_y = PAD_T + ci * 18
        svg_parts.append(_line(W - PAD_R + 5, leg_y, W - PAD_R + 25, leg_y, stroke=color, sw=2.0))
        svg_parts.append(_text(W - PAD_R + 28, leg_y + 4, label, anchor="start", size=8, color=th["line_color"]))

    # X-axis ticks
    n_max = max((len(c.get("values", [])) for c in curves), default=1)
    for tick_i in range(0, n_max, max(1, n_max // 5)):
        tx = PAD_L + (tick_i / max(n_max - 1, 1)) * plot_W
        svg_parts.append(_text(tx, PAD_T + plot_H + 14, str(tick_i), size=8, color=th["axis_color"]))

    svg_parts.append(_title_block(title, xlabel or "Epoch", ylabel or "Value", W, H, 40, th))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _bloch_sphere(data: Dict, style: str, title: str, W: int, H: int) -> str:
    th = _theme(style)
    bx = float(data.get("x", 0.0))
    by = float(data.get("y", 0.0))
    bz = float(data.get("z", 1.0))

    cx, cy = W / 2, H / 2
    R = min(W, H) / 2 - 30
    svg_parts = []

    # Sphere outline
    svg_parts.append(_circle(cx, cy, R, fill="none", stroke=th["axis_color"], sw=1.5))

    # Equator (ellipse approximation)
    svg_parts.append(
        f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{R:.1f}" ry="{R*0.3:.1f}" '
        f'fill="none" stroke="{th["grid_color"]}" stroke-width="1" stroke-dasharray="4,3"/>'
    )

    # Axes: Z (up), X (right), Y (out)
    svg_parts.append(_line(cx, cy - R - 10, cx, cy + R + 10, stroke=th["axis_color"], sw=0.8))
    svg_parts.append(_line(cx - R - 10, cy, cx + R + 10, cy, stroke=th["axis_color"], sw=0.8))
    svg_parts.append(_text(cx, cy - R - 15, "|0⟩", size=10, color=th["line_color"]))
    svg_parts.append(_text(cx, cy + R + 22, "|1⟩", size=10, color=th["line_color"]))
    svg_parts.append(_text(cx + R + 14, cy + 4, "x", size=10, color=th["line_color"]))

    # Bloch vector — project to 2D: screen_x = cx + R*bx, screen_y = cy - R*bz
    vx = cx + R * bx * 0.7   # foreshortening for perspective
    vy = cy - R * bz
    svg_parts.append(_line(cx, cy, vx, vy, stroke=th["palette"][0], sw=2.5))
    svg_parts.append(_circle(vx, vy, 5, fill=th["palette"][0], stroke=th["palette"][0]))

    # Labels
    mag = math.sqrt(bx**2 + by**2 + bz**2)
    svg_parts.append(_text(cx, H - 10, f"⟨x⟩={bx:.2f}  ⟨y⟩={by:.2f}  ⟨z⟩={bz:.2f}  |r|={mag:.3f}",
                           size=8, color=th["axis_color"]))
    if title:
        svg_parts.append(_text(cx, 16, title, bold=True, size=th["font_size"] + 1, color=th["line_color"]))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _density_matrix_heatmap(data: Dict, style: str, title: str, W: int, H: int) -> str:
    th = _theme(style)
    matrix = data.get("matrix_re", [[1.0, 0.0], [0.0, 0.0]])
    if not matrix:
        matrix = [[1.0]]
    n = len(matrix)

    PAD = 45
    cell = (min(W, H) - 2 * PAD) / n

    flat = [v for row in matrix for v in row]
    lo, hi = min(flat), max(flat)

    svg_parts = []
    for r in range(n):
        for c in range(len(matrix[r])):
            val = matrix[r][c]
            color = _color_scale(val, lo, hi)
            x = PAD + c * cell
            y = PAD + r * cell
            svg_parts.append(_rect(x, y, cell - 1, cell - 1, fill=color, stroke="none", rx=0))
            if cell > 22:
                svg_parts.append(_text(x + cell / 2, y + cell / 2 + 4, f"{val:.2f}",
                                       size=max(6, int(cell / 5)), color="#333"))

    # Row/col labels
    for i in range(n):
        label = format(i, f"0{max(1, math.ceil(math.log2(n+1)))}b") if n > 1 else "0"
        svg_parts.append(_text(PAD + i * cell + cell / 2, PAD - 4, label, size=7, color=th["axis_color"]))
        svg_parts.append(_text(PAD - 4, PAD + i * cell + cell / 2 + 3, label, anchor="end", size=7, color=th["axis_color"]))

    if title:
        svg_parts.append(_text(W / 2, 16, title, bold=True, size=th["font_size"] + 1, color=th["line_color"]))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _entanglement_graph(data: Dict, style: str, title: str, W: int, H: int) -> str:
    th = _theme(style)
    edges = data.get("edges", [])   # list of {i, j, weight}
    n_nodes = data.get("n_nodes", 4)

    # Layout: circle
    cx, cy = W / 2, H / 2
    R = min(W, H) / 2 - 50
    angles = [2 * math.pi * i / n_nodes for i in range(n_nodes)]
    node_pos = [(cx + R * math.cos(a - math.pi / 2), cy + R * math.sin(a - math.pi / 2)) for a in angles]

    svg_parts = []
    # Edges
    for edge in edges:
        i, j = int(edge.get("i", 0)), int(edge.get("j", 1))
        w = float(edge.get("weight", 1.0))
        if i < n_nodes and j < n_nodes:
            sw = max(0.5, w * 4)
            opacity = max(0.1, min(1.0, abs(w)))
            svg_parts.append(
                f'<line x1="{node_pos[i][0]:.1f}" y1="{node_pos[i][1]:.1f}" '
                f'x2="{node_pos[j][0]:.1f}" y2="{node_pos[j][1]:.1f}" '
                f'stroke="{th["palette"][0]}" stroke-width="{sw:.1f}" opacity="{opacity:.2f}"/>'
            )

    # Nodes
    for ni, (nx, ny) in enumerate(node_pos):
        svg_parts.append(_circle(nx, ny, 18, fill=th["palette"][1], stroke=th["line_color"], sw=1.5))
        svg_parts.append(_text(nx, ny + 4, f"q{ni}", size=9, color="#fff"))

    if title:
        svg_parts.append(_text(cx, 16, title, bold=True, size=th["font_size"] + 1, color=th["line_color"]))
    return _svg_wrap("".join(svg_parts), W, H, th)


def _decay_curve(data: Dict, style: str, title: str, xlabel: str, ylabel: str, W: int, H: int) -> str:
    th = _theme(style)
    times = data.get("times", list(range(20)))
    values = data.get("values", [math.exp(-0.1 * t) for t in range(20)])
    fit = data.get("fit", [])

    PAD_L, PAD_R, PAD_T, PAD_B = 50, 20, 30, 40
    plot_W = W - PAD_L - PAD_R
    plot_H = H - PAD_T - PAD_B

    t_lo, t_hi = min(times), max(times)
    v_lo, v_hi = 0.0, max(values) if values else 1.0
    if t_hi == t_lo:
        t_hi = t_lo + 1
    if v_hi == v_lo:
        v_hi = v_lo + 1

    def px(t: float) -> float:
        return PAD_L + (t - t_lo) / (t_hi - t_lo) * plot_W

    def py(v: float) -> float:
        return PAD_T + plot_H - (v - v_lo) / (v_hi - v_lo) * plot_H

    svg_parts = []
    # Grid
    for tick in [0.0, 0.25, 0.5, 0.75, 1.0]:
        ty = PAD_T + plot_H - tick * plot_H
        svg_parts.append(_line(PAD_L, ty, PAD_L + plot_W, ty, stroke=th["grid_color"], sw=0.5))
        svg_parts.append(_text(PAD_L - 5, ty + 3, f"{(v_lo + tick*(v_hi-v_lo)):.2f}",
                               anchor="end", size=8, color=th["axis_color"]))

    # Axes
    svg_parts.append(_line(PAD_L, PAD_T, PAD_L, PAD_T + plot_H, stroke=th["axis_color"]))
    svg_parts.append(_line(PAD_L, PAD_T + plot_H, PAD_L + plot_W, PAD_T + plot_H, stroke=th["axis_color"]))

    # Data points
    for t, v in zip(times, values):
        svg_parts.append(_circle(px(t), py(v), 3, fill=th["palette"][0], stroke="none"))

    # Fit line
    if fit and len(fit) == len(times):
        pts = [(px(t), py(v)) for t, v in zip(times, fit)]
        svg_parts.append(_polyline(pts, stroke=th["palette"][1], sw=1.5))

    svg_parts.append(_title_block(title, xlabel or "Time (µs)", ylabel or "Signal", W, H, 40, th))
    return _svg_wrap("".join(svg_parts), W, H, th)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def _generate_svg(req: FigureRequest, W: int, H: int) -> str:
    ft = req.figure_type
    d, s, t, xl, yl = req.data, req.style, req.title, req.xlabel, req.ylabel
    if ft == "circuit_diagram":
        return _circuit_diagram(d, s, t, W, H)
    elif ft == "energy_landscape":
        return _energy_landscape(d, s, t, xl, yl, W, H)
    elif ft == "probability_histogram":
        return _probability_histogram(d, s, t, xl, yl, W, H)
    elif ft == "convergence_plot":
        return _convergence_plot(d, s, t, xl, yl, W, H)
    elif ft == "bloch_sphere":
        return _bloch_sphere(d, s, t, W, H)
    elif ft == "density_matrix_heatmap":
        return _density_matrix_heatmap(d, s, t, W, H)
    elif ft == "entanglement_graph":
        return _entanglement_graph(d, s, t, W, H)
    elif ft == "decay_curve":
        return _decay_curve(d, s, t, xl, yl, W, H)
    else:
        th = _theme(s)
        return _svg_wrap(
            _text(W / 2, H / 2, f"Unknown figure type: {ft}", color=th["line_color"]),
            W, H, th
        )


def _latex_caption(figure_type: str, title: str, style: str) -> str:
    base = title if title else figure_type.replace("_", " ").title()
    return f"\\caption{{\\textbf{{{base}}}. Generated by Q-Lab figure engine (style: {style}).)}} \\label{{fig:{figure_type}}}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("")
def generate_figure(req: FigureRequest) -> Dict[str, Any]:
    # Dimensions by figure type
    dims = {
        "circuit_diagram":        (700, 300),
        "energy_landscape":       (500, 420),
        "probability_histogram":  (520, 380),
        "convergence_plot":       (600, 380),
        "bloch_sphere":           (380, 400),
        "density_matrix_heatmap": (450, 450),
        "entanglement_graph":     (420, 420),
        "decay_curve":            (560, 360),
    }
    W, H = dims.get(req.figure_type, (500, 400))

    svg = _generate_svg(req, W, H)
    label = req.figure_type.replace("_", "-")
    caption = _latex_caption(req.figure_type, req.title, req.style)

    return {
        "figure_id": str(uuid.uuid4()),
        "figure_type": req.figure_type,
        "style": req.style,
        "format": "svg",
        "svg_content": svg,
        "width_px": W,
        "height_px": H,
        "latex_caption": caption,
        "latex_label": f"fig:{label}",
        "bibtex_placeholder": "@misc{qlab_figure, title={Q-Lab Figure}, author={Q-Lab}, year={2025}}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/types")
def list_figure_types() -> Dict[str, Any]:
    return {
        "figure_types": [
            {
                "name": "circuit_diagram",
                "description": "Quantum circuit schematic from QASM string",
                "example_data": {"qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];'},
            },
            {
                "name": "energy_landscape",
                "description": "2D colour-map of an energy surface",
                "example_data": {"grid": [[math.sin(i * 0.4 + j * 0.3) for j in range(8)] for i in range(8)]},
            },
            {
                "name": "probability_histogram",
                "description": "Bitstring probability bar chart",
                "example_data": {"distribution": {"00": 0.48, "01": 0.02, "10": 0.02, "11": 0.48}},
            },
            {
                "name": "convergence_plot",
                "description": "Multi-curve line plot (loss/accuracy over epochs)",
                "example_data": {"curves": [
                    {"label": "train_loss", "values": [round(0.7 * math.exp(-i * 0.05), 4) for i in range(40)]},
                    {"label": "val_loss",   "values": [round(0.75 * math.exp(-i * 0.04), 4) for i in range(40)]},
                ]},
            },
            {
                "name": "bloch_sphere",
                "description": "Single-qubit Bloch sphere with state vector",
                "example_data": {"x": 0.0, "y": 0.0, "z": 1.0},
            },
            {
                "name": "density_matrix_heatmap",
                "description": "Density matrix real part as colour grid",
                "example_data": {"matrix_re": [[0.5, 0.5], [0.5, 0.5]]},
            },
            {
                "name": "entanglement_graph",
                "description": "Graph of qubit-qubit entanglement weights",
                "example_data": {"n_nodes": 4, "edges": [{"i": 0, "j": 1, "weight": 0.9}, {"i": 1, "j": 2, "weight": 0.4}]},
            },
            {
                "name": "decay_curve",
                "description": "T1/T2 decay curve with optional exponential fit",
                "example_data": {
                    "times": list(range(20)),
                    "values": [round(math.exp(-0.12 * t), 4) for t in range(20)],
                    "fit": [round(math.exp(-0.11 * t), 4) for t in range(20)],
                },
            },
        ],
        "styles": list(_STYLE_THEMES.keys()),
    }
