import { NextRequest, NextResponse } from "next/server";
import yahooFinance from "yahoo-finance";

type StockData = {
  current: number;
  previousClose: number;
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  error?: string;
};

type FetchResponse = Record<string, StockData>;

export async function POST(req: NextRequest) {
  try {
    // Ensure the request body is properly parsed as JSON
    const { symbols } = await req.json();
    console.log('Received symbols:', symbols); // Log for debugging

    // Validate symbols
    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json({ error: "Invalid symbols, must be an array." }, { status: 400 });
    }

    const result: FetchResponse = {};

    // Process each symbol
    await Promise.all(
      symbols.map(async (symbol: string) => {
        try {
          // Fetch the quote for the symbol
          const quote = await yahooFinance.quote({
            symbol,
            modules: ["price", "summaryDetail", "financialData"], // Fetching relevant modules
          });

          console.log(`Quote data for ${symbol}:`, quote);  // Log the entire quote data for debugging

          // Fetch 1-month daily historical prices
          const history = await yahooFinance.historical({
            symbol,
            period: "1mo",
            interval: "1d",
          });

          console.log(`Historical data for ${symbol}:`, history);  // Log the historical data for debugging

          const prices = (history?.map((h: any) => h.close).filter((p: any) => p != null) as number[]) || [];
          const highs = (history?.map((h: any) => h.high).filter((p: any) => p != null) as number[]) || [];
          const lows = (history?.map((h: any) => h.low).filter((p: any) => p != null) as number[]) || [];
          const volumes = (history?.map((h: any) => h.volume).filter((v: any) => v != null) as number[]) || [];

          // Check if quote price data exists
          const currentPrice = quote.price?.regularMarketPrice ?? 0;
          const previousClose = quote.price?.regularMarketPreviousClose ?? 0;

          console.log(`Current Price for ${symbol}:`, currentPrice); // Log current price for debugging
          console.log(`Previous Close for ${symbol}:`, previousClose); // Log previous close for debugging

          result[symbol] = {
            current: currentPrice,
            previousClose: previousClose,
            prices,
            highs,
            lows,
            volumes,
          };
        } catch (err) {
          console.error(`Failed to fetch ${symbol}:`, err);
          result[symbol] = { current: 0, previousClose: 0, prices: [], highs: [], lows: [], volumes: [], error: "Fetch failed" };
        }
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("Yahoo API error:", err);
    return NextResponse.json({ error: "Failed to fetch Yahoo data" }, { status: 500 });
  }
}

// For testing or information about the API
export async function GET() {
  return NextResponse.json({ message: "Use POST with symbols in body" });
}
