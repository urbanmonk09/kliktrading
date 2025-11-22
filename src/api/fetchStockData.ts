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
}

// ---------- In-memory cache ----------
type CacheEntry = { data: StockData; expires: number };
const CACHE: Record<string, CacheEntry> = {};
const CACHE_TTL = 1000 * 240; // 4 minutes per symbol

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

// ---------- Symbol mapping for Finnhub ----------
const mapFinnhubSymbol = (symbol: string) => {
  const s = symbol.toUpperCase();
  if (s === "BTCUSDT") return "BINANCE:BTCUSDT";
  if (s === "ETHUSDT") return "BINANCE:ETHUSDT";
  if (s === "XAUUSD") return "OANDA:XAUUSD";
  if (/^[A-Z]+$/.test(s)) return `${s}.NS`; // NSE stocks
  return s;
};

// ---------- Fetch Finnhub ----------
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;

const fetchFinnhub = async (symbol: string): Promise<StockData | null> => {
  if (!FINNHUB_KEY) return null;
  try {
    const mappedSymbol = mapFinnhubSymbol(symbol);
    const url = `https://finnhub.io/api/v1/quote?symbol=${mappedSymbol}&token=${FINNHUB_KEY}`;
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
  } catch {
    return null;
  }
};

// ---------- Main single-symbol fetch ----------
export async function fetchStockData(symbol: string): Promise<StockData> {
  try {
    const cached = CACHE[symbol];
    if (cached && cached.expires > Date.now()) return { ...cached.data, source: "cache" };

    let result = await fetchFinnhub(symbol);

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
    const data = await fetchFinnhub(s);
    const finalData = data ?? {
      symbol: s,
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
    CACHE[s] = { data: finalData, expires: Date.now() + CACHE_TTL };
    results[s] = finalData;
    await delay(1000); // small delay to avoid hitting rate limits
  }

  // Add cached symbols
  for (const s of symbols) {
    if (CACHE[s] && !(s in results)) {
      results[s] = { ...CACHE[s].data, source: "cache" };
    }
  }

  return results;
}
