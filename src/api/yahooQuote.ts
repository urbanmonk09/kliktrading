// src/pages/api/yahooQuote.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Missing symbols" });

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        symbols as string
      )}`
    );
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Yahoo Finance", details: err });
  }
}
