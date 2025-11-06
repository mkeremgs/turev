import React, { useEffect, useMemo, useRef, useState } from "react";
import { create, all } from "mathjs";

const math = create(all, {});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const linspace = (a, b, n) => {
  const step = (b - a) / Math.max(1, n - 1);
  return Array.from({ length: n }, (_, i) => a + i * step);
};

function normalizeExpr(raw) {
  if (!raw || !raw.trim()) return "";
  let s = raw.trim();
  if (s.includes("|") && !s.includes("abs")) {
    const m = s.match(/^\|(.*)\|$/);
    if (m) s = `abs(${m[1]})`;
  }
  return s;
}
function compileExpression(expr) {
  const src = normalizeExpr(expr);
  if (!src) return null;
  try {
    const node = math.parse(src);
    const code = node.compile();
    return (x) => {
      try {
        const v = code.evaluate({ x });
        return Number.isFinite(v) ? v : NaN;
      } catch { return NaN; }
    };
  } catch { return null; }
}
function compileDerivative(expr) {
  const src = normalizeExpr(expr);
  if (!src) return null;
  try {
    const dnode = math.derivative(src, "x");
    const dcode = dnode.compile();
    return (x) => {
      try {
        const v = dcode.evaluate({ x });
        return Number.isFinite(v) ? v : NaN;
      } catch { return NaN; }
    };
  } catch {
    const f = compileExpression(src);
    if (!f) return null;
    return (x) => {
      const h = 1e-5 * Math.max(1, Math.abs(x));
      const y1 = f(x + h), y2 = f(x - h);
      const d = (y1 - y2) / (2 * h);
      return Number.isFinite(d) ? d : NaN;
    };
  }
}
function worldToScreen(x, y, W, H, xMin, xMax, yMin, yMax) {
  const sx = ((x - xMin) / (xMax - xMin)) * W;
  const sy = H - ((y - yMin) / (yMax - yMin)) * H;
  return [sx, sy];
}
function screenToWorld(sx, sy, W, H, xMin, xMax, yMin, yMax) {
  const x = xMin + (sx / W) * (xMax - xMin);
  const y = yMin + ((H - sy) / H) * (yMax - yMin);
  return [x, y];
}
function niceTicks(min, max, target = 8) {
  const span = max - min || 1;
  const step0 = span / target;
  const pow10 = Math.pow(10, Math.floor(Math.log10(step0)));
  let step = step0 / pow10;
  if (step >= 5) step = 5; else if (step >= 2) step = 2; else step = 1;
  step *= pow10;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + 1e-12; v += step) ticks.push(+v.toFixed(12));
  return ticks;
}

