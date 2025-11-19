import { NextResponse } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

// In-memory cache to store recent prices
const priceCache: Record<
  string,
  { price: number; previousClose: number; source: "yahoo" | "finnhub" | "none"; timestamp: number }
> = {};

// Minimum cache duration in ms
const CACHE_DURATION = 15000; // 15 seconds

// Delay utility
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Map frontend symbols to Yahoo Finance symbols
const mapYahooSymbol = (symbol: string) => {
  if (symbol === "BTC/USD") return "BTC-USD";
  if (symbol === "ETH/USD") return "ETH-USD";
  if (symbol === "XAU/USD") return "GC=F";
  return symbol; // Stocks & Indices
};

// Map frontend symbols to Finnhub symbols
const mapFinnhubSymbol = (symbol: string) => {
  if (symbol === "BTC/USD") return "BINANCE:BTCUSDT";
  if (symbol === "ETH/USD") return "BINANCE:ETHUSDT";
  if (symbol === "XAU/USD") return "OANDA:XAUUSD";
  if (symbol.startsWith("^")) return `INDEX:${symbol}`; // Indices
  return `NSE:${symbol.replace(".NS", "")}`; // NSE Stocks
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get("symbols");

  if (!symbolsParam) {
    return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
  }

  const symbolList = symbolsParam.split(",");
  const results: Record<string, { price: number; previousClose: number; source: "yahoo" | "finnhub" | "none" }> =
    {};

  await Promise.all(
    symbolList.map(async (symbol, index) => {
      // Check cache first
      const cached = priceCache[symbol];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        results[symbol] = { ...cached };
        return;
      }

      const yahooSymbol = mapYahooSymbol(symbol);

      try {
        // Throttle Yahoo calls (optional, e.g., 200ms between calls)
        await delay(index * 200);

        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`
        );
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;

        results[symbol] = {
          price: meta?.regularMarketPrice ?? 0,
          previousClose: meta?.chartPreviousClose ?? 0,
          source: "yahoo",
        };

        // Update cache
        priceCache[symbol] = { ...results[symbol], timestamp: Date.now() };
      } catch (errYahoo) {
        console.warn(`Yahoo failed for ${symbol}:`, errYahoo);

        // Fallback to Finnhub
        try {
          if (!FINNHUB_KEY) throw new Error("Finnhub key missing");

          // Throttle Finnhub calls to max 1 per 3s
          await delay(index * 3000);

          const fhSymbol = mapFinnhubSymbol(symbol);
          const resFh = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${fhSymbol}&token=${FINNHUB_KEY}`
          );
          const jsonFh = await resFh.json();

          results[symbol] = {
            price: jsonFh.c ?? 0,
            previousClose: jsonFh.pc ?? 0,
            source: "finnhub",
          };

          // Update cache
          priceCache[symbol] = { ...results[symbol], timestamp: Date.now() };
        } catch (errFh) {
          console.error(`Finnhub failed for ${symbol}:`, errFh);
          results[symbol] = { price: 0, previousClose: 0, source: "none" };
        }
      }
    })
  );

  return NextResponse.json(results);
}
