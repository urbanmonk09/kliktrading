// src/supabase/getUserTrades.ts
import { supabase } from "../lib/supabaseClient";

export interface TradeRecord {
  id: string;
  user_email: string;
  symbol: string;
  type: "stock" | "crypto" | "index" | string;
  direction: "long" | "short" | "hold" | string;
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

export interface Notification {
  id?: string;
  user_email: string;
  symbol: string;
  signal: string;
  message: string;
  created_at?: string;
}

// ---------------------------------------------
// Fetch ALL trades for a user
// ---------------------------------------------
export async function getUserTrades(email: string): Promise<TradeRecord[]> {
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
}

// ---------------------------------------------
// Fetch last 2 trades where target hit
// ---------------------------------------------
export async function getTargetHitTrades(userEmail: string): Promise<TradeRecord[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("user_email", userEmail)
    .eq("status", "target_hit")
    .order("timestamp", { ascending: false })
    .limit(2);

  if (error) {
    console.error("🔴 Supabase Fetch Error (getTargetHitTrades):", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------
// Save Notification
// ---------------------------------------------
export async function saveNotification(
  user_email: string,
  symbol: string,
  signal: string,
  message: string
): Promise<Notification | null> {
  try {
    const { data, error } = await supabase
      .from("notifications")
      .insert([{ user_email, symbol, signal, message }])
      .select();

    if (error) {
      console.error("🔴 Supabase Error (saveNotification):", error);
      return null;
    }

    return data?.[0] ?? null;
  } catch (err) {
    console.error("🔥 Unexpected Error (saveNotification):", err);
    return null;
  }
}

// ---------------------------------------------
// Save Trade
// ---------------------------------------------
export async function saveTradeToSupabase(
  trade: Partial<TradeRecord>
): Promise<TradeRecord | null> {
  try {
    const { data, error } = await supabase
      .from("trades")
      .insert([trade])
      .select();

    if (error) {
      console.error("🔴 Supabase Error (saveTradeToSupabase):", error);
      return null;
    }

    return data?.[0] ?? null;
  } catch (err) {
    console.error("🔥 Unexpected Error (saveTradeToSupabase):", err);
    return null;
  }
}
