import {
  TIMEFRAMES,
  displaySymbol,
  normalizeSymbol,
  fetchKlines,
  fetchTickers,
  curatedPairs,
  demoCandles,
  loadWatchlist,
  saveWatchlist,
  baseAsset,
} from "./data.js";
import { analyze, formatPrice } from "./analyze.js";
import { buildMessages, copyText } from "./messages.js";
import { Chart } from "./chart.js";
import {
  captureOtherScreen,
  loadImageFile,
  extractCandlesFromImage,
  cameraSupported,
  startPhoneCamera,
  grabCameraFrame,
  stopStream,
  countCandlesQuick,
} from "./scan.js";

const state = {
  symbol: localStorage.getItem("twoline.symbol") || "BTCUSDT",
  tf: localStorage.getItem("twoline.tf") || "4h",
  candles: [],
  analysis: null,
  messages: null,
  tickers: [],
  loading: false,
  demo: false,
  deferredPrompt: null,
  mode: "live",
  scanCount: 0,
  feed: "",
  watch: loadWatchlist(),
};

const els = {
  pairBtn: document.getElementById("pairBtn"),
  tfs: document.getElementById("tfs"),
  price: document.getElementById("price"),
  change: document.getElementById("change"),
  status: document.getElementById("status"),
  shareBtn: document.getElementById("shareBtn"),
  copyBtn: document.getElementById("copyBtn"),
  sheet: document.getElementById("pairSheet"),
  search: document.getElementById("pairSearch"),
  list: document.getElementById("pairList"),
  backdrop: document.getElementById("sheetBackdrop"),
  install: document.getElementById("installBanner"),
  installBtn: document.getElementById("installBtn"),
  dismissInstall: document.getElementById("dismissInstall"),
  toast: document.getElementById("toast"),
  loading: document.getElementById("loading"),
  scanBtn: document.getElementById("scanBtn"),
  scanSheet: document.getElementById("scanSheet"),
  scanScreenBtn: document.getElementById("scanScreenBtn"),
  scanPhotoBtn: document.getElementById("scanPhotoBtn"),
  scanUploadBtn: document.getElementById("scanUploadBtn"),
  scanFile: document.getElementById("scanFile"),
  scanCamera: document.getElementById("scanCamera"),
  cameraScan: document.getElementById("cameraScan"),
  cameraVideo: document.getElementById("cameraVideo"),
  cameraClose: document.getElementById("cameraClose"),
  cameraShutter: document.getElementById("cameraShutter"),
  cameraBox: document.getElementById("cameraBox"),
  cameraHint: document.getElementById("cameraHint"),
  watchRow: document.getElementById("watchRow"),
};

let cameraStream = null;
let previewTimer = null;

let chart;
try {
  chart = new Chart(document.getElementById("chart"));
} catch (err) {
  console.error(err);
}

function tfLabel(id) {
  return TIMEFRAMES.find((t) => t.id === id)?.label || id.toUpperCase();
}

function toast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function setLoading(on) {
  state.loading = on;
  if (els.loading) els.loading.hidden = !on;
}

function hideBoot() {
  const boot = document.getElementById("bootMsg");
  if (boot) boot.remove();
}

function renderTfs() {
  els.tfs.innerHTML = "";
  els.tfs.classList.toggle("is-scan", state.mode === "scan");
  if (state.mode === "scan") {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "chip live-back active";
    back.textContent = "Live tape";
    back.addEventListener("click", exitScan);
    els.tfs.appendChild(back);
    return;
  }
  TIMEFRAMES.forEach((tf) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (tf.id === state.tf ? " active" : "");
    b.textContent = tf.label;
    b.addEventListener("click", () => {
      if (state.tf === tf.id) return;
      state.tf = tf.id;
      localStorage.setItem("twoline.tf", state.tf);
      renderTfs();
      load();
    });
    els.tfs.appendChild(b);
  });
}

function renderPairBtn() {
  if (state.mode === "scan") {
    els.pairBtn.innerHTML = "<span>SCANNED</span>";
    return;
  }
  els.pairBtn.innerHTML = `<span>${displaySymbol(state.symbol)}</span><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5.5 7.5 10 12l4.5-4.5"/></svg>`;
}

function tickerFor(symbol) {
  return state.tickers.find((t) => t.symbol === symbol);
}

