function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles, period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return sma(trs, period);
}

function findSwings(candles, radius = 4) {
  const swings = [];
  for (let i = radius; i < candles.length - radius; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swings.push({ i, type: "high", price: candles[i].high });
    if (isLow) swings.push({ i, type: "low", price: candles[i].low });
  }
  return swings;
}

function lastOf(arr, type, n = 4) {
  return arr.filter((s) => s.type === type).slice(-n);
}

function detectInverseHS(candles, swings) {
  const troughs = swings.filter((s) => s.type === "low");
  const peaks = swings.filter((s) => s.type === "high");
  if (troughs.length < 3) return null;

  for (let start = troughs.length - 3; start >= Math.max(0, troughs.length - 6); start--) {
    const ls = troughs[start];
    const head = troughs[start + 1];
    const rs = troughs[start + 2];
    if (head.price >= ls.price || head.price >= rs.price) continue;

    const mid = (ls.price + rs.price) / 2;
    if (Math.abs(ls.price - rs.price) / mid > 0.028) continue;
    if ((mid - head.price) / mid < 0.0045) continue;

    const midPeaks = peaks.filter((p) => p.i > ls.i && p.i < rs.i);
    if (!midPeaks.length) continue;
    const neckline = Math.max(...midPeaks.map((p) => p.price));
    if (neckline <= mid) continue;

    const last = candles[candles.length - 1];
    const broken = last.close > neckline;
    const after = peaks.filter((p) => p.i > rs.i);
    const higherHigh = after.some((p) => p.price > neckline) || (broken && last.high > neckline);
    const recent = rs.i > candles.length - 28;

    if (!recent && !broken) continue;

    return { type: "inverse_hs", ls, head, rs, neckline, complete: broken, higherHigh };
  }
  return null;
}

function detectHS(candles, swings) {
  const peaks = swings.filter((s) => s.type === "high");
  const troughs = swings.filter((s) => s.type === "low");
  if (peaks.length < 3) return null;

  for (let start = peaks.length - 3; start >= Math.max(0, peaks.length - 6); start--) {
    const ls = peaks[start];
    const head = peaks[start + 1];
    const rs = peaks[start + 2];
    if (head.price <= ls.price || head.price <= rs.price) continue;

    const mid = (ls.price + rs.price) / 2;
    if (Math.abs(ls.price - rs.price) / mid > 0.028) continue;
    if ((head.price - mid) / mid < 0.0045) continue;

    const midTroughs = troughs.filter((p) => p.i > ls.i && p.i < rs.i);
    if (!midTroughs.length) continue;
    const neckline = Math.min(...midTroughs.map((p) => p.price));
    if (neckline >= mid) continue;

    const last = candles[candles.length - 1];
    const broken = last.close < neckline;
    const after = troughs.filter((p) => p.i > rs.i);
    const lowerLow = after.some((p) => p.price < neckline) || (broken && last.low < neckline);
    const recent = rs.i > candles.length - 28;
    if (!recent && !broken) continue;

    return { type: "hs", ls, head, rs, neckline, complete: broken, lowerLow };
  }
  return null;
}

