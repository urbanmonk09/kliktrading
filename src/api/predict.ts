// src/pages/api/predict.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { generateSMCSignal } from "@/src/utils/xaiLogic";
import { policyFromContext } from "@/src/utils/rlAgent";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { symbol, userEmail } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });

    // fetch candles using your existing fetchStockData (normalize to arrays)
    const { fetchStockData } = await import("@/src/api/fetchStockData");
    const data = await fetchStockData(symbol); // should return { prices:[], highs:[], lows:[], volumes:[], current, previousClose }
    const prices = data.prices ?? [];
    const highs = data.highs ?? [];
    const lows = data.lows ?? [];
    const volumes = data.volumes ?? [];
    const current = data.current ?? data.previousClose ?? 0;
    const prevClose = data.previousClose ?? current;

    // get baseline SMC + indicators
    const baseline = generateSMCSignal({
      symbol,
      current,
      previousClose: prevClose,
      prices,
      highs,
      lows,
      volumes,
    });

    // Build context for RL policy (must align with rlAgent.stateFromContext)
    const context = {
      rsi: (baseline.explanation && /RSI:([0-9]+)/.exec(baseline.explanation)?.[1]) ? Number(/RSI:([0-9]+)/.exec(baseline.explanation)![1]) : 50,
      ema50: 0,
      ema200: 0,
      trendBias: baseline.explanation?.includes("BULLISH") ? "BULLISH" : baseline.explanation?.includes("BEARISH") ? "BEARISH" : "NEUTRAL",
      smcConfidence: baseline.confidence ?? 50,
      sma20: 0,
    };

    const rl = await policyFromContext(context);

    const prediction = {
      user_email: userEmail ?? null,
      symbol,
      model_version: "qtable-latest",
      signal: rl.signal,
      confidence: rl.confidence,
      context: { baseline, context, rlState: rl.state, qvals: rl.qvals },
    };

    // store in supabase predictions
    await savePredictionToSupabase(prediction);

    // return result to client, include an id? We don't have insert return here; client can search latest if needed.
    return res.status(200).json({ ...prediction, explanation: baseline.explanation });
  } catch (err: any) {
    console.error("predict error", err);
    return res.status(500).json({ error: err.message || "predict failed" });
  }
}