function renderPrice() {
  if (state.mode === "scan") {
    els.price.textContent = state.messages?.verdict || "SCAN";
    els.change.textContent = "from other screen";
    els.change.className = "change";
    return;
  }
  const last = state.analysis?.last;
  const t = tickerFor(state.symbol);
  const px = last ? last.close : t?.last;
  els.price.textContent = px != null ? formatPrice(px) : "—";
  const ch = t?.change;
  if (ch == null || Number.isNaN(ch)) {
    els.change.textContent = state.demo ? "demo tape" : "";
    els.change.className = "change";
    return;
  }
  const sign = ch >= 0 ? "+" : "";
  els.change.textContent = `${sign}${ch.toFixed(2)}%  24h`;
  els.change.className = "change " + (ch >= 0 ? "up" : "down");
}

function renderStatus() {
  if (state.mode === "scan") {
    els.status.textContent = state.scanCount
      ? `Read ${state.scanCount} candles from the other screen`
      : "Scan ready";
    return;
  }
  if (state.demo) {
    els.status.textContent = "Using demo tape — live feed unavailable";
    return;
  }
  const asOf = state.analysis?.last?.time
    ? new Date(state.analysis.last.time).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const feed = state.feed ? `${state.feed} · ` : "";
  els.status.textContent = asOf ? `${feed}candle close ${asOf}` : feed;
}

function isPinned(symbol) {
  return state.watch.includes(symbol);
}

function pinPair(symbol) {
  const sym = normalizeSymbol(symbol);
  if (state.watch.includes(sym)) {
    toast(`${baseAsset(sym)} is already pinned`);
    return;
  }
  state.watch = [...state.watch, sym].slice(0, 16);
  saveWatchlist(state.watch);
  renderWatch();
  if (els.sheet?.classList.contains("open")) renderPairs();
  toast(`${baseAsset(sym)} pinned`);
}

function unpinPair(symbol) {
  if (state.watch.length <= 1) {
    toast("Keep at least one pinned pair");
    return;
  }
  state.watch = state.watch.filter((s) => s !== symbol);
  saveWatchlist(state.watch);
  renderWatch();
  if (els.sheet?.classList.contains("open")) renderPairs();
}

function openPair(symbol) {
  const sym = normalizeSymbol(symbol);
  if (state.mode === "scan") exitScan();
  state.symbol = sym;
  localStorage.setItem("twoline.symbol", state.symbol);
  renderPairBtn();
  renderWatch();
  load();
}

function renderWatch() {
  if (!els.watchRow) return;
  els.watchRow.innerHTML = "";
  state.watch.forEach((sym) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "watch-chip" + (sym === state.symbol && state.mode === "live" ? " active" : "");
    const name = document.createElement("span");
    name.textContent = baseAsset(sym);
    b.appendChild(name);
    b.addEventListener("click", () => openPair(sym));
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    x.title = "Unpin";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      unpinPair(sym);
    });
    b.appendChild(x);
    els.watchRow.appendChild(b);
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "watch-add";
  add.textContent = "+ Add pair";
  add.addEventListener("click", openSheet);
  els.watchRow.appendChild(add);
}

