import { supabase } from "../lib/supabaseClient";

export interface TradePayload {
  userEmail: string;
  symbol: string;
  type: "stock" | "crypto" | "index";
  direction: "long" | "short";
  entryPrice: number;
  stopLoss?: number;
  targets?: number[];
  confidence: number;
  status: string;
  provider: string;
  note?: string;
  timestamp: number;
}

export default async function saveTradeToSupabase(payload: TradePayload) {
  const { data, error } = await supabase.from("trades").insert([
    {
      user_email: payload.userEmail,
      symbol: payload.symbol,
      type: payload.type,
      direction: payload.direction,
      entry_price: payload.entryPrice,
      stop_loss: payload.stopLoss ?? null,
      targets: payload.targets ?? null,
      confidence: payload.confidence,
      status: payload.status,
      provider: payload.provider,
      note: payload.note ?? "",
      timestamp: payload.timestamp,
    },
  ]);

  if (error) {
    console.error("Supabase Save Error:", error);
    return null;
  }

  return data;
}
