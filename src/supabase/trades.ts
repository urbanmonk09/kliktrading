// src/supabase/trades.ts

import { supabase } from "@/src/lib/supabaseClient";

/*
|-------------------------------------------------------------------------- 
| Interfaces (unchanged)
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

  hitPrice?: number | null;
  hitTargetIndex?: number | null;
}

export interface TargetHitPayload extends TradePayload {
  hitPrice: number;
  hitTargetIndex: number;
}

/*
|-------------------------------------------------------------------------- 
| 1) Save or Update Active Trade — FIXED
|-------------------------------------------------------------------------- 
*/
export default async function saveTradeToSupabase(payload: TradePayload) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const supaUser = auth?.user;
    if (!supaUser?.id) return null;

    // fetch existing active trade
    const { data: existingActive } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", supaUser.id)
      .eq("symbol", payload.symbol)
      .eq("status", "active");

    const existing = existingActive?.[0] ?? null;

    /*
    |------------------------------------------------------------
    | IMPORTANT FIX
    |------------------------------------------------------------
    | If payload contains hitPrice or hitTargetIndex:
    | → Do NOT update existing "active"
    | → Insert a NEW row instead
    |------------------------------------------------------------
    */
    const isTargetHit = !!payload.hitPrice || !!payload.hitTargetIndex;

    if (isTargetHit) {
      // create a new target-hit record
      return await saveTargetHitToSupabase({
        ...payload,
        hitPrice: payload.hitPrice!,
        hitTargetIndex: payload.hitTargetIndex!,
      });
    }

    // build normal trade data
    const tradeData: any = {
      user_id: supaUser.id,
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

      hit_price: null,
      hit_target_index: null,
      hit_timestamp: null,
    };

    // update existing active trade (normal case)
    if (existing?.id) {
      const { data, error } = await supabase
        .from("trades")
        .update(tradeData)
        .eq("id", existing.id)
        .eq("user_id", supaUser.id)
        .select();

      if (error) {
        console.error("🔴 Error updating trade:", error);
        return null;
      }

      return data?.[0] ?? null;
    }

    // insert new active trade if none exist
    const { data, error } = await supabase.from("trades").insert(tradeData).select();

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
| 2) Save Target Hit — Always inserts new row (unchanged)
|-------------------------------------------------------------------------- 
*/
export async function saveTargetHitToSupabase(payload: TargetHitPayload) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const supaUser = auth?.user;

    if (!supaUser?.id) return null;

    const tradeData: any = {
      user_id: supaUser.id,
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
      timestamp: payload.timestamp ?? Date.now(),

      hit_price: payload.hitPrice,
      hit_target_index: payload.hitTargetIndex,
      hit_timestamp: Date.now(),
    };

    const { data, error } = await supabase.from("trades").insert(tradeData).select();

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
