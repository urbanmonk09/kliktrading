// src/lib/supabaseTrades.ts
import { supabase } from "@/src/lib/supabaseClient";

/**
 * getUserTrades(userEmail) -> returns array of trades
 */
export async function getUserTrades(userEmail: string) {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase getUserTrades error:", error);
    return [];
  }
  return data ?? [];
}

/**
 * saveTradeToFirestore(trade) -> persists trade
 * We keep the function name to preserve your existing imports.
 */
export async function saveTradeToFirestore(trade: any) {
  try {
    const payload = {
      user_email: trade.userEmail,
      symbol: trade.symbol,
      type: trade.type,
      direction: trade.direction,
      entry_price: trade.entryPrice ?? null,
      stop_loss: trade.stopLoss ?? null,
      targets: trade.targets ?? null,
      confidence: trade.confidence ?? 0,
      status: trade.status ?? "active",
      provider: trade.provider ?? null,
      note: trade.note ?? trade.explanation ?? null,
      timestamp: trade.timestamp ?? Date.now(),
    };

    const { data, error } = await supabase.from("trades").insert(payload).select();

    if (error) {
      console.error("saveTradeToFirestore error:", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (err) {
    console.error("saveTradeToFirestore catch:", err);
    return null;
  }
}
