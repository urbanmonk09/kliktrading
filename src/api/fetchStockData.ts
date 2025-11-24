// src/api/fetchStockData.ts
export type Provider = "yahoo" | "finnhub";

export interface StockData {
  symbol: string;
  current: number;
  previousClose: number;
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  error?: string;
}

// ---------------- ENV KEYS ----------------
const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY || "";
const YAHOO_RAPIDAPI_KEY = process.env.NEXT_PUBLIC_YAHOO_RAPIDAPI_KEY || "";

// ---------------- RATE LIMIT ----------------
const REQUEST_DELAY = 3000;
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// ---------------- ERROR RESPONSE ----------------
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
  if (symbol.includes("BTC") || symbol.includes("ETH")) return symbol;
  if (symbol.startsWith("^")) return symbol;
  return symbol.includes(".") ? symbol : `${symbol}.NS`;
}

// ---------------- YAHOO FINANCE ----------------
async function fetchYahoo(symbol: string): Promise<StockData> {
  try {
    const formatted = formatSymbol(symbol);

    // Fetch quotes
    const res = await fetch(
      `https://yh-finance.p.rapidapi.com/market/v2/get-quotes?region=IN&symbols=${formatted}`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": YAHOO_RAPIDAPI_KEY,
          "X-RapidAPI-Host": "yh-finance.p.rapidapi.com",
        },
      }
    );

    if (!res.ok) return errorResponse(symbol, `Yahoo quote failed (${res.status})`);
    const json = await res.json();
    const entry = json.quoteResponse?.result?.[0];
    if (!entry) return errorResponse(symbol, "Yahoo quote missing");

    const current = entry.regularMarketPrice ?? 0;
    const previousClose = entry.regularMarketPreviousClose ?? current;

    // Fetch historical OHLC
    const histRes = await fetch(
      `https://yh-finance.p.rapidapi.com/stock/v3/get-historical-data?symbol=${formatted}&region=IN`,
      {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": YAHOO_RAPIDAPI_KEY,
          "X-RapidAPI-Host": "yh-finance.p.rapidapi.com",
        },
      }
    );

    let prices: number[] = [];
    let highs: number[] = [];
    let lows: number[] = [];
    let volumes: number[] = [];

    if (histRes.ok) {
      const histJson = await histRes.json();
      const histData = histJson.prices ?? [];
      for (const day of histData) {
        if (day.close && day.open && day.high && day.low && day.volume) {
          prices.push(day.close);
          highs.push(day.high);
          lows.push(day.low);
          volumes.push(day.volume);
        }
      }
    }

    return { symbol, current, previousClose, prices, highs, lows, volumes, error: "" };
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

// ---------------- MULTIPLE SYMBOLS ----------------
export async function fetchMultipleStockData(symbols: string[]): Promise<StockData[]> {
  const results: StockData[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const provider: Provider =
      symbol.includes("BTC") || symbol.includes("ETH") ? "finnhub" : "yahoo";

    const data = await fetchStockData(symbol, provider);
    results.push(data);

    // Throttle
    if ((i + 1) % 60 === 0) await sleep(180_000);
    else await sleep(REQUEST_DELAY);
  }

  return results;
}
