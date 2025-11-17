import { supabase } from "../lib/supabaseClient";

export interface TradeRecord {
  id: string;
  user_email: string;
  symbol: string;
  type: string;
  direction: string;
  entry_price: number;
  stop_loss: number | null;
  targets: number[] | null;
  confidence: number;
  status: string;
  provider: string;
  note: string;
  timestamp: number;
}

// --------------------------------------------------
// ⭐ Fetch ALL Trades for user
// --------------------------------------------------
export async function getUserTrades(email: string): Promise<TradeRecord[]> {
  try {
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_email", email)
      .order("timestamp", { ascending: false });

    if (error) {
      console.error("🔴 Supabase Fetch Error (getUserTrades):", error.message);
      return [];
    }

    return data ?? [];
  } catch (err: any) {
    console.error("🔥 Unexpected Error (getUserTrades):", err?.message || err);
    return [];
  }
}

// --------------------------------------------------
// ⭐ Fetch LAST 2 Trades where target was hit
// --------------------------------------------------
export async function getTargetHitTrades(userEmail: string) {
  try {
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_email", userEmail)          // FIXED COLUMN NAME
      .eq("status", "target_hit")           // TARGET HIT FILTER
      .order("timestamp", { ascending: false })
      .limit(2);

    if (error) {
      console.error("🔴 Supabase Error (targetHitTrades):", error.message);
      return [];
    }

    return data ?? [];
  } catch (err: any) {
    console.error("🔥 Unexpected Error (targetHitTrades):", err?.message || err);
    return [];
  }
}
