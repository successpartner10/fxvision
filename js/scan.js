function hueSat(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max === 0 ? 0 : d / max;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, sat, max, min };
}

function downsampleToCanvas(source, maxW = 1200, enhance = false) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const scale = sw > maxW ? maxW / sw : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (enhance) ctx.filter = "contrast(1.35) saturate(1.8) brightness(1.05)";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  return { canvas, ctx };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function estimateBackground(data, W, H) {
  const samples = [];
  const yStep = Math.max(1, Math.floor(H / 28));
  const xStep = Math.max(1, Math.floor(W / 36));
  for (let y = 0; y < H; y += yStep) {
    for (let x = 0; x < W; x += xStep) {
      const i = (y * W + x) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const m = samples[Math.floor(samples.length / 2)] || [20, 24, 32];
  return {
    r: m[0],
    g: m[1],
    b: m[2],
    lum: 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2],
  };
}

function isInk(r, g, b, bg) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const dist = Math.hypot(r - bg.r, g - bg.g, b - bg.b);
  const { sat } = hueSat(r, g, b);
  if (bg.lum < 100) {
    return lum > bg.lum + 16 || sat > 0.18 || dist > 32;
  }
  return lum < bg.lum - 16 || sat > 0.18 || dist > 32;
}

function candleDir(r, g, b) {
  if (g > r + 4 && g + 6 >= b) return 1;
  if (r > g + 4) return -1;
  const { hue, sat } = hueSat(r, g, b);
  if (sat < 0.08) return 0;
  if (hue >= 70 && hue <= 190) return 1;
  if (hue <= 40 || hue >= 320) return -1;
  return 0;
}

function estimatePeriod(hist) {
  const mean = hist.reduce((a, b) => a + b, 0) / Math.max(1, hist.length);
  let bestLag = 8;
  let best = -Infinity;
  const maxLag = Math.min(48, Math.floor(hist.length / 8));
  for (let lag = 4; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < hist.length - lag; i++) {
      s += (hist[i] - mean) * (hist[i + lag] - mean);
    }
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return bestLag;
}

