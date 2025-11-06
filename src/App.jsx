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
  const exprInputRef = useRef(null);
  const [lockTangent, setLockTangent] = useState(false);
  const [tangentX, setTangentX] = useState("0");
  const [step, setStep] = useState(0.1);
  const [xMin, setXMin] = useState(-10);
  const [xMax, setXMax] = useState(10);
  const [samples, setSamples] = useState(800);
  const [showDerivative, setShowDerivative] = useState(true);
  const [showTangent, setShowTangent] = useState(true);
  const [error, setError] = useState("");
  const [hoverX, setHoverX] = useState(null);
  const canvasRef = useRef(null);

const [pw, setPw] = useState([
  { cond: "x<0", expr: "-x" },
  { cond: "", expr: "x^2" },
]);

function buildPiecewise(rows) {
  const parts = rows.filter(r => r.expr.trim() !== "");
  if (parts.length === 0) return;
  let s = "";
  for (let i=0;i<parts.length;i++) {
    const {cond,expr} = parts[i];
    if (i < parts.length-1 && cond.trim()) {
      s += `(${cond})?(${expr}):`;
    } else {
      s += `(${expr})`;
    }
  }
  setExpr(s);
}

  const f = useMemo(() => compileExpression(expr), [expr]);
  const df = useMemo(() => compileDerivative(expr), [expr]);

  function insertSnippet(before, after = "", cursorDelta = 0) {
  const el = exprInputRef.current;
  const start = el?.selectionStart ?? expr.length;
  const end = el?.selectionEnd ?? expr.length;
  const sel = expr.slice(start, end);
  const next = expr.slice(0, start) + before + sel + after + expr.slice(end);
  setExpr(next);
  requestAnimationFrame(() => {
    const pos = start + before.length + (sel ? sel.length : 0) + cursorDelta;
    if (el) el.setSelectionRange(pos, pos);
  });
}
function insertCall(name) { insertSnippet(`${name}(`, `)`); }

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
  ctx.lineWidth = 2; ctx.strokeStyle = color;

  const N = samples;
  const xs = linspace(xMin_, xMax_, N);

  const JUMP_ABS = 0.75;  // atlama algısı (mutlak)
  const JUMP_REL = 0.4;   // atlama algısı (göreli)

  ctx.beginPath();
  let started = false;
  let lastY = null;

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = fun(x);

    if (!Number.isFinite(y)) {
      // tanımsızsa path’i kopar
      started = false;
      continue;
    }

    const [sx, sy] = worldToScreen(x, y, W, panelH, xMin_, xMax_, yMin_, yMax_);

    // önceki noktaya göre atlama var mı?
    if (started && Number.isFinite(lastY)) {
      const absJump = Math.abs(y - lastY);
      const relJump = absJump / Math.max(1e-9, Math.max(Math.abs(y), Math.abs(lastY)));
      if (absJump > JUMP_ABS && relJump > JUMP_REL) {
        // path’i KES – yeni segment başlat
        ctx.stroke();
        ctx.beginPath();
        started = false;
      }
    }

    if (!started) {
      ctx.moveTo(sx, sy);
      started = true;
    } else {
      ctx.lineTo(sx, sy);
    }
    lastY = y;
  }

  ctx.stroke();
  ctx.restore();
}

    function evalScalar(exprStr) {
  try {
    if (typeof exprStr !== "string") return Number(exprStr);
    const node = math.parse(exprStr.replaceAll("π","pi"));
    const v = node.evaluate();
    return Number(v);
  } catch { return NaN; }
}

    function drawTangentAt() {
  if (!showTangent || !df) return;

  // İKİ MOD: kilitliyse x0, değilse hover
  const xCandidate = lockTangent ? evalScalar(tangentX) : hoverX;
  if (xCandidate == null || Number.isNaN(xCandidate)) return;

  const x = clamp(xCandidate, xMin, xMax);
  const y = f(x);
  const m = df(x);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return;

  const xA = xMin, xB = xMax;
  const yA = m * (xA - x) + y, yB = m * (xB - x) + y;

  const [sx] = worldToScreen(x, 0, W, panelH, xMin, xMax, yRange[0], yRange[1]);
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
function drawDerivativeWithHoles() {
  if (!df || !showDerivative) return;

  const xs = linspace(xMin, xMax, Math.min(samples, 500));
  const H = (xMax - xMin) / (xs.length - 1);

  const CONT_ABS = 0.6;
  const CONT_REL = 0.35;
  const SLOPE_ABS = 0.6;
  const SLOPE_REL = 0.35;

  ctx.save();
  ctx.translate(0, panelH + 12);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#10b981";

  ctx.beginPath();
  let started = false;

  for (let i = 1; i < xs.length - 1; i++) {
    const x = xs[i];
    const h = Math.max(1e-6, 0.5 * H);

    const ym = f(x - h);
    const yp = f(x + h);

    const contAbs = Math.abs(yp - ym);
    const contRel = contAbs / Math.max(1e-9, Math.max(Math.abs(yp), Math.abs(ym)));
    const jumpHere = !(Number.isFinite(ym) && Number.isFinite(yp)) ||
                     (contAbs > CONT_ABS && contRel > CONT_REL);

    const y = df(x);
    const [sx, sy] = Number.isFinite(y)
      ? worldToScreen(x, y, W, panelH, xMin, xMax, dRange[0], dRange[1])
      : [null, null];

    if (!Number.isFinite(y) || jumpHere) {
      started = false;
    } else {
      const left  = (f(x) - f(x - h)) / h;
      const right = (f(x + h) - f(x)) / h;
      const slopeAbs = Math.abs(left - right);
      const slopeRel = slopeAbs / Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)));
      const cornerHere = (slopeAbs > SLOPE_ABS && slopeRel > SLOPE_REL);

      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }

      if (cornerHere) {
        const drawHole = (yy) => {
          if (!Number.isFinite(yy)) return;
          const [hx, hy] = worldToScreen(x, yy, W, panelH, xMin, xMax, dRange[0], dRange[1]);
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ef4444";
          ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = "#10b981";
        };
        drawHole(left);
        drawHole(right);
        ctx.stroke();
        ctx.beginPath();
        started = false;
      }
    }
  }

  ctx.stroke();
  ctx.restore();
}


    // Üst panel
    drawAxes(xMin, xMax, yRange[0], yRange[1], 0);
    drawCurve(f, "#2563eb", xMin, xMax, yRange[0], yRange[1], 0);
    drawTangentAt();
    // Alt panel
  drawAxes(xMin, xMax, dRange[0], dRange[1], panelH + 12);
