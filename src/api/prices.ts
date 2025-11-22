// server-side proxy to fetch live prices (Yahoo / Finnhub)
import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMultipleStockData } from "@/src/api/fetchStockData";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const symbolsParam = req.query.symbols as string;
  if (!symbolsParam) return res.status(400).json({ error: "No symbols provided" });

  const symbols = symbolsParam.split(",");

  try {
    const data = await fetchMultipleStockData(symbols);
    res.status(200).json(data);
  } catch (err) {
    console.error("API /prices error:", err);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
}
