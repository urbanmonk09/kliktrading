// src/pages/api/prices.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMultipleStockData } from "@/src/api/fetchStockData";

// Allowed providers
const allowedProviders = ["finnhub", "yahoo"] as const;
type ProviderType = (typeof allowedProviders)[number];

// Helper: validate provider
function resolveProvider(input: string | string[] | undefined): ProviderType {
  if (!input) return "yahoo"; // default provider

  const value = Array.isArray(input) ? input[0] : input.toLowerCase();

  return allowedProviders.includes(value as ProviderType)
    ? (value as ProviderType)
    : "yahoo";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Validate symbols
    const symbolsParam = req.query.symbols as string;
    if (!symbolsParam) {
      return res.status(400).json({ error: "No symbols provided" });
    }

    // Convert comma-separated list into array
    const symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase());

    // Determine provider safely
    const provider = resolveProvider(req.query.provider);

    console.log(
      `📡 Fetching ${symbols.length} symbols using provider: ${provider}`
    );

    const data = await fetchMultipleStockData(symbols);

    return res.status(200).json({
      success: true,
      provider,
      count: symbols.length,
      data,
    });
  } catch (err) {
    console.error("❌ API /prices error:", err);
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
}
