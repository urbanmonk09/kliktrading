// src/api/fetchStockData.ts
export interface StockData {
  symbol: string;
  current: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  previousClose: number | null;
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  lastUpdated: number;
  source?: "finnhub" | "cache" | "unknown";

  // Indicators
  rsi?: number;
  ema50?: number;
  ema200?: number;
  sma20?: number;
}

// ---------- In-memory cache ----------
type CacheEntry = { data: StockData; expires: number };
const CACHE: Record<string, CacheEntry> = {};
const CACHE_TTL = 1000 * 240; // 4 minutes

// ---------- Helpers ----------
async function safeFetch(url: string, headers: any = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("❌ safeFetch failed:", url, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Indicators ----------
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number, prevEMA?: number): number {
  if (prices.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = prevEMA ?? calculateSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period - 1; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

// ---------- Symbol mapping ----------
const mapFinnhubSymbol = (symbol: string) => {
  const s = symbol.toUpperCase();
  if (s === "BTCUSDT") return "BINANCE:BTCUSDT";
  if (s === "ETHUSDT") return "BINANCE:ETHUSDT";
  if (s === "XAUUSD") return "OANDA:XAUUSD";
  if (/^[A-Z]+$/.test(s)) return `${s}.NS`; // NSE stocks
  return s;
};

const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;

// ---------- Fetch Finnhub ----------
async function fetchFinnhubQuote(symbol: string): Promise<StockData | null> {
  if (!FINNHUB_KEY) return null;
  const mapped = mapFinnhubSymbol(symbol);
  const url = `https://finnhub.io/api/v1/quote?symbol=${mapped}&token=${FINNHUB_KEY}`;
  const data = await safeFetch(url);
  if (!data) return null;

  return {
    symbol,
    current: data.c,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
    prices: [],
    highs: [],
    lows: [],
    volumes: [],
    lastUpdated: Date.now(),
    source: "finnhub",
  };
}

async function fetchFinnhubCandles(symbol: string, resolution: string = "D", count = 200) {
  if (!FINNHUB_KEY) return null;
  const mapped = mapFinnhubSymbol(symbol);
  const now = Math.floor(Date.now() / 1000);
  const from = now - count * 24 * 60 * 60; // last `count` days
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${mapped}&resolution=${resolution}&from=${from}&to=${now}&token=${FINNHUB_KEY}`;
  const data = await safeFetch(url);
  if (!data || data.s !== "ok") return null;
  return data;
}

// ---------- Main fetch ----------
export async function fetchStockData(symbol: string): Promise<StockData> {
  try {
    const cached = CACHE[symbol];
    if (cached && cached.expires > Date.now()) return { ...cached.data, source: "cache" };

    // Get quote
    let result = await fetchFinnhubQuote(symbol);

    // Fetch historical candles for indicators
    const candles = await fetchFinnhubCandles(symbol);
    if (candles) {
      result!.prices = candles.c ?? [];
      result!.highs = candles.h ?? [];
      result!.lows = candles.l ?? [];
      result!.volumes = candles.v ?? [];

      result!.sma20 = calculateSMA(result!.prices, 20);
      result!.ema50 = calculateEMA(result!.prices, 50);
      result!.ema200 = calculateEMA(result!.prices, 200);
      result!.rsi = calculateRSI(result!.prices, 14);
    }

    // fallback if result missing
    if (!result) {
      result = {
        symbol,
        current: 0,
        high: null,
        low: null,
        open: null,
        previousClose: null,
        prices: [],
        highs: [],
        lows: [],
        volumes: [],
        lastUpdated: Date.now(),
        source: "unknown",
      };
    }

    CACHE[symbol] = { data: result, expires: Date.now() + CACHE_TTL };
    return result;
  } catch (err) {
    console.error("fetchStockData error", err);
    return {
      symbol,
      current: 0,
      high: null,
      low: null,
      open: null,
      previousClose: null,
      prices: [],
      highs: [],
      lows: [],
      volumes: [],
      lastUpdated: Date.now(),
      source: "unknown",
    };
  }
}

// ---------- Bulk fetch ----------
export async function fetchMultipleStockData(symbols: string[]): Promise<Record<string, StockData>> {
  const results: Record<string, StockData> = {};
  const uncached = symbols.filter((s) => !(CACHE[s]?.expires > Date.now()));

  for (const s of uncached) {
    const data = await fetchStockData(s);
    results[s] = data;
    await delay(1000); // avoid rate limits
  }

  // Add cached symbols
  for (const s of symbols) {
    if (!(s in results) && CACHE[s]) results[s] = { ...CACHE[s].data, source: "cache" };
  }

  return results;
}