function peaksFromHist(hist, period) {
  const peaks = [];
  const half = Math.max(2, Math.floor(period * 0.42));
  const floor = median(Array.from(hist)) * 0.35;
  for (let x = half; x < hist.length - half; x++) {
    if (hist[x] <= floor) continue;
    let isMax = true;
    for (let k = x - half; k <= x + half; k++) {
      if (hist[k] > hist[x]) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    if (peaks.length && x - peaks[peaks.length - 1] < period * 0.55) {
      if (hist[x] > hist[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = x;
    } else {
      peaks.push(x);
    }
  }
  return peaks;
}

function clustersFromHist(hist, minCount) {
  const out = [];
  let start = -1;
  for (let x = 0; x <= hist.length; x++) {
    const on = x < hist.length && hist[x] >= minCount;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      out.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  return out;
}

function mergeClusters(clusters, gap) {
  if (!clusters.length) return [];
  const merged = [{ ...clusters[0] }];
  for (let i = 1; i < clusters.length; i++) {
    const prev = merged[merged.length - 1];
    if (clusters[i].x0 - prev.x1 <= gap) prev.x1 = clusters[i].x1;
    else merged.push({ ...clusters[i] });
  }
  return merged;
}

function extractOnce(source, { enhance = true, maxW = 1200 } = {}) {
  const { canvas, ctx } = downsampleToCanvas(source, maxW, enhance);
  const { width: W, height: H } = canvas;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  const bg = estimateBackground(data, W, H);

  const y0 = Math.floor(H * 0.08);
  const y1 = Math.floor(H * 0.78);
  const ink = new Uint8Array(W * H);
  const colCount = new Float32Array(W);
  let painted = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isInk(data[i], data[i + 1], data[i + 2], bg)) continue;
      ink[y * W + x] = 1;
      colCount[x] += 1;
      painted += 1;
    }
  }
  if (painted < 40) {
    return { candles: [], count: 0, reason: "No candles in the box yet" };
  }

  const base = median(Array.from(colCount));
  for (let x = 0; x < W; x++) {
    colCount[x] = Math.max(0, colCount[x] - base * 0.4);
  }

  const period = estimatePeriod(colCount);
  const peaks = peaksFromHist(colCount, period);
  let bands = peaks.map((x) => {
    const half = Math.max(1, Math.floor(period * 0.32));
    return { x0: Math.max(0, x - half), x1: Math.min(W - 1, x + half) };
  });

  if (bands.length < 8) {
    const minCol = Math.max(2, Math.floor((y1 - y0) * 0.03));
    bands = mergeClusters(clustersFromHist(colCount, minCol), Math.max(1, Math.floor(period * 0.25)));
  }

  const candles = [];
  bands.forEach((c, idx) => {
    const x0 = c.x0;
    const x1 = c.x1;
    const cw = x1 - x0 + 1;
    let yTop = H;
    let yBot = 0;
    let bodyTop = H;
    let bodyBot = 0;
    let bodyHits = 0;
    let bull = 0;
    let bear = 0;
    let rs = 0;
    let gs = 0;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      let row = 0;
      for (let x = x0; x <= x1; x++) {
        if (!ink[y * W + x]) continue;
        row += 1;
        const i = (y * W + x) * 4;
        rs += data[i];
        gs += data[i + 1];
        n += 1;
        const dir = candleDir(data[i], data[i + 1], data[i + 2]);
        if (dir > 0) bull += 1;
        if (dir < 0) bear += 1;
      }
      if (!row) continue;
      if (y < yTop) yTop = y;
      if (y > yBot) yBot = y;
      if (row >= Math.max(1, cw * 0.28)) {
        if (y < bodyTop) bodyTop = y;
        if (y > bodyBot) bodyBot = y;
        bodyHits += 1;
      }
    }
    if (yBot - yTop < 3) return;
    if (bodyHits < 2 || bodyBot <= bodyTop) {
      const mid = (yTop + yBot) / 2;
      bodyTop = Math.floor(mid - (yBot - yTop) * 0.2);
      bodyBot = Math.ceil(mid + (yBot - yTop) * 0.2);
    }
    let up = bull >= bear;
    if (bull + bear < 6 && n) up = gs / n >= rs / n;
    const high = H - yTop;
    const low = H - yBot;
    const open = up ? H - bodyBot : H - bodyTop;
    const close = up ? H - bodyTop : H - bodyBot;
    candles.push({
      time: idx,
      open: open + 1000,
      high: high + 1000,
      low: low + 1000,
      close: close + 1000,
      volume: Math.max(8, (bodyBot - bodyTop) * cw),
    });
  });

  return {
    candles,
    count: candles.length,
    reason: candles.length ? "" : "Could not separate candles",
  };
}

export function extractCandlesFromImage(source) {
  const attempts = [
    { enhance: true, maxW: 1100 },
    { enhance: false, maxW: 900 },
    { enhance: true, maxW: 700 },
  ];
  let best = { candles: [], count: 0, reason: "No candles in the box yet" };
  for (const opt of attempts) {
    const result = extractOnce(source, opt);
    if (result.count > best.count) best = result;
    if (result.count >= 16) return result;
  }
  if (best.count >= 8) return best;
  return {
    candles: [],
    count: best.count,
    reason: best.count
      ? `Only ${best.count} candles — fill the green box with just the chart`
      : "No candles in the box yet — fill it with the chart and kill the glare",
  };
}

export function countCandlesQuick(source) {
  return extractOnce(source, { enhance: true, maxW: 480 }).count;
}

export async function captureOtherScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("This browser cannot capture another screen");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 8 },
    audio: false,
    preferCurrentTab: false,
  });
  try {
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth) resolve();
      else video.onloadeddata = () => resolve();
    });
    await new Promise((r) => setTimeout(r, 180));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function startPhoneCamera(video) {
  if (!cameraSupported()) {
    throw new Error("This browser cannot open the camera");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play();
  return stream;
}

export function grabCameraFrame(video, guideEl) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const vRect = video.getBoundingClientRect();
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (guideEl && vRect.width && vRect.height) {
    const scale = Math.max(vRect.width / vw, vRect.height / vh);
    const ox = (vw * scale - vRect.width) / 2;
    const oy = (vh * scale - vRect.height) / 2;
    const g = guideEl.getBoundingClientRect();
    sx = (g.left - vRect.left + ox) / scale;
    sy = (g.top - vRect.top + oy) / scale;
    sw = g.width / scale;
    sh = g.height / scale;
    sx = Math.max(0, Math.min(vw - 2, sx));
    sy = Math.max(0, Math.min(vh - 2, sy));
    sw = Math.max(8, Math.min(vw - sx, sw));
    sh = Math.max(8, Math.min(vh - sy, sh));
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}
