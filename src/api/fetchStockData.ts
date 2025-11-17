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
  source?: "finnhub" | "yahoo" | "unknown";
}

// Fetch + fallback
export async function fetchStockData(symbol: string): Promise<StockData> {
  try {
    const url = `/api/stock?symbol=${encodeURIComponent(symbol)}`;
    const res = await axios.get(url);
    const data = res.data as StockData;

    // If market closed → fallback to previous close
    const price = data.current ?? data.previousClose ?? 0;

    return {
      ...data,
      current: price,
      lastUpdated: Date.now(),
    };
  } catch (err) {
    console.warn("fetchStockData failed", symbol, err);
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