drawDerivativeWithHoles();


    // Tanımsız noktaları işaretle
// Tanımsız noktaları işaretle (köşe / kesiklik)
if (f && showDerivative) {
  const xs = linspace(xMin, xMax, Math.min(samples, 400));
  ctx.save();
  ctx.translate(0, panelH + 12);

  // eşi̇kler: hem mutlak hem göreli kıyas
  const ABS_TOL = 0.3;
  const REL_TOL = 0.3;

  for (let i = 0; i < xs.length - 1; i++) {
    // iki noktanın tam ortası: köşe araya düşse bile yakalanır
    const xm = 0.5 * (xs[i] + xs[i + 1]);
    const h  = 0.5 * (xs[i + 1] - xs[i]);

    // soldan/sağdan sayısal türev
    const left  = (f(xm) - f(xm - h)) / h;
    const right = (f(xm + h) - f(xm)) / h;

    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;

    const absDiff = Math.abs(left - right);
    const rel     = absDiff / Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)));

    // kesiklik testi (f'yi değil f'yi kontrol): zıplama varsa ayrıca işaretle
    const jump = Math.abs(f(xm + h) - f(xm - h));

    // türev tanımsız: köşe veya çok keskin kırılma
    if ((absDiff > ABS_TOL && rel > REL_TOL) || jump > 0.05 * (dRange[1] - dRange[0])) {
      // gösterimde y değeri: sağ ve sol türevin ortalaması (grafikte yer bulsun)
      const yMark = 0.5 * (left + right);
      if (Number.isFinite(yMark)) {
        const [sx, sy] = worldToScreen(xm, yMark, W, panelH, xMin, xMax, dRange[0], dRange[1]);
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}


  }, [expr, f, df, xMin, xMax, yRange, dRange, hoverX, samples, showDerivative, showTangent, lockTangent, tangentX]);


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

  const box = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", padding: 16 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 28, margin: 0, fontWeight: 800 }}>Türevli Fonksiyon Görselleştirici</h1>
            <p style={{ margin: "6px 0", opacity: 0.8 }}>Üst panel: f(x) • Alt panel: f'(x) • Üst panelde imleç teğeti</p>
          </div>
          </header>

        <section style={box}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>f(x)</label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginTop:6 }}>
            <input
  ref={exprInputRef}
  value={expr}
  onChange={(e)=>setExpr(e.target.value)}
  placeholder="ör. sin(x) + x^2/5"
  style={{ flex:1, minWidth:260, padding:"10px 12px", borderRadius:12, border:"1px solid #cbd5e1", outline:"none" }}
