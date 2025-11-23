// src/api/fetchStockData.ts

export type Provider = "yahoo" | "finnhub";

export interface StockData {
  symbol: string;
  current: number;
  previousClose: number;
  prices?: number[];
  highs?: number[];
  lows?: number[];
  volumes?: number[];
  error?: string;
}

// Finnhub API 🔑
const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY || "";

// Throttle settings (Yahoo & Finnhub)
const REQUEST_DELAY = 1500; // 1.5 sec per request
const FINNHUB_DELAY = 2000; // safer throttle for crypto

// Simple sleep helper
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

//
// ------------------ ERROR HANDLER ------------------
//
const handleFetchError = (error: string, symbol: string): StockData => ({
  symbol,
  current: 0,
  previousClose: 0,
  prices: [],
  highs: [],
  lows: [],
  volumes: [],
  error,
});

//
// ------------------ YAHOO SYMBOL FORMATTER ------------------
//
function resolveYahooSymbol(symbol: string): string {
  let clean = symbol.replace(/^NSE:/, "");

  // Gold futures support
  if (clean === "GC=F" || clean === "XAUUSD=X") return clean;

  // Indices already valid (example: ^NIFTY50)
  if (clean.startsWith("^")) return clean;

  // Crypto never goes via Yahoo
  if (clean.includes("BTC") || clean.includes("ETH") || clean.includes("USDT")) return clean;

  // Default — NSE equities
  return `${clean}.NS`;
}

//
// ------------------ FINNHUB FETCH ------------------
//
async function fetchFinnhub(symbol: string): Promise<StockData> {
  if (!FINNHUB_API_KEY)
    return handleFetchError("Finnhub API key missing", symbol);

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);

    const data = await res.json();

    return {
      symbol,
      current: data.c ?? 0,
      previousClose: data.pc ?? data.c ?? 0,
      prices: [],
      highs: [data.h ?? 0],
      lows: [data.l ?? 0],
      volumes: [],
      error: "",
    };
  } catch (err) {
    console.error(`Finnhub fetch error for ${symbol}:`, err);
    return handleFetchError("Fetch failed", symbol);
  }
}

//
// ------------------ YAHOO FETCH ------------------
//
async function fetchYahoo(symbol: string): Promise<StockData> {
  try {
    const yahooSymbol = resolveYahooSymbol(symbol);

    const res = await fetch("/api/yahooStock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [yahooSymbol] }),
    });

    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

    const json = await res.json();
    const data = json[yahooSymbol];

    if (!data) return handleFetchError("No data received", symbol);

    return {
      symbol,
      current: data.current ?? data.previousClose ?? 0,
      previousClose: data.previousClose ?? 0,
      prices: data.prices ?? [],
      highs: data.highs ?? [],
      lows: data.lows ?? [],
      volumes: data.volumes ?? [],
      error: "",
    };
  } catch (err) {
    console.error(`Yahoo fetch error for ${symbol}:`, err);
    return handleFetchError("Fetch failed", symbol);
  }
}

//
// ------------------ AUTO ROUTED FETCH ------------------
//
export async function fetchStockData(
  symbol: string,
  provider?: Provider
): Promise<StockData> {

  // Auto-detection if provider isn't manually passed
  const chosenProvider: Provider =
    provider ??
    (symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("USDT")
      ? "finnhub"
      : "yahoo");

  return chosenProvider === "finnhub"
    ? fetchFinnhub(symbol)
    : fetchYahoo(symbol);
}

//
// ------------------ MULTI FETCH (WITH THROTTLE + AUTO PROVIDER) ------------------
//
export async function fetchMultipleStockData(
  symbols: string[]
): Promise<StockData[]> {
  const result: StockData[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];

    // Auto-provider routing for each symbol individually
    const provider: Provider = symbol.includes("BTC") || symbol.includes("ETH")
      ? "finnhub"
      : "yahoo";

    const data = await fetchStockData(symbol, provider);
    result.push(data);

    // Enforce throttling depending on provider
    await sleep(provider === "finnhub" ? FINNHUB_DELAY : REQUEST_DELAY);
  }

  return result;
}
