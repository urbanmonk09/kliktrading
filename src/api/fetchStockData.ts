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

// Fetch + fallback + timeout
export async function fetchStockData(symbol: string): Promise<StockData> {
  try {
    // Timeout using Axios CancelToken
    const source = axios.CancelToken.source();
    const timeout = setTimeout(() => {
      source.cancel(`Request timed out for ${symbol}`);
    }, 15000); // 15 seconds

    const url = `/api/stock?symbol=${encodeURIComponent(symbol)}`;
    const res = await axios.get(url, { cancelToken: source.token });
    clearTimeout(timeout);

    const data = res.data as StockData;

    // Use previousClose as fallback if current price is missing
    const price = data.current ?? data.previousClose ?? 0;

    return {
      ...data,
      current: price,
      lastUpdated: Date.now(),
    };
  } catch (err: any) {
    if (axios.isCancel(err)) {
      console.warn("fetchStockData timeout:", symbol, err.message);
    } else {
      console.warn("fetchStockData failed:", symbol, err);
    }

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
