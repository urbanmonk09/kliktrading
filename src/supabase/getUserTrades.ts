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

// -------------------------------------------------
// Fetch ALL trades for a user
// -------------------------------------------------
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

// -------------------------------------------------
// Fetch last 2 trades where target hit
// -------------------------------------------------
export async function getTargetHitTrades(
  userEmail: string
): Promise<TradeRecord[]> {
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

// -------------------------------------------------
// Save Notification
// -------------------------------------------------
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

// -------------------------------------------------
// Save Trade (WITH TYPE-SAFE CLEANING 🎯)
// -------------------------------------------------
// -------------------------------------------------
// Save Trade (WITH DETAILED ERROR LOGGING)
// -------------------------------------------------
export async function saveTradeToSupabase(
  trade: Partial<TradeRecord>
): Promise<TradeRecord | null> {
  try {
    // Get current user email (required for RLS)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      console.error("🔴 Auth Error: Cannot get logged-in user email", userError);
      return null;
    }

    // Inject user_email (required for insert)
    const tradeWithEmail = {
      ...trade,
      user_email: trade.user_email ?? user.email,
    };

    // Prevent undefined values
    const cleanedTrade = Object.fromEntries(
      Object.entries(tradeWithEmail).filter(([_, v]) => v !== undefined)
    );

    console.log("🟡 Saving trade:", cleanedTrade);

    const { data, error } = await supabase
      .from("trades")
      .insert([cleanedTrade]) // 👈 MUST be array
      .select();

    if (error) {
      console.error(
        "🔴 Supabase Error (saveTradeToSupabase):",
        JSON.stringify(error, null, 2)
      );
      return null;
    }

    if (!data) {
      console.error("🔴 No data returned by Supabase (possible RLS issue)");
      return null;
    }

    return data[0] ?? null;
  } catch (err) {
    console.error("🔥 Unexpected Error (saveTradeToSupabase):", err);
    return null;
  }
}
