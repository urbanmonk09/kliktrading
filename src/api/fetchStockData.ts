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

// ---------------- ENV KEYS ----------------
const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY || "";

// ---------------- RATE LIMIT ----------------
const REQUEST_DELAY = 3000; // 60 calls per 3 mins ~ 3s per call
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// ---------------- GENERIC ERROR RESPONSE ----------------
const errorResponse = (symbol: string, msg: string): StockData => ({
  symbol,
  current: 0,
  previousClose: 0,
  prices: [],
  highs: [],
  lows: [],
  volumes: [],
  error: msg,
});

// ---------------- SYMBOL NORMALIZER ----------------
function formatSymbol(symbol: string) {
  let s = symbol.replace(/^NSE:/, "").replace(/\s+/g, "");

  // Crypto goes to Finnhub
  if (s.includes("BTC") || s.includes("ETH")) return s;

  // Index support
  if (s.startsWith("^")) return s;

  // NSE extension
  return `${s}.NS`;
}

// ---------------- YAHOO FINANCE ----------------
async function fetchYahoo(symbol: string): Promise<StockData> {
  try {
    const formatted = formatSymbol(symbol);

    const response = await fetch("/api/yahooStock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [formatted] }),
    });

    if (!response.ok) {
      return errorResponse(symbol, `Yahoo route failed (${response.status})`);
    }

    const json = await response.json();
    const entry = json[formatted] || json[symbol];
    if (!entry) return errorResponse(symbol, "No Yahoo data found");

    const previousClose = entry.previousClose || entry.close || entry.regularMarketPreviousClose || 0;
    const current = entry.current && entry.current > 0 ? entry.current : previousClose;

    return {
      symbol,
      current,
      previousClose,
      prices: entry.prices ?? [],
      highs: entry.highs ?? [],
      lows: entry.lows ?? [],
      volumes: entry.volumes ?? [],
      error: "",
    };
  } catch (err) {
    console.error(`Yahoo fetch error for ${symbol}`, err);
    return errorResponse(symbol, "Yahoo fetch failed");
  }
}

// ---------------- FINNHUB ----------------
async function fetchFinnhub(symbol: string): Promise<StockData> {
  if (!FINNHUB_API_KEY) return errorResponse(symbol, "Missing Finnhub key");

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    const current = data.c > 0 ? data.c : data.pc;

    return {
      symbol,
      current,
      previousClose: data.pc ?? current,
      prices: [],
      highs: [data.h ?? current],
      lows: [data.l ?? current],
      volumes: [],
      error: "",
    };
  } catch (err) {
    console.error(`Finnhub fetch error for ${symbol}`, err);
    return errorResponse(symbol, "Finnhub fetch failed");
  }
}

// ---------------- SINGLE FETCH ----------------
export async function fetchStockData(symbol: string, provider?: Provider): Promise<StockData> {
  const selectedProvider: Provider =
    provider ?? (symbol.includes("BTC") || symbol.includes("ETH") ? "finnhub" : "yahoo");

  return selectedProvider === "finnhub" ? fetchFinnhub(symbol) : fetchYahoo(symbol);
}

// ---------------- MULTIPLE SYMBOLS (parallel + throttling) ----------------
export async function fetchMultipleStockData(symbols: string[]): Promise<StockData[]> {
  const results: StockData[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const provider: Provider =
      symbol.includes("BTC") || symbol.includes("ETH") ? "finnhub" : "yahoo";

    const data = await fetchStockData(symbol, provider);
    results.push(data);

    // Throttle to 60 calls per 3 minutes
    if ((i + 1) % 60 === 0) await sleep(180_000);
    else await sleep(REQUEST_DELAY);
  }

  return results;
}
