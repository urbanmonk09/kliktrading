// src/supabase/trades.ts

import { supabase } from "@/src/lib/supabaseClient";

/*
|--------------------------------------------------------------------------
| Interfaces
|--------------------------------------------------------------------------
*/
export interface TradePayload {
  userEmail: string;
  symbol: string;
  type: "stock" | "crypto" | "index";
  direction: "long" | "short";
  entryPrice: number;
  stopLoss?: number | null;
  targets?: number[] | null;
  confidence: number;
  status: "active" | "target_hit" | "stop_loss";
  provider: string;
  note?: string;
  timestamp: number;
}

export interface TargetHitPayload extends TradePayload {
  hitPrice: number;           // price at which target was hit
  hitTargetIndex: number;     // which target number was hit (1, 2, 3)
}

/*
|--------------------------------------------------------------------------
| 1) Save New Trade or Update Existing Active Trade
|--------------------------------------------------------------------------
*/
export default async function saveTradeToSupabase(payload: TradePayload) {
  try {
    // ⭐ 1. Get authenticated user (Required for RLS)
    const { data: auth } = await supabase.auth.getUser();
    const supaUser = auth?.user;
    if (!supaUser?.id) {
      console.error("❌ No authenticated user found — cannot save trade.");
      return null;
    }

    // ⭐ 2. Check if an active trade already exists for this symbol
    const { data: existingActive, error: fetchErr } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", supaUser.id)
      .eq("symbol", payload.symbol)
      .eq("status", "active");

    if (fetchErr) {
      console.error("🔴 Error fetching existing trade:", fetchErr);
    }

    const existing = existingActive?.[0] ?? null;

    // ⭐ 3. Build data to insert/update
    const tradeData = {
      user_id: supaUser.id, // REQUIRED for RLS
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

      // New fields for unified schema
      hit_price: null,
      hit_target_index: null,
      hit_timestamp: payload.status !== "active" ? Date.now() : null,
    };

    // ⭐ 4. Update existing active trade → only if status="active"
    if (existing?.id) {
      const { data, error } = await supabase
        .from("trades")
        .update(tradeData)
        .eq("id", existing.id)
        .eq("user_id", supaUser.id) // required for RLS
        .select();

      if (error) {
        console.error("🔴 Error updating trade:", error);
        return null;
      }

      return data?.[0] ?? null;
    }

    // ⭐ 5. Insert new active trade
    const { data, error } = await supabase
      .from("trades")
      .insert(tradeData)
      .select();

    if (error) {
      console.error("🔴 Error inserting new trade:", error);
      return null;
    }

    return data?.[0] ?? null;
  } catch (err) {
    console.error("🔥 saveTradeToSupabase() Error:", err);
    return null;
  }
}

/*
|--------------------------------------------------------------------------
| 2) Save Target Hits (Insert NEW ROW for each hit)
|--------------------------------------------------------------------------
|
| This creates a FULL NEW trade row with:
|   - hit_price
|   - hit_target_index
|   - hit_timestamp
|   - status = "target_hit"
|
| This allows the Watchlist page to show Top 2–3 previous trades.
|--------------------------------------------------------------------------
*/
export async function saveTargetHitToSupabase(payload: TargetHitPayload) {
  try {
    // ⭐ 1. Get auth user
    const { data: auth } = await supabase.auth.getUser();
    const supaUser = auth?.user;

    if (!supaUser?.id) {
      console.error("❌ No authenticated user found — cannot save target hit.");
      return null;
    }

    // ⭐ 2. Build new row
    const tradeData = {
      user_id: supaUser.id, // REQUIRED for RLS
      user_email: payload.userEmail,
      symbol: payload.symbol,
      type: payload.type,
      direction: payload.direction,
      entry_price: payload.entryPrice,
      stop_loss: payload.stopLoss ?? null,
      targets: payload.targets ?? null,
      confidence: payload.confidence,
      status: "target_hit",
      provider: payload.provider,
      note: payload.note ?? "",

      // Original trade timestamp
      timestamp: payload.timestamp,

      // ⭐ TARGET HIT DATA ⭐
      hit_price: payload.hitPrice,
      hit_target_index: payload.hitTargetIndex,
      hit_timestamp: Date.now(),
    };

    // ⭐ 3. INSERT new row (never update)
    const { data, error } = await supabase
      .from("trades")
      .insert(tradeData)
      .select();

    if (error) {
      console.error("🔴 Error inserting target hit trade:", error);
      return null;
    }

    return data?.[0] ?? null;
  } catch (err) {
    console.error("🔥 saveTargetHitToSupabase() Error:", err);
    return null;
  }
}
