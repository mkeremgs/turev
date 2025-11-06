import React, { useEffect, useMemo, useRef, useState } from "react";
import { create, all } from "mathjs";

// Isolated math instance
const math = create(all, {});

// ---------- Utils ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const linspace = (a, b, n) => {
  const step = (b - a) / Math.max(1, n - 1);
  return Array.from({ length: n }, (_, i) => a + i * step);
};

function normalizeExpr(raw) {
  if (!raw || !raw.trim()) return "";
  let s = raw.trim();
  // Translate a simple |x| to abs(x)
  if (s.includes("|") && !s.includes("abs")) {
    const m = s.match(/^\|(.*)\|$/);
    if (m) s = `abs(${m[1]})`;
  }
  return s;
}

// Compiles f(x). Returns a function or null.
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
      } catch {
        return NaN;
      }
    };
  } catch {
    return null;
  }
}

// Compiles f'(x). Tries symbolic first, falls back to numeric.
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
      } catch {
        return NaN;
      }
    };
  } catch {
    const f = compileExpression(src);
    if (!f) return null;
    return (x) => {
      const h = 1e-5 * Math.max(1, Math.abs(x));
      const y1 = f(x + h);
      const y2 = f(x - h);
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

// ---------- Self Tests ----------
// NEVER modify existing tests unless clearly wrong. We add more below.
function runSelfTests() {
  const cases = [
    // Existing
    { name: "sin(x) at 0", expr: "sin(x)", x: 0, expect: 0, tol: 1e-10 },
    { name: "(x^2)′ at 3", expr: "x^2", x: 3, dExpect: 6, tol: 1e-6 },
    { name: "exp(-x^2) finite", expr: "exp(-x^2)", x: 2, expectFinite: true },
    // Added — do not change existing above
    { name: "abs kink — derivative undefined at 0", expr: "abs(x)", x: 0, dUndefined: true },
    { name: "log(1) = 0", expr: "log(x)", x: 1, expect: 0, tol: 1e-10 },
    { name: "poly d at -2", expr: "x^3 - 3*x", x: -2, dExpect: 9, tol: 1e-6 },
    { name: "piecewise finite", expr: "x<0?-x:x^2", x: -1, expectFinite: true },
  ];

  return cases.map((c) => {
    const f = compileExpression(c.expr);
    const df = compileDerivative(c.expr);
    let pass = true, note = "";

    if (!f) { pass = false; note = "parse fail"; }
    else if (typeof c.expect === "number") {
      const v = f(c.x);
      pass = Number.isFinite(v) && Math.abs(v - c.expect) <= (c.tol || 1e-6);
      note = `f=${v}`;
    } else if (c.expectFinite) {
      const v = f(c.x); pass = Number.isFinite(v); note = `f=${v}`;
    }

    if (pass && c.dUndefined) {
      const v = df ? df(c.x) : NaN;
      pass = !Number.isFinite(v);
      note += `; f'=${v}`;
    } else if (pass && typeof c.dExpect === "number") {
      const v = df ? df(c.x) : NaN;
      pass = Number.isFinite(v) && Math.abs(v - c.dExpect) <= (c.tol || 1e-6);
      note += `; f'=${v}`;
    }
    return { name: c.name, pass, note };
  });
}

export default function DerivativeGrapher() {
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

  // Compute y-range for f
  const [yRange, setYRange] = useState([-5, 5]);
  useEffect(() => {
    if (!f) {
      setError(
        "İfade yorumlanamadı. math.js sözdizimi kullan: sin(x), cos(x), tan(x), exp(x), log(x), abs(x), ^ (üs). Parça tanım: x<0?-x:x^2"
      );
      return;
    }
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

  // Compute y-range for f'
  const [dRange, setDRange] = useState([-5, 5]);
  useEffect(() => {
    if (!df) return; // If derivative can't be computed, just skip drawing it
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

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !f) return;
    const ctx = canvas.getContext("2d");

    const DPR = window.devicePixelRatio || 1;
    const Wcss = canvas.clientWidth;
    const Hcss = canvas.clientHeight;
    canvas.width = Math.floor(Wcss * DPR);
    canvas.height = Math.floor(Hcss * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const W = Wcss, H = Hcss;
    const gap = 12;
    const panelH = (H - gap) / 2;

    function drawAxes(xMin_, xMax_, yMin_, yMax_, yOffset) {
      ctx.save();
      ctx.translate(0, yOffset);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, panelH);

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

      ctx.fillStyle = "#64748b";
      ctx.font = "12px ui-sans-serif, system-ui";
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
      ctx.save(); ctx.translate(0, yOffset); ctx.beginPath();
      let started = false;
      const N = samples;
      for (let i = 0; i < N; i++) {
        const x = xMin_ + (i / (N - 1)) * (xMax_ - xMin_);
        const y = fun(x);
        if (!Number.isFinite(y)) { started = false; continue; }
        const [sx, sy] = worldToScreen(x, y, W, panelH, xMin_, xMax_, yMin_, yMax_);
        if (!started) { ctx.moveTo(sx, sy); started = true; } else { ctx.lineTo(sx, sy); }
      }
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
      ctx.restore();
    }

    function drawTangentAt() {
      if (!showTangent || hoverX == null || !df) return;
      const x = clamp(hoverX, xMin, xMax);
      const y = f(x);
      const m = df(x);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return;

      const xA = xMin, xB = xMax;
      const yA = m * (xA - x) + y;
      const yB = m * (xB - x) + y;

      // vertical guide & tangent on top panel
      const [sx] = worldToScreen(x, 0, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.strokeStyle = "#c7d2fe"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, panelH); ctx.stroke(); ctx.setLineDash([]);

      const [sAx, sAy] = worldToScreen(xA, yA, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      const [sBx, sBy] = worldToScreen(xB, yB, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.strokeStyle = "#7c3aed"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sAx, sAy); ctx.lineTo(sBx, sBy); ctx.stroke();

      const [sx0, sy0] = worldToScreen(x, y, W, panelH, xMin, xMax, yRange[0], yRange[1]);
      ctx.fillStyle = "#7c3aed"; ctx.beginPath(); ctx.arc(sx0, sy0, 3, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = "#1f2937"; ctx.font = "12px ui-sans-serif, system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      const label = `x=${x.toFixed(3)}  f(x)=${y.toFixed(3)}  f'(x)=${m.toFixed(3)}`;
      ctx.fillText(label, Math.min(Math.max(6, sx0 + 6), W - 156), Math.max(14, sy0 - 6));
    }

    // Top panel: f(x)
    drawAxes(xMin, xMax, yRange[0], yRange[1], 0);
    drawCurve(f, "#2563eb", xMin, xMax, yRange[0], yRange[1], 0);
    drawTangentAt();

    // Bottom panel: f'(x)
    drawAxes(xMin, xMax, dRange[0], dRange[1], panelH + gap);
    if (df && showDerivative) {
      drawCurve(df, "#10b981", xMin, xMax, dRange[0], dRange[1], panelH + gap);
    }
  }, [expr, f, df, xMin, xMax, yRange, dRange, hoverX, samples, showDerivative, showTangent]);

  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left; const sy = e.clientY - rect.top;
      const H = el.clientHeight; const gap = 12; const panelH = (H - gap) / 2;
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

  const tests = useMemo(() => runSelfTests(), []);

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 p-4 md:p-6">
      <div className="max-w-5xl mx-auto grid gap-4">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Türevli Fonksiyon Görselleştirici</h1>
            <p className="text-sm md:text-base text-slate-600">Üst panel: f(x), alt panel: f'(x). İmleçte teğet çizgisi.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button key={p.name} onClick={() => setExpr(p.expr)} className="px-3 py-1.5 rounded-xl bg-white shadow-sm border border-slate-200 hover:bg-slate-100 text-sm">
                {p.name}
              </button>
            ))}
          </div>
        </header>

        <section className="bg-white shadow-sm border border-slate-200 rounded-2xl p-4 grid gap-3">
          <label className="text-sm font-medium">f(x)</label>
          <div className="flex gap-2 flex-wrap items-center">
            <input
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              className="flex-1 min-w-[260px] px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-300"
              placeholder="ör. sin(x) + x^2/5"
            />
            <div className="flex items-center gap-2 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={showDerivative} onChange={(e) => setShowDerivative(e.target.checked)} /> türev grafiği</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showTangent} onChange={(e) => setShowTangent(e.target.checked)} /> teğet</label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <label className="block text-xs text-slate-500">x min</label>
              <input type="number" value={xMin} onChange={(e) => setXMin(parseFloat(e.target.value))} className="mt-1 w-full px-2 py-1 rounded-lg border border-slate-300" />
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <label className="block text-xs text-slate-500">x max</label>
              <input type="number" value={xMax} onChange={(e) => setXMax(parseFloat(e.target.value))} className="mt-1 w-full px-2 py-1 rounded-lg border border-slate-300" />
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <label className="block text-xs text-slate-500">örnek sayısı</label>
              <input type="number" value={samples} onChange={(e) => setSamples(clamp(parseInt(e.target.value || '0'), 100, 4000))} className="mt-1 w-full px-2 py-1 rounded-lg border border-slate-300" />
            </div>
          </div>

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
              {error}
            </div>
          )}

          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
            <canvas ref={canvasRef} className="w-full h-[520px]" />
          </div>

<div className="text-xs text-slate-500 space-y-1">
  <p>
    İpuçları: <code className="bg-slate-100 px-1 rounded">sin</code>,{" "}
    <code className="bg-slate-100 px-1 rounded">cos</code>,{" "}
    <code className="bg-slate-100 px-1 rounded">tan</code>,{" "}
    <code className="bg-slate-100 px-1 rounded">exp</code>,{" "}
    <code className="bg-slate-100 px-1 rounded">log</code> (doğal log),{" "}
    <code className="bg-slate-100 px-1 rounded">abs</code>,{" "}
    <code className="bg-slate-100 px-1 rounded">^</code> üstel. Örnek:{" "}
    <code>abs(x)</code>, <code>sin(x)+x^2/5</code>,{" "}
    <code>x&lt;0?-x:x^2</code>.
  </p>
  <p>
    Not: Türev mümkünse sembolik, değilse sayısal merkez farkı ile.
    Köşe/kesiklik noktalarında teğet gizlenir.
  </p>
</div>

        </section>

        <section className="bg-white shadow-sm border border-slate-200 rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-2">Kendini test (otomatik)</h2>
          <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
            {tests.map(t => (
              <li key={t.name} className={t.pass ? "text-emerald-700" : "text-rose-700"}>
                {t.pass ? "PASS" : "FAIL"} — {t.name} <span className="text-slate-400">({t.note})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
