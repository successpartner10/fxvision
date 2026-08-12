import { formatPrice } from "./analyze.js";

const C = {
  bg: "#0b0e14",
  pane: "#10151e",
  line: "#1c2433",
  grid: "#1a2130",
  muted: "#5d6778",
  text: "#dce4f0",
  up: "#26a69a",
  down: "#ef5350",
  ema20: "#f0b429",
  ema50: "#7aa2ff",
  rsi: "#c084fc",
  buy: "#3dd68c",
  sell: "#ef6b68",
  wait: "#eab308",
};

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function verdictColor(verdict) {
  if (verdict === "BUY") return C.buy;
  if (verdict === "SELL") return C.sell;
  return C.wait;
}

export class Chart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.candles = [];
    this.analysis = null;
    this.messages = null;
    this.meta = { symbol: "BTC/USDT", tf: "4H", asOf: "" };
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
  }

  setMeta(meta) {
    this.meta = { ...this.meta, ...meta };
  }

  setData(candles, analysis, messages) {
    this.candles = candles || [];
    this.analysis = analysis;
    this.messages = messages;
    this.draw();
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(420, Math.floor(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  draw() {
    if (!this.cssW || !this.cssH) return;
    this.render(this.ctx, this.cssW, this.cssH, { header: false });
  }

  overlayMetrics(ctx, width, messages) {
    if (!messages) return { height: 0, lines: null };
    const pad = 14;
    const narrow = width < 520;
    const inner = width - pad * 2;
    const badge = narrow ? 72 : 88;
    const textW = Math.max(140, inner - badge - 28);
    ctx.font = narrow ? "600 13px Segoe UI, system-ui, sans-serif" : "600 15px Segoe UI, system-ui, sans-serif";
    const simple = wrapText(ctx, messages.simple, textW);
    ctx.font = narrow ? "11.5px Segoe UI, system-ui, sans-serif" : "12.5px Segoe UI, system-ui, sans-serif";
    const technical = wrapText(ctx, messages.technical, textW);
    const height = 24 + simple.length * (narrow ? 17 : 20) + 16 + technical.length * (narrow ? 14 : 16) + 14;
    return { height: Math.min(height, narrow ? 188 : 168), simple, technical, textW, badge, narrow };
  }

  render(ctx, W, H, { header = false } = {}) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    let top = 0;
    if (header) {
      top = 46;
      ctx.fillStyle = "#0e121a";
      ctx.fillRect(0, 0, W, top);
      ctx.fillStyle = C.line;
      ctx.fillRect(0, top - 1, W, 1);
      ctx.fillStyle = C.text;
      ctx.font = "700 14px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${this.meta.symbol}  ·  ${this.meta.tf}`, 16, top / 2);
      ctx.fillStyle = C.muted;
      ctx.font = "12px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(this.meta.asOf || "FX Vision", W - 16, top / 2);
    }

    const candles = this.candles;
    const a = this.analysis;
    const messages = this.messages;
    if (!candles.length || !a) {
      ctx.fillStyle = C.muted;
      ctx.font = "14px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading chart…", W / 2, H / 2);
      return;
    }

    const overlay = this.overlayMetrics(ctx, W, messages);
    const padL = 54;
    const padR = 58;
    const padT = top + 12;
    const gap = 8;
    const reserve = overlay.height + 18;
    const usable = H - padT - reserve;
    const priceH = Math.round(usable * 0.63);
    const volH = Math.round(usable * 0.13);
    const rsiH = Math.max(44, usable - priceH - volH - gap * 2);
    const priceTop = padT;
    const volTop = priceTop + priceH + gap;
    const rsiTop = volTop + volH + gap;
    const plotW = W - padL - padR;

    const neck = a.inverseHs?.neckline || a.hs?.neckline || a.doubleBottom?.neckline || a.doubleTop?.neckline;
    const hi = Math.max(...candles.map((c) => c.high), neck || 0);
    const lo = Math.min(...candles.map((c) => c.low), neck || Infinity);
    const padPx = (hi - lo) * 0.08 || 1;
    const pMax = hi + padPx;
    const pMin = lo - padPx;
    const maxVol = Math.max(...candles.map((c) => c.volume), 1);

    const xAt = (i) => padL + (i + 0.5) * (plotW / candles.length);
    const yPrice = (p) => priceTop + ((pMax - p) / (pMax - pMin)) * priceH;
    const yVol = (v) => volTop + volH - (v / maxVol) * (volH - 4);
    const yRsi = (r) => rsiTop + ((100 - r) / 100) * rsiH;
    const candleW = Math.max(2.4, (plotW / candles.length) * 0.62);

    this.pane(ctx, padL, priceTop, plotW, priceH);
    this.pane(ctx, padL, volTop, plotW, volH);
    this.pane(ctx, padL, rsiTop, plotW, rsiH);

    ctx.font = "10px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g++) {
      const p = pMin + ((pMax - pMin) * g) / 4;
      const y = yPrice(p);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.fillText(formatPrice(p), padL - 6, y);
    }

    this.drawPattern(ctx, a, xAt, yPrice);

    this.linePath(ctx, a.ema50, C.ema50, 1.5, xAt, yPrice);
    this.linePath(ctx, a.ema20, C.ema20, 1.5, xAt, yPrice);

    candles.forEach((c, i) => {
      const x = xAt(i);
      const up = c.close >= c.open;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yPrice(c.high));
      ctx.lineTo(x, yPrice(c.low));
      ctx.stroke();
      const topY = yPrice(Math.max(c.open, c.close));
      const botY = yPrice(Math.min(c.open, c.close));
      ctx.fillRect(x - candleW / 2, topY, candleW, Math.max(1, botY - topY));

      ctx.globalAlpha = 0.5;
      ctx.fillRect(x - candleW / 2, yVol(c.volume), candleW, volTop + volH - yVol(c.volume));
      ctx.globalAlpha = 1;
    });

    this.markStructure(ctx, a, xAt, yPrice);

    ctx.fillStyle = C.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "10px Segoe UI, system-ui, sans-serif";
    ctx.fillText("VOLUME", padL + 6, volTop + 5);

    ctx.fillStyle = "rgba(239, 83, 80, 0.08)";
    ctx.fillRect(padL, rsiTop, plotW, yRsi(70) - rsiTop);
    ctx.fillStyle = "rgba(38, 166, 154, 0.08)";
    ctx.fillRect(padL, yRsi(30), plotW, rsiTop + rsiH - yRsi(30));
    [30, 50, 70].forEach((lvl) => {
      ctx.strokeStyle = "#243044";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, yRsi(lvl));
      ctx.lineTo(padL + plotW, yRsi(lvl));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(lvl), padL - 6, yRsi(lvl));
    });

    ctx.beginPath();
    let started = false;
    a.rsi14.forEach((r, i) => {
      if (r == null) return;
      if (!started) {
        ctx.moveTo(xAt(i), yRsi(r));
        started = true;
      } else ctx.lineTo(xAt(i), yRsi(r));
    });
    ctx.strokeStyle = C.rsi;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("RSI 14", padL + 6, rsiTop + 5);

    const lastR = a.lastRsi;
    if (lastR != null) {
      ctx.fillStyle = C.rsi;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(lastR.toFixed(0), padL + plotW + 6, yRsi(lastR));
    }

    const last = a.last;
    const ly = yPrice(last.close);
    const up = last.close >= last.open;
    ctx.fillStyle = up ? C.up : C.down;
    roundRect(ctx, padL + plotW + 4, ly - 8, 50, 16, 3);
    ctx.fill();
    ctx.fillStyle = "#062018";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "10px Segoe UI, system-ui, sans-serif";
    const tag = last.close >= 100 ? last.close.toFixed(0) : formatPrice(last.close);
    ctx.fillText(tag.length > 7 ? tag.slice(0, 7) : tag, padL + plotW + 29, ly);

    if (messages) this.drawOverlay(ctx, W, H, messages, overlay);
  }

  pane(ctx, x, y, w, h) {
    ctx.fillStyle = C.pane;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  linePath(ctx, arr, color, width, xAt, yPrice) {
    ctx.beginPath();
    arr.forEach((v, i) => {
      if (i === 0) ctx.moveTo(xAt(i), yPrice(v));
      else ctx.lineTo(xAt(i), yPrice(v));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawPattern(ctx, a, xAt, yPrice) {
    const inv = a.inverseHs;
    const hs = a.hs;
    const pat = inv || hs;
    if (pat) {
      const yNeck = yPrice(pat.neckline);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(234, 179, 8, 0.75)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(xAt(Math.max(0, pat.ls.i - 2)), yNeck);
      ctx.lineTo(xAt(a.candles.length - 1), yNeck);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#eab308";
      ctx.font = "10px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("neckline", xAt(Math.max(0, pat.ls.i - 1)), yNeck - 4);

      ctx.strokeStyle = "rgba(122, 162, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xAt(pat.ls.i), yPrice(pat.ls.price));
      ctx.lineTo(xAt(pat.head.i), yPrice(pat.head.price));
      ctx.lineTo(xAt(pat.rs.i), yPrice(pat.rs.price));
      ctx.stroke();
      this.tag(ctx, xAt(pat.ls.i), yPrice(pat.ls.price) + (inv ? 12 : -12), "LS");
      this.tag(ctx, xAt(pat.head.i), yPrice(pat.head.price) + (inv ? 12 : -12), "HEAD");
      this.tag(ctx, xAt(pat.rs.i), yPrice(pat.rs.price) + (inv ? 12 : -12), "RS");
      return;
    }

    const dbl = a.doubleBottom || a.doubleTop;
    if (dbl) {
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(234, 179, 8, 0.75)";
      ctx.beginPath();
      ctx.moveTo(xAt(dbl.a.i), yPrice(dbl.neckline));
      ctx.lineTo(xAt(a.candles.length - 1), yPrice(dbl.neckline));
      ctx.stroke();
      ctx.setLineDash([]);
      this.tag(ctx, xAt(dbl.a.i), yPrice(dbl.a.price) + (a.doubleBottom ? 12 : -12), "1");
      this.tag(ctx, xAt(dbl.b.i), yPrice(dbl.b.price) + (a.doubleBottom ? 12 : -12), "2");
    }
  }

  markStructure(ctx, a, xAt, yPrice) {
    if (a.freshHH && a.highs.length) {
      const s = a.highs[a.highs.length - 1];
      ctx.fillStyle = C.buy;
      ctx.beginPath();
      ctx.arc(xAt(s.i), yPrice(s.price), 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("higher high", xAt(s.i) - 6, yPrice(s.price) - 6);
    }
    if (a.freshLL && a.lows.length) {
      const s = a.lows[a.lows.length - 1];
      ctx.fillStyle = C.sell;
      ctx.beginPath();
      ctx.arc(xAt(s.i), yPrice(s.price), 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("lower low", xAt(s.i) - 6, yPrice(s.price) + 6);
    }
  }

  tag(ctx, x, y, text) {
    ctx.font = "10px Segoe UI, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(18, 24, 36, 0.92)";
    ctx.strokeStyle = "#7aa2ff";
    ctx.lineWidth = 1;
    roundRect(ctx, x - w / 2, y - 7, w, 14, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c5d4ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  drawOverlay(ctx, W, H, messages, overlay) {
    const pad = 12;
    const x = pad;
    const h = overlay.height;
    const y = H - h - pad;
    const w = W - pad * 2;
    ctx.fillStyle = "rgba(10, 14, 22, 0.92)";
    ctx.strokeStyle = "#2a3448";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();

    const color = verdictColor(messages.verdict);
    const badgeW = overlay.badge;
    const badgeH = Math.max(52, h - 24);
    const bx = x + 12;
    const by = y + (h - badgeH) / 2;
    ctx.fillStyle = `${color}22`;
    ctx.strokeStyle = `${color}59`;
    roundRect(ctx, bx, by, badgeW, badgeH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = overlay.narrow ? "800 16px Segoe UI, system-ui, sans-serif" : "800 20px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(messages.verdict, bx + badgeW / 2, by + badgeH / 2 - 7);
    ctx.font = "700 10px Segoe UI, system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText("NOW", bx + badgeW / 2, by + badgeH / 2 + 12);

    const tx = bx + badgeW + 14;
    let ty = y + 14;
    const simpleH = overlay.narrow ? 17 : 20;
    const techH = overlay.narrow ? 14 : 16;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = C.text;
    ctx.font = overlay.narrow ? "600 13px Segoe UI, system-ui, sans-serif" : "600 15px Segoe UI, system-ui, sans-serif";
    overlay.simple.forEach((line) => {
      ctx.fillText(line, tx, ty);
      ty += simpleH;
    });
    ty += 4;
    ctx.fillStyle = C.ema50;
    ctx.font = "700 10px Segoe UI, system-ui, sans-serif";
    ctx.fillText("TECHNICAL", tx, ty);
    ty += 14;
    ctx.fillStyle = "#8b95a8";
    ctx.font = overlay.narrow ? "11.5px Segoe UI, system-ui, sans-serif" : "12.5px Segoe UI, system-ui, sans-serif";
    overlay.technical.forEach((line) => {
      ctx.fillText(line, tx, ty);
      ty += techH;
    });
  }

  async exportBlob() {
    const scale = 2;
    const W = Math.max(900, this.cssW);
    const H = Math.max(560, this.cssH + 8);
    const off = document.createElement("canvas");
    off.width = W * scale;
    off.height = H * scale;
    const ctx = off.getContext("2d");
    ctx.scale(scale, scale);
    this.render(ctx, W, H, { header: true });
    return new Promise((resolve) => off.toBlob((b) => resolve(b), "image/png"));
  }
}
