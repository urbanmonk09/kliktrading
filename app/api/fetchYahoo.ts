// pages/api/fetchYahoo.ts
import type { NextApiRequest, NextApiResponse } from "next";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v7/finance/quote";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbols = req.query.symbols as string;

  if (!symbols) return res.status(400).json({ error: "symbols query param required" });

  try {
    const response = await fetch(`${YAHOO_BASE}?symbols=${encodeURIComponent(symbols)}`);
    if (!response.ok) throw new Error(`Yahoo Finance fetch failed with ${response.status}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err: any) {
    console.error("API fetchYahoo error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch Yahoo Finance data" });
  }
}
