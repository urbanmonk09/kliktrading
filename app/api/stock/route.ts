// app/api/stock/route.ts
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;

// 3-minute rolling counters
let lastReset = Date.now();
let yahooCount = 0;
let finnhubCount = 0;

function resetCounters() {
  if (Date.now() - lastReset >= 180000) {
    yahooCount = 0;
    finnhubCount = 0;
    lastReset = Date.now();
  }
}

function isCrypto(symbol: string) {
  return symbol.endsWith("-USD") && symbol !== "GC=F";
}

function isGold(symbol: string) {
  return symbol === "XAUUSD" || symbol === "GC=F";
}

function isStock(symbol: string) {
  return (
    symbol.endsWith(".NS") ||
    symbol.endsWith(".BO") ||
    symbol.includes("NSE") ||
    symbol.includes("BSE")
  );
}

export async function GET(req: NextRequest) {
  resetCounters();

  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  if (!symbol)
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  // FORCE PROVIDERS BASED ON RULES
  let provider: "yahoo" | "finnhub" = "finnhub";

  if (isCrypto(symbol) || isGold(symbol)) provider = "yahoo";
  else if (isStock(symbol)) provider = "finnhub";

  // Apply 50% rule
  if (provider === "yahoo" && yahooCount >= 30) provider = "finnhub";
  if (provider === "finnhub" && finnhubCount >= 30) provider = "yahoo";

  try {
    // -------------------- FINNHUB --------------------
    if (provider === "finnhub") {
      finnhubCount++;

      const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
      const res = await axios.get(url);
      const d = res.data;

      return NextResponse.json({
        symbol,
        current: d.c ?? null,
        high: d.h ?? null,
        low: d.l ?? null,
        open: d.o ?? null,
        previousClose: d.pc ?? null,
        prices: [],
        highs: [],
        lows: [],
        volumes: [],
        lastUpdated: Date.now(),
        source: "finnhub",
      });
    }

    // -------------------- YAHOO FINANCE --------------------
    if (provider === "yahoo") {
      yahooCount++;

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}`;
      const res = await axios.get(url);

      const result = res.data.chart.result?.[0];
      const meta = result?.meta;
      const quote = result?.indicators?.quote?.[0] ?? {};

      return NextResponse.json({
        symbol,
        current: meta?.regularMarketPrice ?? null,
        high: meta?.chartHigh ?? null,
        low: meta?.chartLow ?? null,
        open: meta?.chartOpen ?? null,
        previousClose: meta?.chartPreviousClose ?? null,
        prices: quote.close ?? [],
        highs: quote.high ?? [],
        lows: quote.low ?? [],
        volumes: quote.volume ?? [],
        lastUpdated: Date.now(),
        source: "yahoo",
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        symbol,
        current: null,
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
      },
      { status: 200 }
    );
  }
}
