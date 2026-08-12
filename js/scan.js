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

function candleSign(r, g, b, loose) {
  const { hue, sat, max } = hueSat(r, g, b);
  const minMax = loose ? 38 : 55;
  const minSat = loose ? 0.1 : 0.28;
  if (max < minMax || sat < minSat) {
    if (loose) {
      if (g > r + 6 && g > 42 && g + 4 >= b) return 1;
      if (r > g + 6 && r > 42) return -1;
    }
    return 0;
  }
  const green = loose
    ? (hue >= 68 && hue <= 188) || (g > r + 8 && g >= b - 18 && g > 48)
    : (hue >= 85 && hue <= 175) || (g > r + 12 && g >= b - 8 && g > 70);
  const red = loose
    ? hue <= 40 || hue >= 328 || (r > g + 10 && r > b + 4 && r > 52)
    : hue <= 22 || hue >= 345 || (r > g + 18 && r > b + 8 && r > 80 && g < 160);
  if (green && !red) return 1;
  if (red && !green) return -1;
  return 0;
}

function downsampleToCanvas(source, maxW = 1400, enhance = false) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const scale = sw > maxW ? maxW / sw : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (enhance) {
    ctx.filter = "contrast(1.3) saturate(1.75) brightness(1.06)";
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  return { canvas, ctx, scale };
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

function densestRun(clusters) {
  if (clusters.length <= 24) return clusters;
  const widths = clusters.map((c) => c.x1 - c.x0 + 1);
  const med = widths.slice().sort((a, b) => a - b)[Math.floor(widths.length / 2)] || 4;
  const typical = clusters.filter((c) => {
    const w = c.x1 - c.x0 + 1;
    return w >= 2 && w <= med * 3.5;
  });
  if (typical.length < 16) return clusters;

  let best = [0, typical.length];
  let bestScore = 0;
  for (let i = 0; i < typical.length; i++) {
    for (let j = i + 16; j <= typical.length; j++) {
      const span = typical[j - 1].x1 - typical[i].x0;
      const count = j - i;
      const avgGap = span / Math.max(1, count);
      const score = count / (1 + avgGap / 18);
      if (score > bestScore) {
        bestScore = score;
        best = [i, j];
      }
    }
  }
  return typical.slice(best[0], best[1]);
}

function extractOnce(source, { loose, enhance, minColRatio, gap }) {
  const { canvas, ctx } = downsampleToCanvas(source, loose ? 1600 : 1400, enhance);
  const { width: W, height: H } = canvas;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;

  const signs = new Int8Array(W * H);
  const colCount = new Uint16Array(W);
  let painted = 0;
  let minX = W;
  let maxX = 0;
  let minY = H;
  let maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const s = candleSign(data[i], data[i + 1], data[i + 2], loose);
      signs[y * W + x] = s;
      if (s) {
        colCount[x] += 1;
        painted += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (painted < 80) {
    return { candles: [], count: 0, reason: "No green/red candles found" };
  }

  const chartH = Math.max(20, maxY - minY);
  const minCol = Math.max(loose ? 3 : 4, Math.floor(chartH * minColRatio));
  let clusters = mergeClusters(clustersFromHist(colCount, minCol), gap);
  clusters = densestRun(clusters);
  clusters = clusters.filter((c) => c.x1 - c.x0 >= 1);
  if (clusters.length < 12) {
    return { candles: [], count: clusters.length, reason: "Need a closer chart — fill the frame" };
  }

  const candles = [];
  clusters.forEach((c, idx) => {
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
    const y0 = Math.max(0, minY - 4);
    const y1 = Math.min(H - 1, maxY + 4);
    for (let y = y0; y <= y1; y++) {
      let row = 0;
      for (let x = x0; x <= x1; x++) {
        const s = signs[y * W + x];
        if (!s) continue;
        row += 1;
        if (s > 0) bull += 1;
        else bear += 1;
      }
      if (row === 0) continue;
      if (y < yTop) yTop = y;
      if (y > yBot) yBot = y;
      if (row >= Math.max(2, cw * (loose ? 0.3 : 0.38))) {
        if (y < bodyTop) bodyTop = y;
        if (y > bodyBot) bodyBot = y;
        bodyHits += 1;
      }
    }
    if (yBot <= yTop) return;
    if (bodyHits < 2 || bodyBot <= bodyTop) {
      const mid = (yTop + yBot) / 2;
      bodyTop = Math.floor(mid - (yBot - yTop) * 0.18);
      bodyBot = Math.ceil(mid + (yBot - yTop) * 0.18);
    }
    const up = bull >= bear;
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

  if (candles.length < 12) {
    return { candles: [], count: candles.length, reason: "Could not separate candles" };
  }
  return { candles, count: candles.length, reason: "" };
}

export function extractCandlesFromImage(source) {
  const attempts = [
    { loose: false, enhance: false, minColRatio: 0.012, gap: 2 },
    { loose: true, enhance: true, minColRatio: 0.008, gap: 3 },
    { loose: true, enhance: true, minColRatio: 0.005, gap: 4 },
  ];
  let best = { candles: [], count: 0, reason: "No green/red candles found" };
  for (const opt of attempts) {
    const result = extractOnce(source, opt);
    if (result.count > best.count) best = result;
    if (result.count >= 18) return result;
  }
  if (best.count >= 12) return best;
  return {
    candles: [],
    count: best.count,
    reason: "Hold closer, square to the screen, and kill the glare",
  };
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

export function grabCameraFrame(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return canvas;
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}
