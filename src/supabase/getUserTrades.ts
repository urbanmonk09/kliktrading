// src/supabase/getUserTrades.ts

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
  hit_timestamp?: number | null;
}

// ---------------------------------------------
// ⭐ Fetch ALL Trades for a user
// ---------------------------------------------
export async function getUserTrades(email: string): Promise<TradeRecord[]> {
  try {
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_email", email)
      .order("timestamp", { ascending: false });

    if (error) {
      console.error("🔴 Supabase Fetch Error (getUserTrades):", error);
      return [];
    }

    return data ?? [];
  } catch (err) {
    console.error("🔥 Unexpected Error (getUserTrades):", err);
    return [];
  }
}

// ---------------------------------------------
// ⭐ Fetch the last 2 Trades where target was hit
// ---------------------------------------------
export async function getTargetHitTrades(userEmail: string) {
  try {
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("user_email", userEmail)
      .eq("status", "target_hit")
      .order("timestamp", { ascending: false })
      .limit(2);

    if (error) {
      console.error("🔴 Supabase Error (targetHitTrades):", error);
      return [];
    }

    return data ?? [];
  } catch (err) {
    console.error("🔥 Unexpected Error (targetHitTrades):", err);
    return [];
  }
}