function renderPairs() {
  const q = els.search.value.trim().toUpperCase();
  const base = state.tickers.length
    ? state.tickers
    : curatedPairs().map((symbol) => ({ symbol, last: null, change: null }));
  const rows = base.filter((t) => !q || t.symbol.includes(q.replace("/", "")));
  if (q && !rows.some((t) => t.symbol === normalizeSymbol(q))) {
    rows.unshift({ symbol: normalizeSymbol(q), last: null, change: null, custom: true });
  }
  els.list.innerHTML = "";
  rows.slice(0, 40).forEach((t) => {
    const li = document.createElement("div");
    li.className = "pair-row" + (t.symbol === state.symbol ? " active" : "");
    const ch = t.change;
    const chTxt = ch == null ? "" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`;
    const pinned = isPinned(t.symbol);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "pair-open";
    open.innerHTML = `
      <span class="pr-sym">${displaySymbol(t.symbol)}</span>
      <span class="pr-px">${t.last != null ? formatPrice(t.last) : t.custom ? "Open" : ""}</span>
      <span class="pr-ch ${ch == null ? "" : ch >= 0 ? "up" : "down"}">${chTxt}</span>`;
    open.addEventListener("click", () => {
      closeSheet();
      openPair(t.symbol);
    });
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pr-pin" + (pinned ? " on" : "");
    pin.textContent = pinned ? "Pinned" : "Pin";
    pin.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPinned(t.symbol)) unpinPair(t.symbol);
      else pinPair(t.symbol);
    });
    li.appendChild(open);
    li.appendChild(pin);
    els.list.appendChild(li);
  });
}

function openSheet() {
  els.sheet.classList.add("open");
  els.backdrop.classList.add("open");
  els.sheet.setAttribute("aria-hidden", "false");
  renderPairs();
  setTimeout(() => els.search.focus(), 50);
}

function closeSheet() {
  els.sheet.classList.remove("open");
  els.backdrop.classList.remove("open");
  els.sheet.setAttribute("aria-hidden", "true");
  els.search.value = "";
}

async function loadTickers() {
  try {
    const symbols = [...new Set([...curatedPairs(), ...state.watch])];
    state.tickers = await fetchTickers(symbols);
    renderPrice();
    if (els.sheet?.classList.contains("open")) renderPairs();
  } catch {
    /* list still works without 24h % */
  }
}

async function load({ silent = false } = {}) {
  if (state.mode === "scan") return;
  if (!silent) {
    setLoading(true);
    if (els.status) els.status.textContent = "Reading the tape…";
  }
  try {
    const out = await fetchKlines(state.symbol, state.tf, 160);
    state.demo = false;
    state.feed = out.feed || "";
    apply(out.candles);
  } catch {
    if (!state.candles.length) {
      const demo = demoCandles();
      state.demo = true;
      state.feed = "Demo";
      apply(demo.candles);
    }
  } finally {
    if (!silent) setLoading(false);
  }
}

function apply(candles) {
  state.candles = candles;
  state.analysis = analyze(candles);
  state.messages = buildMessages(state.analysis);
  const asOf = new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  chart?.setMeta({
    symbol: displaySymbol(state.symbol),
    tf: tfLabel(state.tf),
    asOf: `${asOf}${state.demo ? " · demo" : state.feed ? ` · ${state.feed}` : ""}`,
  });
  chart?.setData(candles, state.analysis, state.messages);
  renderPrice();
  renderStatus();
}

async function shareImage() {
  if (!state.messages) return;
  const blob = await chart.exportBlob();
  const name = `${state.symbol}-${state.tf}-fxvision.png`;
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `${displaySymbol(state.symbol)} ${tfLabel(state.tf)}`,
        text: `${state.messages.verdict} — ${state.messages.simple}`,
      });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  toast("Results image saved");
}

async function copyMessages() {
  if (!state.messages || !state.analysis) return;
  const text = copyText(
    displaySymbol(state.symbol),
    tfLabel(state.tf),
    state.messages,
    formatPrice(state.analysis.last.close)
  );
  try {
    await navigator.clipboard.writeText(text);
    toast("Both lines copied");
  } catch {
    toast("Could not copy");
  }
}

function openScanSheet() {
  closeSheet();
  els.scanSheet.classList.add("open");
  els.backdrop.classList.add("open");
  els.scanSheet.setAttribute("aria-hidden", "false");
}

function closeScanSheet() {
  els.scanSheet.classList.remove("open");
  els.scanSheet.setAttribute("aria-hidden", "true");
  if (!els.sheet.classList.contains("open")) els.backdrop.classList.remove("open");
}

function closeAllSheets() {
  closeSheet();
  closeScanSheet();
}

async function processScan(image) {
  closeScanSheet();
  setLoading(true);
  els.status.textContent = "Reading candles off the screen…";
  try {
    const result = extractCandlesFromImage(image);
    if (!result.candles.length) {
      toast(result.reason || "Could not read that chart");
      return;
    }
    state.mode = "scan";
    state.demo = false;
    state.scanCount = result.count;
    state.candles = result.candles;
    state.analysis = analyze(result.candles);
    state.messages = buildMessages(state.analysis);
    const asOf = new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    chart.setMeta({
      symbol: "Scanned chart",
      tf: "SCAN",
      asOf: `${result.count} candles · ${asOf}`,
    });
    chart.setScanImage(image);
    chart.setData(result.candles, state.analysis, state.messages);
    els.scanBtn.classList.add("active");
    renderPairBtn();
    renderTfs();
    renderPrice();
    renderStatus();
    toast(`Read ${result.count} candles`);
  } catch (err) {
    toast(err.message || "Scan failed");
  } finally {
    setLoading(false);
  }
}

function exitScan() {
  state.mode = "live";
  state.scanCount = 0;
  chart.clearScan();
  els.scanBtn.classList.remove("active");
  renderPairBtn();
  renderTfs();
  load();
}

async function openPhoneCamera() {
  closeScanSheet();
  if (!cameraSupported()) {
    els.scanCamera.click();
    return;
  }
  try {
    cameraStream = await startPhoneCamera(els.cameraVideo);
    els.cameraScan?.classList.add("is-on");
    startCameraPreview();
  } catch (err) {
    if (err.name === "NotAllowedError") toast("Camera permission denied");
    else {
      toast("Opening the photo picker instead");
      els.scanCamera.click();
    }
  }
}

function startCameraPreview() {
  stopCameraPreview();
  previewTimer = setInterval(() => {
    if (!els.cameraVideo?.videoWidth || !els.cameraHint) return;
    try {
      const frame = grabCameraFrame(els.cameraVideo, els.cameraBox);
      const n = countCandlesQuick(frame);
      if (n >= 8) {
        els.cameraHint.textContent = `${n} candles in view — tap the green button`;
        els.cameraHint.classList.add("ready");
      } else {
        els.cameraHint.textContent = n
          ? `Seeing ${n} — move closer so the candles fill the box`
          : "Point at the candles. Fill the green box.";
        els.cameraHint.classList.remove("ready");
      }
    } catch {
      /* preview is best-effort */
    }
  }, 400);
}

function stopCameraPreview() {
  if (previewTimer) clearInterval(previewTimer);
  previewTimer = null;
}

function closePhoneCamera() {
  stopCameraPreview();
  stopStream(cameraStream);
  cameraStream = null;
  if (els.cameraVideo) els.cameraVideo.srcObject = null;
  els.cameraScan?.classList.remove("is-on");
}

async function shutterScan() {
  if (!els.cameraVideo?.videoWidth) {
    toast("Camera is still opening");
    return;
  }
  const frame = grabCameraFrame(els.cameraVideo, els.cameraBox);
  closePhoneCamera();
  await processScan(frame);
}

async function scanOtherScreen() {
  closeScanSheet();
  try {
    const frame = await captureOtherScreen();
    await processScan(frame);
  } catch (err) {
    if (err.name === "NotAllowedError") toast("Screen capture was cancelled");
    else toast(err.message || "Could not capture that screen");
  }
}

els.pairBtn?.addEventListener("click", () => {
  if (state.mode === "scan") {
    openScanSheet();
    return;
  }
  openSheet();
});
els.backdrop?.addEventListener("click", closeAllSheets);
els.scanBtn?.addEventListener("click", openScanSheet);
els.scanScreenBtn?.addEventListener("click", scanOtherScreen);
els.scanUploadBtn?.addEventListener("click", () => els.scanFile?.click());
els.scanPhotoBtn?.addEventListener("click", openPhoneCamera);
els.cameraClose?.addEventListener("click", closePhoneCamera);
els.cameraShutter?.addEventListener("click", shutterScan);
els.scanFile?.addEventListener("change", async () => {
  const file = els.scanFile.files?.[0];
  els.scanFile.value = "";
  if (!file) return;
  try {
    await processScan(await loadImageFile(file));
  } catch (err) {
    toast(err.message || "Could not read image");
  }
});
els.scanCamera?.addEventListener("change", async () => {
  const file = els.scanCamera.files?.[0];
  els.scanCamera.value = "";
  if (!file) return;
  try {
    await processScan(await loadImageFile(file));
  } catch (err) {
    toast(err.message || "Could not read photo");
  }
});
els.search?.addEventListener("input", renderPairs);
els.search?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const symbol = normalizeSymbol(els.search.value);
    closeSheet();
    pinPair(symbol);
    openPair(symbol);
  }
  if (e.key === "Escape") closeSheet();
});
els.shareBtn?.addEventListener("click", shareImage);
els.copyBtn?.addEventListener("click", copyMessages);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePhoneCamera();
    closeAllSheets();
  }
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredPrompt = e;
  if (!localStorage.getItem("twoline.hideInstall")) {
    els.install.hidden = false;
  }
});

els.installBtn?.addEventListener("click", async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  els.install.hidden = true;
});

els.dismissInstall?.addEventListener("click", () => {
  localStorage.setItem("twoline.hideInstall", "1");
  els.install.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}

try {
  hideBoot();
  setLoading(false);
  renderTfs();
  renderPairBtn();
  renderWatch();
  chart?.resize();
  const demo = demoCandles();
  state.demo = true;
  state.feed = "Demo";
  apply(demo.candles);
  load({ silent: true });
  loadTickers();
} catch (err) {
  console.error(err);
  hideBoot();
  setLoading(false);
}
setInterval(loadTickers, 60_000);
setInterval(() => {
  if (document.visibilityState === "visible" && state.mode === "live") load({ silent: true });
}, 90_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.mode === "live") {
    load({ silent: true });
    loadTickers();
  }
});
