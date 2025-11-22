// src/lib/fetchYahooServer.ts
export default async function fetchYahooServer(symbols: string[]) {
  try {
    if (!Array.isArray(symbols) || symbols.length === 0) return [];

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Yahoo API returned status ${res.status}`);

    const data = await res.json();
    return data.quoteResponse?.result ?? [];
  } catch (err: any) {
    console.error("Error fetching Yahoo Finance:", err);
    return [];
  }
}