function detectDouble(candles, swings, kind) {
  const key = kind === "bottom" ? "low" : "high";
  const points = swings.filter((s) => s.type === key);
  if (points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const midPrice = (a.price + b.price) / 2;
  if (Math.abs(a.price - b.price) / midPrice > 0.012) return null;
  if (b.i - a.i < 6) return null;

  const between = candles.slice(a.i, b.i + 1);
  const last = candles[candles.length - 1];
  if (kind === "bottom") {
    const neck = Math.max(...between.map((c) => c.high));
    if (neck <= midPrice) return null;
    return { type: "double_bottom", a, b, neckline: neck, complete: last.close > neck };
  }
  const neck = Math.min(...between.map((c) => c.low));
  if (neck >= midPrice) return null;
  return { type: "double_top", a, b, neckline: neck, complete: last.close < neck };
}

function detectDivergence(candles, rsiArr, swings) {
  const lows = lastOf(swings, "low", 3);
  const highs = lastOf(swings, "high", 3);
  if (lows.length >= 2) {
    const a = lows[lows.length - 2];
    const b = lows[lows.length - 1];
    const ra = rsiArr[a.i];
    const rb = rsiArr[b.i];
    if (ra != null && rb != null && b.price < a.price && rb > ra + 2.5) {
      return { type: "bullish", a, b };
    }
  }
  if (highs.length >= 2) {
    const a = highs[highs.length - 2];
    const b = highs[highs.length - 1];
    const ra = rsiArr[a.i];
    const rb = rsiArr[b.i];
    if (ra != null && rb != null && b.price > a.price && rb < ra - 2.5) {
      return { type: "bearish", a, b };
    }
  }
  return null;
}

function detectEmaCross(e20, e50) {
  for (let i = e20.length - 1; i >= Math.max(1, e20.length - 6); i--) {
    const prev = e20[i - 1] - e50[i - 1];
    const now = e20[i] - e50[i];
    if (prev <= 0 && now > 0) return { type: "golden", i };
    if (prev >= 0 && now < 0) return { type: "death", i };
  }
  return null;
}

export function analyze(candles) {
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const swings = findSwings(candles, candles.length > 120 ? 5 : 4);

  const lastI = candles.length - 1;
  const last = candles[lastI];
  const lastEma20 = ema20[lastI];
  const lastEma50 = ema50[lastI];
  const lastRsi = rsi14[lastI];
  const lastAtr = atr14[lastI] || last.high - last.low;

  const highs = lastOf(swings, "high", 4);
  const lows = lastOf(swings, "low", 4);

  let structure = "range";
  let hh = false;
  let hl = false;
  let lh = false;
  let ll = false;
  if (highs.length >= 2) {
    hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
  }
  if (lows.length >= 2) {
    hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
  }
  if (hh && hl) structure = "uptrend";
  else if (lh && ll) structure = "downtrend";
  else if (hh && ll) structure = "expanding";
  else if (lh && hl) structure = "contracting";
  else if (hh) structure = "higher_high";
  else if (ll) structure = "lower_low";
  else if (hl) structure = "higher_low";
  else if (lh) structure = "lower_high";

  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const freshHH = Boolean(lastHigh && hh && lastHigh.i >= lastI - 4);
  const freshLL = Boolean(lastLow && ll && lastLow.i >= lastI - 4);

  const avgVol = sma(vols, 20)[lastI - 1] || last.volume;
  const volSpike = last.volume > avgVol * 1.55;
  const extension = lastAtr ? (last.close - lastEma20) / lastAtr : 0;

  return {
    candles,
    ema20,
    ema50,
    rsi14,
    atr14,
    swings,
    last,
    lastRsi,
    lastEma20,
    lastEma50,
    lastAtr,
    aboveEma20: last.close > lastEma20,
    aboveEma50: last.close > lastEma50,
    emaBull: lastEma20 > lastEma50,
    extension,
    extendedUp: extension > 1.7,
    extendedDown: extension < -1.7,
    rsiOverbought: lastRsi != null && lastRsi >= 70,
    rsiOversold: lastRsi != null && lastRsi <= 30,
    rsiRising: lastRsi != null && rsi14[lastI - 1] != null && lastRsi > rsi14[lastI - 1],
    volSpike,
    structure,
    hh,
    hl,
    lh,
    ll,
    freshHH,
    freshLL,
    highs,
    lows,
    inverseHs: detectInverseHS(candles, swings),
    hs: detectHS(candles, swings),
    doubleBottom: detectDouble(candles, swings, "bottom"),
    doubleTop: detectDouble(candles, swings, "top"),
    divergence: detectDivergence(candles, rsi14, swings),
    emaCross: detectEmaCross(ema20, ema50),
  };
}

export function formatPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
