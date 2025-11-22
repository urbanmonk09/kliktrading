// app/api/finnhub/route.ts
import { NextRequest, NextResponse } from "next/server";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY!;
const CACHE_DURATION = 30 * 1000; // 30s client-side cache
const CHUNK_SIZE = 10; // fetch symbols in batches to avoid rate limits

let priceCache: Record<string, any> = {};
let cacheTimestamp = 0;

// helper to fetch with timeout
const fetchWithTimeout = async (url: string, timeout = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
};

export async function POST(req: NextRequest) {
  try {
    const { symbols } = await req.json();
    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json({ error: "Invalid symbols" }, { status: 400 });
    }

    const now = Date.now();
    if (now - cacheTimestamp < CACHE_DURATION) {
      return NextResponse.json(priceCache);
    }

    const result: Record<string, any> = {};

    // chunking to respect API limits
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (symbol: string) => {
          try {
            const data = await fetchWithTimeout(
              `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`
            );
            result[symbol] = data;
          } catch (err) {
            console.error(`Failed to fetch ${symbol}:`, err);
            result[symbol] = { error: "Fetch failed" };
          }
        })
      );
    }

    priceCache = result;
    cacheTimestamp = now;

    return NextResponse.json(result);
  } catch (err) {
    console.error("Finnhub API error:", err);
    return NextResponse.json({ error: "Failed to fetch Finnhub data" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ message: "Use POST with symbols in body" });
}
