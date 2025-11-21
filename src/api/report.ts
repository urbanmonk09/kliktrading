// src/pages/api/report.ts
import type { NextApiRequest, NextApiResponse } from "next";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function insertTradeHistory(row: any) {
  await fetch(`${SUPABASE_URL}/rest/v1/trade_history`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([row]),
  });
}

async function markPredictionResolved(predictionId: string) {
  if (!predictionId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/predictions?id=eq.${predictionId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ resolved: true }),
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { predictionId, symbol, entryPrice, exitPrice, outcome, durationSeconds, metadata } = req.body;
    if (!predictionId || !symbol) return res.status(400).json({ error: "missing fields" });

    // compute reward as simple net pct
    const reward = Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));

    await insertTradeHistory({
      prediction_id: predictionId,
      symbol,
      entry_price: entryPrice,
      exit_price: exitPrice,
      outcome,
      reward,
      duration_seconds: durationSeconds ?? 0,
      metadata: metadata ?? {},
    });

    await markPredictionResolved(predictionId);

    return res.status(200).json({ ok: true, reward });
  } catch (err: any) {
    console.error("report error", err);
    return res.status(500).json({ error: err.message || "report failed" });
  }
}
