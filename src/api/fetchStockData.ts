export type Provider = "yahoo" | "finnhub";

export interface StockData {
  current: number;
  previousClose: number;
  prices?: number[];
  highs?: number[];
  lows?: number[];
  volumes?: number[];
  error?: string;
}

const FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY || "";

// Helper function to handle error cases
const handleFetchError = (error: string): StockData => ({
  current: 0,
  previousClose: 0,
  prices: [],
  highs: [],
  lows: [],
  volumes: [],
  error,
});

// Function to handle the Finnhub API fetch
async function fetchFinnhub(symbol: string): Promise<StockData> {
  if (!FINNHUB_API_KEY) {
    return handleFetchError("Finnhub API key missing");
  }

  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();

    return {
      current: typeof data.c === "number" ? data.c : 0,
      previousClose: typeof data.pc === "number" ? data.pc : data.c ?? 0,
      prices: [],
      highs: [data.h ?? 0],
      lows: [data.l ?? 0],
      volumes: [],
    };
  } catch (err) {
    console.error("Finnhub fetch error:", err);
    return handleFetchError("Fetch failed");
  }
}

// Function to handle the Yahoo API fetch
async function fetchYahoo(symbol: string): Promise<StockData> {
  try {
    // Remove any "NSE:" prefix from symbol
    let cleanSymbol = symbol.replace(/^NSE:/, "");

    // Add .NS for Indian stocks, ^ for indices, keep gold symbol as is
    let yahooSymbol = cleanSymbol;
    if (cleanSymbol === "XAUUSD=X") {
      yahooSymbol = cleanSymbol; // gold
    } else if (cleanSymbol.startsWith("^")) {
      yahooSymbol = cleanSymbol; // index
    } else {
      yahooSymbol = `${cleanSymbol}.NS`; // stock
    }

    const res = await fetch("/api/yahooStock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [yahooSymbol] }),
    });

    if (!res.ok) throw new Error(`HTTP error ${res.status}`);

    const json: Record<string, any> = await res.json();
    const data = json[yahooSymbol];

    if (!data) return { current: 0, previousClose: 0, prices: [], highs: [], lows: [], volumes: [], error: "No data" };

    // Use previousClose if current is zero or null
    const current = data.current && data.current !== 0 ? data.current : data.previousClose ?? 0;

    return {
      current,
      previousClose: data.previousClose ?? 0,
      prices: data.prices ?? [],
      highs: data.highs ?? [],
      lows: data.lows ?? [],
      volumes: data.volumes ?? [],
    };
  } catch (err) {
    console.error("Yahoo fetch error:", err);
    return { current: 0, previousClose: 0, prices: [], highs: [], lows: [], volumes: [], error: "Fetch failed" };
  }
}


// Main function to fetch stock data from either Finnhub or Yahoo
export async function fetchStockData(symbol: string, provider: Provider): Promise<StockData> {
  if (provider === "finnhub") return fetchFinnhub(symbol);
  return fetchYahoo(symbol);
}
