const CURATED = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "SUIUSDT", "NEARUSDT", "ARBUSDT", "TONUSDT", "LTCUSDT",
  "ATOMUSDT", "APTUSDT", "OPUSDT", "INJUSDT", "PEPEUSDT",
];

export const TIMEFRAMES = [
  { id: "15m", label: "15m", interval: "15m" },
  { id: "1h", label: "1H", interval: "1h" },
  { id: "4h", label: "4H", interval: "4h" },
  { id: "1d", label: "1D", interval: "1d" },
  { id: "1w", label: "1W", interval: "1w" },
];

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

const UPSTREAMS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api.binance.us",
];

function useLocalProxy() {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".e2b.app");
}

async function fetchJson(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data && data.error) {
        lastErr = new Error(data.error);
        continue;
      }
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not load market data");
}

export async function fetchKlines(symbol, interval, limit = 160) {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  const urls = [];
  if (useLocalProxy()) urls.push(`/api/klines?${params}`);
  for (const base of UPSTREAMS) {
    urls.push(`${base}/api/v3/klines?${params}`);
  }
  const data = await fetchJson(urls);
  if (!Array.isArray(data) || data.length < 30) throw new Error("Not enough candles");
  return data.map(toCandle);
}

export async function fetchTickers(symbols = CURATED) {
  const packed = encodeURIComponent(JSON.stringify(symbols));
  const urls = [];
  if (useLocalProxy()) {
    urls.push(`/api/tickers?symbols=${symbols.join(",")}`);
  }
  for (const base of UPSTREAMS) {
    urls.push(`${base}/api/v3/ticker/24hr?symbols=${packed}`);
  }
  const data = await fetchJson(urls);
  if (!Array.isArray(data)) return [];
  return data.map((t) => ({
    symbol: t.symbol,
    last: Number(t.lastPrice),
    change: Number(t.priceChangePercent),
    quoteVolume: Number(t.quoteVolume),
  }));
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
  return candles;
}