/>

            <label style={{ fontSize:14 }}>
              <input type="checkbox" checked={showDerivative} onChange={(e)=>setShowDerivative(e.target.checked)} /> türev grafiği
            </label>
          
          </div>
          <label style={{ fontSize:14 }}>
  <input type="checkbox" checked={showTangent} onChange={(e)=>setShowTangent(e.target.checked)} /> teğet
</label>
{showTangent && (
  <div style={{display:"flex", alignItems:"center", gap:8, marginTop:6}}>
    <label style={{fontSize:14}}>
      <input
        type="checkbox"
        checked={lockTangent}
        onChange={(e)=>setLockTangent(e.target.checked)}
      /> teğeti sabitle
    </label>
    {lockTangent && (
      <>
        <span style={{fontSize:14}}>x₀ = </span>
        <input
  type="text"
  value={tangentX}
  onChange={(e)=>setTangentX(e.target.value)}
  style={{width:70, padding:"4px 6px", borderRadius:8, border:"1px solid #cbd5e1"}}
/>

      </>
    )}
  </div>
)}

<div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:8}}>
  <button onClick={()=>insertSnippet("x")}      className="btn">x</button>
  <button onClick={()=>insertSnippet("^")}      className="btn">^</button>
  <button onClick={()=>insertSnippet("^2", "", 0)} className="btn">^2</button>
  <button onClick={()=>insertCall("abs")}       className="btn">abs( )</button>
  <button onClick={()=>insertSnippet("sqrt(",")")} className="btn">√( )</button>
  <button onClick={()=>insertCall("sin")}       className="btn">sin( )</button>
  <button onClick={()=>insertCall("cos")}       className="btn">cos( )</button>
  <button onClick={()=>insertCall("tan")}       className="btn">tan( )</button>
  <button onClick={()=>insertCall("exp")}       className="btn">e^( )</button>
  <button onClick={()=>insertCall("log")}       className="btn">ln( )</button>
  <button onClick={()=>insertSnippet("pi")}     className="btn">π</button>
  <button onClick={()=>insertSnippet("(",")")}  className="btn">( )</button>
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
<div style={{marginTop:10, padding:8, border:"1px dashed #cbd5e1", borderRadius:10}}>
  <div style={{fontSize:12, opacity:0.7, marginBottom:6}}>Parçalı fonksiyon</div>
  {pw.map((r, idx)=>(
    <div key={idx} style={{display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, marginBottom:6}}>
      <input
        placeholder={idx===pw.length-1 ? "else (boş bırak)" : "koşul (ör. x<0)"}
        value={r.cond}
        onChange={e=>{
          const cp=[...pw]; cp[idx]={...cp[idx], cond:e.target.value}; setPw(cp);
        }}
        style={{padding:"6px 8px", border:"1px solid #cbd5e1", borderRadius:8}}
      />
      <input
        placeholder="ifade (ör. -x)"
        value={r.expr}
        onChange={e=>{
          const cp=[...pw]; cp[idx]={...cp[idx], expr:e.target.value}; setPw(cp);
        }}
        style={{padding:"6px 8px", border:"1px solid #cbd5e1", borderRadius:8}}
      />
      <button onClick={()=>{
        const cp=[...pw]; cp.splice(idx,1); setPw(cp.length?cp:[{cond:"",expr:""}]);
      }} className="btn">sil</button>
    </div>
  ))}
  <div style={{display:"flex", gap:8}}>
    <button onClick={()=>setPw([...pw,{cond:"",expr:""}])} className="btn">+ satır</button>
    <button onClick={()=>buildPiecewise(pw)} className="btn">f(x)’e ekle</button>
  </div>
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
