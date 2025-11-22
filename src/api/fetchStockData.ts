// src/api/fetchStockData.ts
import axios from "axios";

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
  source?: "yahoo" | "finnhub" | "cache" | "unknown";
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

// ---------- Symbol mapping ----------
const mapYahooSymbol = (symbol: string) => {
  const s = symbol.toUpperCase();
  if (s === "BTC/USD") return "BTC-USD";
  if (s === "ETH/USD") return "ETH-USD";
  if (s === "XAU/USD") return "XAUUSD";
  return s;
};

// ---------- Fetch Yahoo ----------
const fetchYahoo = async (symbols: string[]): Promise<Record<string, StockData>> => {
  const results: Record<string, StockData> = {};
  if (!symbols.length) return results;

  // batch 5 symbols per call
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += 5) batches.push(symbols.slice(i, i + 5));

  for (const batch of batches) {
    const ySymbols = batch.map(mapYahooSymbol).join(",");
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ySymbols)}`;
    const chartUrlBase = `https://query1.finance.yahoo.com/v8/finance/chart/`;

    const quoteJson = await safeFetch(quoteUrl);

    for (const s of batch) {
      const mapped = mapYahooSymbol(s);
      const data = quoteJson?.quoteResponse?.result?.find((d: any) => d.symbol === mapped);
      if (!data) {
        results[s] = {
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
          source: "yahoo",
        };
        continue;
      }

      const price = data.regularMarketPrice ?? data.regularMarketLastPrice ?? null;

      // OHLCV last 30 days
      let prices: number[] = [];
      let highs: number[] = [];
      let lows: number[] = [];
      let volumes: number[] = [];
      try {
        const chartJson = await safeFetch(`${chartUrlBase}${mapped}?range=1mo&interval=1d`);
        const timestamp: number[] = chartJson?.chart?.result?.[0]?.timestamp || [];
        const indicators = chartJson?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
        if (timestamp.length && indicators.close?.length) {
          prices = indicators.close.map((v: any) => Number(v));
          highs = indicators.high.map((v: any) => Number(v));
          lows = indicators.low.map((v: any) => Number(v));
          volumes = indicators.volume.map((v: any) => Number(v));
        }
      } catch {}

      results[s] = {
        symbol: s,
        current: price != null ? Number(price) : null,
        high: data.regularMarketDayHigh != null ? Number(data.regularMarketDayHigh) : null,
        low: data.regularMarketDayLow != null ? Number(data.regularMarketDayLow) : null,
        open: data.regularMarketOpen != null ? Number(data.regularMarketOpen) : null,
        previousClose:
          data.regularMarketPreviousClose != null
            ? Number(data.regularMarketPreviousClose)
            : price != null
            ? Number(price)
            : null,
        prices,
        highs,
        lows,
        volumes,
        lastUpdated: Date.now(),
        source: "yahoo",
      };
    }

    await delay(4000); // respect 60 calls per 4 minutes
  }

  return results;
};

// ---------- Fetch Finnhub for NSE stocks ----------
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY; // add your key in .env
const fetchFinnhub = async (symbol: string): Promise<StockData | null> => {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}.NS&token=${FINNHUB_KEY}`;
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

    let result: StockData | null = null;

    // Detect NSE stock (simple heuristic: letters only, upper case, length >=2)
    const isNSE = /^[A-Z]+$/.test(symbol);
    if (isNSE && FINNHUB_KEY) {
      result = await fetchFinnhub(symbol);
    }

    if (!result) {
      const yahooResult = await fetchYahoo([symbol]);
      result = yahooResult[symbol] ?? null;
    }

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

  // Separate NSE vs others
  const nseSymbols = uncached.filter((s) => /^[A-Z]+$/.test(s) && FINNHUB_KEY);
  const yahooSymbols = uncached.filter((s) => !nseSymbols.includes(s));

  // Fetch NSE via Finnhub
  for (const s of nseSymbols) {
    const data = await fetchFinnhub(s);
    if (data) {
      CACHE[s] = { data, expires: Date.now() + CACHE_TTL };
      results[s] = data;
    }
  }

  // Fetch others via Yahoo
  const yahooResults = await fetchYahoo(yahooSymbols);
  for (const s of yahooSymbols) {
    const data = yahooResults[s] ?? {
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
    CACHE[s] = { data, expires: Date.now() + CACHE_TTL };
    results[s] = data;
  }

  return results;
}
