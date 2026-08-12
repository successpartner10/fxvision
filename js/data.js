const CURATED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "SUIUSDT", "NEARUSDT", "ARBUSDT", "TONUSDT", "LTCUSDT",
  "ATOMUSDT", "APTUSDT", "OPUSDT", "INJUSDT", "PEPEUSDT",
];

export const TIMEFRAMES = [
  { id: "15m", label: "15 min", interval: "15m", limit: 400 },
  { id: "1h", label: "1 hour", interval: "1h", limit: 300 },
  { id: "4h", label: "4 hour", interval: "4h", limit: 220 },
  { id: "1d", label: "1 day", interval: "1d", limit: 220 },
  { id: "1w", label: "1 week", interval: "1w", limit: 160 },
];

const KRAKEN = {
  BTCUSDT: "XBTUSD", ETHUSDT: "ETHUSD", SOLUSDT: "SOLUSD",
  XRPUSDT: "XRPUSD", ADAUSDT: "ADAUSD", DOGEUSDT: "DOGEUSD",
  LTCUSDT: "LTCUSD", LINKUSDT: "LINKUSD", DOTUSDT: "DOTUSD",
  AVAXUSDT: "AVAXUSD", BNBUSDT: "BNBUSD", ATOMUSDT: "ATOMUSD",
};

const GECKO = {
  BTCUSDT: "bitcoin", ETHUSDT: "ethereum", SOLUSDT: "solana",
  BNBUSDT: "binancecoin", XRPUSDT: "ripple", DOGEUSDT: "dogecoin",
  ADAUSDT: "cardano", AVAXUSDT: "avalanche-2", LINKUSDT: "chainlink",
  DOTUSDT: "polkadot", SUIUSDT: "sui", NEARUSDT: "near",
  ARBUSDT: "arbitrum", TONUSDT: "the-open-network", LTCUSDT: "litecoin",
  ATOMUSDT: "cosmos", APTUSDT: "aptos", OPUSDT: "optimism",
  INJUSDT: "injective-protocol", PEPEUSDT: "pepe",
};

const DEFAULT_WATCH = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export function displaySymbol(symbol) {
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4) + "/USDT";
  if (symbol.endsWith("USD")) return symbol.slice(0, -3) + "/USD";
  return symbol;
}

export function normalizeSymbol(input) {
  const raw = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!raw) return "BTCUSDT";
  if (raw.endsWith("USDT") || raw.endsWith("USDC") || raw.endsWith("BUSD")) return raw;
  return raw + "USDT";
}

export function baseAsset(symbol) {
  return displaySymbol(symbol).split("/")[0];
}

export function loadWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem("fxvision.watch") || "null");
    if (Array.isArray(raw) && raw.length) {
      return [...new Set(raw.map(normalizeSymbol))].slice(0, 16);
    }
  } catch { /* ignore */ }
  return DEFAULT_WATCH.slice();
}

export function saveWatchlist(list) {
  localStorage.setItem("fxvision.watch", JSON.stringify(list));
}

function toCandle(row) {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

const BINANCE = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api.binance.us",
];

function useLocalProxy() {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".e2b.app");
}

async function fetchWithTimeout(url, ms = 6500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, 6500);
  if (!res.ok) throw new Error("feed busy");
  const data = await res.json();
  if (data && data.error && !Array.isArray(data)) throw new Error(data.error);
  return data;
}

function coinbaseProduct(symbol) {
  const base = symbol.replace(/USDT$|USDC$|BUSD$|USD$/, "");
  return `${base}-USD`;
}

function coinbaseGranularity(interval) {
  return { "15m": 900, "1h": 3600, "4h": 21600, "1d": 86400, "1w": 86400 }[interval] || 3600;
}

