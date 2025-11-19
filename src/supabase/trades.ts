import { supabase } from "@/src/lib/supabaseClient";

export interface TradePayload {
  userEmail: string;
  symbol: string;
  type: "stock" | "crypto" | "index";
  direction: "long" | "short";
  entryPrice: number;
  stopLoss?: number;
  targets?: number[];
  confidence: number;
  status: "active" | "target_hit" | "stop_loss";
  provider: string;
  note?: string;
  timestamp: number;
}

/**
 * Save or update a trade in Supabase
 * - Updates existing active trade for same user+symbol
 * - Inserts new trade if none exists
 */
export default async function saveTradeToSupabase(payload: TradePayload) {
  try {
    const { data: existingTrade, error: fetchError } = await supabase
      .from("trades")
      .select("*")
      .eq("user_email", payload.userEmail)
      .eq("symbol", payload.symbol)
      .eq("status", "active")
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Error fetching existing trade:", fetchError);
      return null;
    }

    const tradeData = {
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
      hit_timestamp: payload.status !== "active" ? Date.now() : null,
    };

    if (existingTrade?.id) {
      const { data, error } = await supabase
        .from("trades")
        .update(tradeData)
        .eq("id", existingTrade.id)
        .select();

      if (error) {
        console.error("Error updating trade:", error);
        return null;
      }
      return data?.[0] ?? null;
    } else {
      const { data, error } = await supabase.from("trades").insert(tradeData).select();
      if (error) {
        console.error("Error inserting trade:", error);
        return null;
      }
      return data?.[0] ?? null;
    }
  } catch (err) {
    console.error("saveTradeToSupabase catch:", err);
    return null;
  }
}
