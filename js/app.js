import {
  TIMEFRAMES,
  displaySymbol,
  normalizeSymbol,
  fetchKlines,
  fetchTickers,
  curatedPairs,
  demoCandles,
} from "./data.js";
import { analyze, formatPrice } from "./analyze.js";
import { buildMessages, copyText } from "./messages.js";
import { Chart } from "./chart.js";
import { captureOtherScreen, loadImageFile, extractCandlesFromImage } from "./scan.js";

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
};

const chart = new Chart(document.getElementById("chart"));

function tfLabel(id) {
  return TIMEFRAMES.find((t) => t.id === id)?.label || id.toUpperCase();
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function setLoading(on) {
  state.loading = on;
  els.loading.hidden = !on;
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
  els.status.textContent = asOf ? `Candle close ${asOf}` : "";
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
    const li = document.createElement("button");
    li.type = "button";
    li.className = "pair-row" + (t.symbol === state.symbol ? " active" : "");
    const ch = t.change;
    const chTxt = ch == null ? "" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`;
    li.innerHTML = `
      <span class="pr-sym">${displaySymbol(t.symbol)}</span>
      <span class="pr-px">${t.last != null ? formatPrice(t.last) : t.custom ? "Open" : ""}</span>
      <span class="pr-ch ${ch == null ? "" : ch >= 0 ? "up" : "down"}">${chTxt}</span>`;
    li.addEventListener("click", () => {
      closeSheet();
      if (t.symbol === state.symbol) return;
      state.symbol = t.symbol;
      localStorage.setItem("twoline.symbol", state.symbol);
      renderPairBtn();
      load();
    });
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
    state.tickers = await fetchTickers(curatedPairs());
    renderPrice();
    if (els.sheet.classList.contains("open")) renderPairs();
  } catch {
    /* list still works without 24h % */
  }
}

async function load({ silent = false } = {}) {
  if (state.mode === "scan") return;
  if (!silent) {
    setLoading(true);
    els.status.textContent = "Reading the tape…";
  }
  try {
    const candles = await fetchKlines(state.symbol, state.tf, 160);
    state.demo = false;
    apply(candles);
  } catch (err) {
    if (!state.candles.length) {
      state.demo = true;
      apply(demoCandles());
    }
    if (!silent) toast(err.message || "Live feed failed — showing demo");
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
  chart.setMeta({
    symbol: displaySymbol(state.symbol),
    tf: tfLabel(state.tf),
    asOf: `${asOf}${state.demo ? " · demo" : ""}`,
  });
  chart.setData(candles, state.analysis, state.messages);
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

els.pairBtn.addEventListener("click", () => {
  if (state.mode === "scan") {
    openScanSheet();
    return;
  }
  openSheet();
});
els.backdrop.addEventListener("click", closeAllSheets);
els.scanBtn.addEventListener("click", openScanSheet);
els.scanScreenBtn.addEventListener("click", scanOtherScreen);
els.scanUploadBtn.addEventListener("click", () => els.scanFile.click());
els.scanPhotoBtn.addEventListener("click", () => els.scanCamera.click());
els.scanFile.addEventListener("change", async () => {
  const file = els.scanFile.files?.[0];
  els.scanFile.value = "";
  if (!file) return;
  try {
    await processScan(await loadImageFile(file));
  } catch (err) {
    toast(err.message || "Could not read image");
  }
});
els.scanCamera.addEventListener("change", async () => {
  const file = els.scanCamera.files?.[0];
  els.scanCamera.value = "";
  if (!file) return;
  try {
    await processScan(await loadImageFile(file));
  } catch (err) {
    toast(err.message || "Could not read photo");
  }
});
els.search.addEventListener("input", renderPairs);
els.search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const symbol = normalizeSymbol(els.search.value);
    closeSheet();
    state.symbol = symbol;
    localStorage.setItem("twoline.symbol", state.symbol);
    renderPairBtn();
    load();
  }
  if (e.key === "Escape") closeSheet();
});
els.shareBtn.addEventListener("click", shareImage);
els.copyBtn.addEventListener("click", copyMessages);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllSheets();
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredPrompt = e;
  if (!localStorage.getItem("twoline.hideInstall")) {
    els.install.hidden = false;
  }
});

els.installBtn.addEventListener("click", async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  els.install.hidden = true;
});

els.dismissInstall.addEventListener("click", () => {
  localStorage.setItem("twoline.hideInstall", "1");
  els.install.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}

renderTfs();
renderPairBtn();
chart.resize();
load();
loadTickers();
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
