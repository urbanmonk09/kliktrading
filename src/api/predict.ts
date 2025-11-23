// src/api/predict.ts
import { NextApiRequest, NextApiResponse } from "next";
import { fetchStockData } from "./fetchStockData";
import { generateSMCSignal, StockData, StockDisplay } from "../utils/xaiLogic";

// --- List of symbols to predict for ---
const WATCHLIST = [
  "RELIANCE",
  "TCS",
  "INFY",
  "BTCUSDT",
  "ETHUSDT",
  "XAUUSD"
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const results: StockDisplay[] = [];

    // Loop through the watchlist
    for (const symbol of WATCHLIST) {
      console.log(`[Predict] Fetching data for ${symbol}`);

      let stock: StockData | null = null;

      try {
        stock = await fetchStockData(symbol, "finnhub");

        // Ensure numeric defaults and valid data
        if (stock) {
          stock.current = stock.current ?? 0;
          stock.previousClose = stock.previousClose ?? stock.current;
          stock.prices = stock.prices ?? [];
          stock.highs = stock.highs ?? [];
          stock.lows = stock.lows ?? [];
          stock.volumes = stock.volumes ?? [];
        }
      } catch (err) {
        console.error(`[Predict] Failed to fetch data for ${symbol}:`, err);
        continue; // Skip this symbol if data fetching fails
      }

      // Make sure data exists before proceeding
      if (!stock) {
        console.warn(`[Predict] Skipping ${symbol} due to invalid data.`);
        continue;
      }

      console.log(`[Predict] Generating SMC signal for ${symbol}`);
      const signalResult = generateSMCSignal(stock);

      const display: StockDisplay = {
        symbol,
        signal: signalResult.signal,
        confidence: signalResult.confidence,
        explanation: signalResult.explanation,
        price: stock.current,
        type: symbol.includes("USDT") ? "crypto" : symbol === "XAUUSD" ? "commodity" : "stock",
        stoploss: signalResult.stoploss,
        targets: signalResult.targets,
        hitStatus: signalResult.hitStatus,
      };

      console.log(`[Predict] Result for ${symbol}:`, display);
      results.push(display);
    }

    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error("[Predict] Error:", err);
    return res.status(500).json({ success: false, error: "Prediction failed" });
  }
}
