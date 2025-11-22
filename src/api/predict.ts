// src/pages/api/predict.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { generateSMCSignal } from "@/src/utils/xaiLogic";
import { policyFromContext, RLContext } from "@/src/utils/rlAgent";
import { fetchStockData } from "@/src/api/fetchStockData";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function savePredictionToSupabase(payload: any) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/predictions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("savePredictionToSupabase failed", err);
  }
}

// Helper to ensure trendBias matches RLContext literal type
function parseTrendBias(explanation?: string): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (!explanation) return "NEUTRAL";
  if (explanation.includes("BULLISH")) return "BULLISH";
  if (explanation.includes("BEARISH")) return "BEARISH";
  return "NEUTRAL";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { symbol, userEmail } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });

    // Fetch candles & stock data
    const stockData = await fetchStockData(symbol);
    const prices = stockData.prices ?? [];
    const highs = stockData.highs ?? [];
    const lows = stockData.lows ?? [];
    const volumes = stockData.volumes ?? [];
    const current = stockData.current ?? stockData.previousClose ?? 0;
    const prevClose = stockData.previousClose ?? current;

    // Get baseline SMC + indicators
    const baseline = generateSMCSignal({
      symbol,
      current,
      previousClose: prevClose,
      prices,
      highs,
      lows,
      volumes,
    });

    // Build RLContext
    const context: RLContext = {
      rsi: (baseline.explanation && /RSI:([0-9]+)/.exec(baseline.explanation)?.[1])
        ? Number(/RSI:([0-9]+)/.exec(baseline.explanation)![1])
        : stockData.rsi ?? 50,

      ema50: stockData.ema50 ?? 0,
      ema200: stockData.ema200 ?? 0,
      sma20: stockData.sma20 ?? 0,
      trendBias: parseTrendBias(baseline.explanation),
      smcConfidence: baseline.confidence ?? 50,
      signal: "HOLD", // default, RL will override
    };

    // Run RL policy
    const rl = await policyFromContext(context);

    // Prepare prediction payload
    const prediction = {
      user_email: userEmail ?? null,
      symbol,
      model_version: "qtable-latest",
      signal: rl.signal,
      confidence: rl.confidence,
      context: { baseline, context, rlState: rl.state, qvals: rl.qvals },
    };

    // Store prediction in Supabase
    await savePredictionToSupabase(prediction);

    // Return response to client
    return res.status(200).json({ ...prediction, explanation: baseline.explanation });

  } catch (err: any) {
    console.error("predict error", err);
    return res.status(500).json({ error: err.message || "predict failed" });
  }
}