export default function App() {
  const [expr, setExpr] = useState("sin(x) + x^2/5");
  const [xMin, setXMin] = useState(-10);
  const [xMax, setXMax] = useState(10);
  const [samples, setSamples] = useState(800);
  const [showDerivative, setShowDerivative] = useState(true);
  const [showTangent, setShowTangent] = useState(true);
  const [error, setError] = useState("");
  const [hoverX, setHoverX] = useState(null);
  const canvasRef = useRef(null);

  const f = useMemo(() => compileExpression(expr), [expr]);
  const df = useMemo(() => compileDerivative(expr), [expr]);

  const [yRange, setYRange] = useState([-5, 5]);
  useEffect(() => {
    if (!f) { setError("İfade yorumlanamadı. math.js sözdizimi kullan."); return; }
    setError("");
    const xs = linspace(xMin, xMax, Math.min(samples, 400));
    let ymin = Infinity, ymax = -Infinity;
    for (const x of xs) {
      const y = f(x);
      if (!Number.isFinite(y)) continue;
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) { ymin = -1; ymax = 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const pad = (ymax - ymin) * 0.1 + 1e-9;
    setYRange([ymin - pad, ymax + pad]);
  }, [expr, f, xMin, xMax, samples]);

  const [dRange, setDRange] = useState([-5, 5]);
  useEffect(() => {
    if (!df) return;
    const xs = linspace(xMin, xMax, Math.min(samples, 400));
    let ymin = Infinity, ymax = -Infinity;
    for (const x of xs) {
      const y = df(x);
      if (!Number.isFinite(y)) continue;
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) { ymin = -1; ymax = 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const pad = (ymax - ymin) * 0.1 + 1e-9;
    setDRange([ymin - pad, ymax + pad]);
  }, [expr, df, xMin, xMax, samples]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !f) return;
    const ctx = canvas.getContext("2d");

    const DPR = window.devicePixelRatio || 1;
    const Wcss = canvas.clientWidth, Hcss = canvas.clientHeight;
    canvas.width = Math.floor(Wcss * DPR);
    canvas.height = Math.floor(Hcss * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const W = Wcss, H = Hcss;
    const gap = 12, panelH = (H - gap) / 2;

    function drawAxes(xMin_, xMax_, yMin_, yMax_, yOffset) {
      ctx.save(); ctx.translate(0, yOffset);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, panelH);

      const xt = niceTicks(xMin_, xMax_);
      const yt = niceTicks(yMin_, yMax_);
      ctx.strokeStyle = "#e5e7eb";
      for (const x of xt) {
        const [sx] = worldToScreen(x, 0, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, panelH); ctx.stroke();
      }
      for (const y of yt) {
        const [, sy] = worldToScreen(0, y, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }

      ctx.strokeStyle = "#94a3b8";
      if (yMin_ < 0 && yMax_ > 0) {
        const [, sy] = worldToScreen(0, 0, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      }
      if (xMin_ < 0 && xMax_ > 0) {
        const [sx] = worldToScreen(0, 0, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, panelH); ctx.stroke();
      }

      ctx.fillStyle = "#64748b"; ctx.font = "12px system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (const x of xt) {
        const [sx] = worldToScreen(x, 0, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.fillText(String(x), sx, 2);
      }
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (const y of yt) {
        const [, sy] = worldToScreen(0, y, W, panelH, xMin_, xMax_, yMin_, yMax_);
        ctx.fillText(String(y), W - 4, sy);
      }
      ctx.restore();
    }
    function drawCurve(fun, color, xMin_, xMax_, yMin_, yMax_, yOffset) {
      ctx.save(); ctx.translate(0, yOffset);
      ctx.beginPath(); let started = false; const N = samples;
      for (let i = 0; i < N; i++) {
        const x = xMin_ + (i / (N - 1)) * (xMax_ - xMin_);
        const y = fun(x); if (!Number.isFinite(y)) { started = false; continue; }
        const [sx, sy] = worldToScreen(x, y, W, panelH, xMin_, xMax_, yMin_, yMax_);
        if (!started) { ctx.moveTo(sx, sy); started = true; } else { ctx.lineTo(sx, sy); }
      }
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); ctx.restore();
    }
    function drawTangentAt() {
      if (!showTangent || hoverX == null || !df) return;
      const x = clamp(hoverX, xMin, xMax); const y = f(x); const m = df(x);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return;
      const xA = xMin, xB = xMax;
      const yA = m * (xA - x) + y, yB = m * (xB - x) + y;

      const [sx] = worldToScreen(x, 0, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      const [, sy0] = worldToScreen(0, 0, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.strokeStyle = "#c7d2fe"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, panelH); ctx.stroke(); ctx.setLineDash([]);

      const [sAx, sAy] = worldToScreen(xA, yA, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      const [sBx, sBy] = worldToScreen(xB, yB, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sAx, sAy); ctx.lineTo(sBx, sBy); ctx.stroke();

      const [sx0, sy] = worldToScreen(x, y, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.fillStyle = "#7c3aed"; ctx.beginPath(); ctx.arc(sx0, sy, 3, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = "#1f2937"; ctx.font = "12px system-ui";
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      const label = `x=${x.toFixed(3)}  f(x)=${y.toFixed(3)}  f'(x)=${m.toFixed(3)}`;
      ctx.fillText(label, Math.min(Math.max(6, sx0 + 6), W - 180), Math.max(14, sy - 6));
    }

    // Üst panel
    drawAxes(xMin, xMax, yRange[0], yRange[1], 0);
    drawCurve(f, "#2563eb", xMin, xMax, yRange[0], yRange[1], 0);
    drawTangentAt();
    // Alt panel
    drawAxes(xMin, xMax, dRange[0], dRange[1], panelH + 12);
    if (df && showDerivative) drawCurve(df, "#10b981", xMin, xMax, dRange[0], dRange[1], panelH + 12);
  }, [expr, f, df, xMin, xMax, yRange, dRange, hoverX, samples, showDerivative, showTangent]);

  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const H = el.clientHeight, panelH = (H - 12) / 2;
      if (sy >= 0 && sy <= panelH) {
        const [x] = screenToWorld(sx, sy, el.clientWidth, panelH, xMin, xMax, yRange[0], yRange[1]);
        setHoverX(x);
      } else setHoverX(null);
    };
    const onLeave = () => setHoverX(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => { el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave); };
  }, [xMin, xMax, yRange]);

  const presets = [
    { name: "sin(x) + x^2/5", expr: "sin(x) + x^2/5" },
    { name: "e^(-x^2)", expr: "exp(-x^2)" },
    { name: "x^3 - 3x", expr: "x^3 - 3*x" },
    { name: "ln(x)", expr: "log(x)" },
    { name: "|x|", expr: "abs(x)" },
    { name: "parça tanım", expr: "x<0?-x:x^2" },
  ];

  const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", padding: 16 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 28, margin: 0, fontWeight: 800 }}>Türevli Fonksiyon Görselleştirici</h1>
            <p style={{ margin: "6px 0", opacity: 0.8 }}>Üst panel: f(x) • Alt panel: f'(x) • Üst panelde imleç teğeti</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {presets.map(p => (
              <button key={p.name} onClick={() => setExpr(p.expr)}
                style={{ padding:"8px 12px", borderRadius:12, border:"1px solid #e5e7eb", background:"#fff", cursor:"pointer" }}>
                {p.name}
              </button>
            ))}
          </div>
        </header>

        <section style={box}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>f(x)</label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginTop:6 }}>
            <input value={expr} onChange={(e)=>setExpr(e.target.value)} placeholder="ör. sin(x) + x^2/5"
              style={{ flex:1, minWidth:260, padding:"10px 12px", borderRadius:12, border:"1px solid #cbd5e1", outline:"none" }} />
            <label style={{ fontSize:14 }}>
              <input type="checkbox" checked={showDerivative} onChange={(e)=>setShowDerivative(e.target.checked)} /> türev grafiği
            </label>
            <label style={{ fontSize:14 }}>
              <input type="checkbox" checked={showTangent} onChange={(e)=>setShowTangent(e.target.checked)} /> teğet
            </label>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:8, marginTop:10 }}>
            <div style={{ ...box, padding:8 }}>
              <div style={{ fontSize:12, opacity:0.7 }}>x min</div>
              <input type="number" value={xMin} onChange={(e)=>setXMin(parseFloat(e.target.value))}
                style={{ width:"100%", padding:6, borderRadius:8, border:"1px solid #cbd5e1" }} />
            </div>
            <div style={{ ...box, padding:8 }}>
              <div style={{ fontSize:12, opacity:0.7 }}>x max</div>
              <input type="number" value={xMax} onChange={(e)=>setXMax(parseFloat(e.target.value))}
                style={{ width:"100%", padding:6, borderRadius:8, border:"1px solid #cbd5e1" }} />
            </div>
            <div style={{ ...box, padding:8 }}>
              <div style={{ fontSize:12, opacity:0.7 }}>örnek sayısı</div>
              <input type="number" value={samples} onChange={(e)=>setSamples(clamp(parseInt(e.target.value||"0"),100,4000))}
                style={{ width:"100%", padding:6, borderRadius:8, border:"1px solid #cbd5e1" }} />
            </div>
          </div>

          <div style={{ marginTop:10, borderRadius:12, overflow:"hidden", border:"1px solid #e5e7eb", background:"#fff" }}>
            <canvas ref={canvasRef} style={{ width:"100%", height:520, display:"block" }} />
          </div>

          <div style={{ fontSize:12, opacity:0.8, marginTop:8 }}>
            İpuçları: sin, cos, tan, exp, log (doğal log), abs, ^ üstel. Örnek: <code>abs(x)</code>, <code>sin(x)+x^2/5</code>, <code>x&lt;0?-x:x^2</code>.
            <br/>Not: Sembolik türev mümkün değilse sayısal merkez farkı kullanılır; köşe/kesiklikte teğet gizlenir.
          </div>
        </section>
      </div>
    </div>
  );
}