function krakenInterval(interval) {
  return { "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080 }[interval] || 240;
}

function geckoDays(interval) {
  return { "15m": 1, "1h": 7, "4h": 30, "1d": 90, "1w": 365 }[interval] || 30;
}

async function fromBinance(symbol, interval, limit) {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  const urls = [];
  if (useLocalProxy()) urls.push(`/api/klines?${params}`);
  for (const base of BINANCE) urls.push(`${base}/api/v3/klines?${params}`);
  let lastErr;
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      if (!Array.isArray(data) || data.length < 20) continue;
      return { candles: data.map(toCandle), feed: "Binance" };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Binance unavailable");
}

async function fromCoinbase(symbol, interval) {
  const product = coinbaseProduct(symbol);
  const gran = coinbaseGranularity(interval);
  const data = await fetchJson(
    `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}`
  );
  if (!Array.isArray(data) || data.length < 20) throw new Error("Coinbase empty");
  const candles = data
    .map((r) => ({
      time: Number(r[0]) * 1000,
      low: Number(r[1]),
      high: Number(r[2]),
      open: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .sort((a, b) => a.time - b.time);
  return { candles, feed: "Coinbase" };
}

async function fromKraken(symbol, interval) {
  const pair = KRAKEN[symbol];
  if (!pair) throw new Error("no Kraken pair");
  const data = await fetchJson(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${krakenInterval(interval)}`
  );
  if (data.error?.length) throw new Error(data.error[0]);
  const key = Object.keys(data.result || {}).find((k) => k !== "last");
  const rows = key ? data.result[key] : null;
  if (!Array.isArray(rows) || rows.length < 20) throw new Error("Kraken empty");
  const candles = rows.map((r) => ({
    time: Number(r[0]) * 1000,
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[6]),
  }));
  return { candles, feed: "Kraken" };
}

async function fromGecko(symbol, interval) {
  const id = GECKO[symbol];
  if (!id) throw new Error("no CoinGecko id");
  const data = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${geckoDays(interval)}`
  );
  if (!Array.isArray(data) || data.length < 20) throw new Error("CoinGecko empty");
  const candles = data.map((r) => ({
    time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: 1,
  }));
  return { candles, feed: "CoinGecko" };
}

export async function fetchKlines(symbol, interval, limit = 160) {
  const tries = [
    () => fromBinance(symbol, interval, limit),
    () => fromCoinbase(symbol, interval),
    () => fromKraken(symbol, interval),
    () => fromGecko(symbol, interval),
  ];
  let lastErr;
  for (const tryFeed of tries) {
    try {
      const out = await tryFeed();
      if (out.candles.length >= 20) return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All live feeds are busy");
}

export async function fetchTickers(symbols = CURATED) {
  const packed = encodeURIComponent(JSON.stringify(symbols));
  const urls = [];
  if (useLocalProxy()) urls.push(`/api/tickers?symbols=${symbols.join(",")}`);
  for (const base of BINANCE) {
    urls.push(`${base}/api/v3/ticker/24hr?symbols=${packed}`);
  }
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      if (!Array.isArray(data)) continue;
      return data.map((t) => ({
        symbol: t.symbol,
        last: Number(t.lastPrice),
        change: Number(t.priceChangePercent),
        quoteVolume: Number(t.quoteVolume),
      }));
    } catch { /* next */ }
  }
  return [];
}

export function curatedPairs() {
  return CURATED.slice();
}

export function demoCandles() {
  const n = 90;
  const candles = [];
  let prev = 100600;
  const path = [];
  for (let i = 0; i < n; i++) {
    let y;
    if (i < 12) y = 100600 - i * 50;
    else if (i < 20) y = 100000 - (i - 12) * 130;
    else if (i < 27) y = 98960 + (i - 20) * 125;
    else if (i < 40) y = 99835 - (i - 27) * 150;
    else if (i < 50) y = 97885 + (i - 40) * 190;
    else if (i < 58) y = 99785 - (i - 50) * 120;
    else if (i < 66) y = 98825 + (i - 58) * 200;
    else y = 100425 + (i - 66) * 90;
    path.push(y);
  }
  for (let i = 0; i < n; i++) {
    const close = path[i];
    const open = prev;
    const high = Math.max(open, close) + 35 + (i % 5) * 8;
    const low = Math.min(open, close) - 30 - (i % 4) * 7;
    const vol = 800 + (i % 9) * 60 + (i > 58 && i < 68 ? 900 : 0);
    candles.push({
      time: Date.now() - (n - i) * 4 * 3600 * 1000,
      open, high, low, close, volume: vol,
    });
    prev = close;
  }
  return { candles, feed: "Demo" };
}
