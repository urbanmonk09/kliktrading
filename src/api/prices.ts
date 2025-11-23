import type { NextApiRequest, NextApiResponse } from "next";
import { fetchMultipleStockData } from "@/src/api/fetchStockData";

// Main API handler to fetch live stock prices (from Yahoo or Finnhub)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Extract symbols from query string (comma-separated)
  const symbolsParam = req.query.symbols as string;
  if (!symbolsParam) {
    // If no symbols provided, return a 400 error
    return res.status(400).json({ error: "No symbols provided" });
  }

  // Split the symbols into an array (e.g., "AAPL,GOOGL" => ["AAPL", "GOOGL"])
  const symbols = symbolsParam.split(",");

  // You can choose the provider dynamically (either "finnhub" or "yahoo")
  const provider: "finnhub" | "yahoo" = req.query.provider === "yahoo" ? "yahoo" : "finnhub";

  try {
    // Fetch the stock data using the selected provider
    const data = await fetchMultipleStockData(symbols, provider);

    // Return the fetched data as JSON response
    res.status(200).json(data);
  } catch (err) {
    console.error("API /prices error:", err);

    // Return error response if something goes wrong
    res.status(500).json({ error: "Failed to fetch prices" });
  }
}
