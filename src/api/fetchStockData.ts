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
  source?: "finnhub" | "yahoo" | "cache" | "unknown";
}

// --- Helper: Safe fetch with timeout ---
async function safeFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20s hard timeout

  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } catch (err) {
    console.warn("❌ safeFetch failed:", url, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Delay function (30s fallback retry waiting) ---
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main unified fetch function ---
export async function fetchStockData(symbol: string): Promise<StockData> {
  let response = null;

  try {
    // ---------- 1️⃣ Try main /api route (Yahoo first) ----------
    response = await safeFetch(`/api/stock?symbol=${symbol}`);
    if (response && response.current !== undefined) {
      return {
        ...response,
        lastUpdated: Date.now(),
        source: "yahoo",
      };
    }

    console.warn(`⚠ Yahoo data failed for ${symbol}, retrying...`);

    // ---------- 2️⃣ Delay before fallback ----------
    await delay(30000); // <-- 30 second pause before trying Finnhub

    // ---------- 3️⃣ Try Finnhub fallback ----------
    const finnhubURL = `/api/finnhub?symbol=${symbol}`;
    const finnhubData = await safeFetch(finnhubURL);

    if (finnhubData && finnhubData.current !== undefined) {
      return {
        ...finnhubData,
        lastUpdated: Date.now(),
        source: "finnhub",
      };
    }

    console.warn(`❌ Finnhub also failed for ${symbol}`);

  } catch (err) {
    console.error("fetchStockData error", err);
  }

  // ---------- 4️⃣ Final fallback (fail-safe) ----------
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
