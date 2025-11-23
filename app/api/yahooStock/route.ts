import { NextRequest, NextResponse } from "next/server";

const RAPIDAPI_KEY = process.env.NEXT_PUBLIC_RAPIDAPI_KEY;

export async function POST(req: NextRequest) {
  try {
    const { symbols } = await req.json();

    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json({ error: "Invalid symbol format" }, { status: 400 });
    }

    const result: any = {};

    await Promise.all(
      symbols.map(async (symbol: string) => {
        try {
          const formatted = symbol.includes(":") ? symbol : `NASDAQ:${symbol}`;

          const url = `https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote?ticker=${formatted}`;

          const apiRes = await fetch(url, {
            method: "GET",
            headers: {
              "x-rapidapi-key": RAPIDAPI_KEY!,
              "x-rapidapi-host": "yahoo-finance15.p.rapidapi.com",
            },
            cache: "no-store",
          });

          const data = await apiRes.json();

          result[symbol] = {
            current: data?.price ?? 0,
            previousClose: data?.previousClose ?? 0,
          };
        } catch (err) {
          result[symbol] = { current: 0, previousClose: 0, error: "Fetch failed" };
        }
      })
    );

    return NextResponse.json(result);

  } catch (error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
