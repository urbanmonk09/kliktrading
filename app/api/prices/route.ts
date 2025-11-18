import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbols = searchParams.get("symbols");

  if (!symbols) return NextResponse.json({ error: "No symbols provided" }, { status: 400 });

  const symbolList = symbols.split(",");

  const results: Record<string, { price: number; previousClose: number }> = {};

  await Promise.all(
    symbolList.map(async (symbol) => {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
        const json = await res.json();
        const meta = json.chart?.result?.[0]?.meta;
        results[symbol] = {
          price: meta?.regularMarketPrice ?? 0,
          previousClose: meta?.chartPreviousClose ?? 0,
        };
      } catch {
        results[symbol] = { price: 0, previousClose: 0 };
      }
    })
  );

  return NextResponse.json(results);
}
