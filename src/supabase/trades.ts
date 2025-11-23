import { supabase } from "@/src/lib/supabaseClient";

export type TradeType = "stock" | "crypto" | "index" | "commodity";
export type Direction = "long" | "short";
export type TradeStatus = "open" | "closed" | "target_hit";

export interface TradePayload {
  userEmail: string;
  symbol: string;
  type: TradeType;
  direction: Direction;
  entryPrice: number;
  stopLoss?: number; // optional, undefined if not set
  targets?: number[];
  confidence: number;
  provider: string;
  note?: string;
  status: TradeStatus;
  timestamp: number;
  hitPrice?: number;
  hitTargetIndex?: number;
}

export interface TargetHitPayload extends TradePayload {
  status: "target_hit"; // must be this
  hitPrice: number;
  hitTargetIndex: number;
}

// -------------------- Save Trade --------------------
export async function saveTrade(payload: TradePayload) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return null;

    // If it's a target hit, call dedicated function
    if (payload.status === "target_hit") {
      if (!payload.hitPrice || !payload.hitTargetIndex) return null;
      return await saveTargetHit({
        ...payload,
        status: "target_hit",
        hitPrice: payload.hitPrice,
        hitTargetIndex: payload.hitTargetIndex,
      });
    }

    // Check if active trade exists
    const { data: existing } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .eq("symbol", payload.symbol)
      .eq("status", "open")
      .limit(1);

    const tradeData = {
      user_id: user.id,
      user_email: payload.userEmail,
      symbol: payload.symbol,
      type: payload.type,
      direction: payload.direction,
      entry_price: payload.entryPrice,
      stop_loss: payload.stopLoss ?? undefined,
      targets: payload.targets ?? undefined,
      confidence: payload.confidence,
      status: payload.status,
      provider: payload.provider,
      note: payload.note ?? "",
      timestamp: payload.timestamp,
      hit_price: null,
      hit_target_index: null,
      hit_timestamp: null,
    };

    if (existing?.length) {
      const { data, error } = await supabase
        .from("trades")
        .update(tradeData)
        .eq("id", existing[0].id)
        .select();
      if (error) {
        console.error("Supabase update failed:", error);
        return null;
      }
      return data?.[0] ?? null;
    }

    const { data, error } = await supabase
      .from("trades")
      .insert([tradeData])
      .select();
    if (error) {
      console.error("Supabase insert failed:", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (err) {
    console.error("saveTrade() failed:", err);
    return null;
  }
}

// -------------------- Save Target Hit --------------------
export async function saveTargetHit(payload: TargetHitPayload) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return null;

    const tradeData = {
      user_id: user.id,
      user_email: payload.userEmail,
      symbol: payload.symbol,
      type: payload.type,
      direction: payload.direction,
      entry_price: payload.entryPrice,
      stop_loss: payload.stopLoss ?? undefined,
      targets: payload.targets ?? undefined,
      confidence: payload.confidence,
      status: "target_hit",
      provider: payload.provider,
      note: payload.note ?? "",
      timestamp: payload.timestamp ?? Date.now(),
      hit_price: payload.hitPrice,
      hit_target_index: payload.hitTargetIndex,
      hit_timestamp: Date.now(),
    };

    const { data, error } = await supabase
      .from("trades")
      .insert([tradeData])
      .select();
    if (error) {
      console.error("Supabase insert (target hit) failed:", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (err) {
    console.error("saveTargetHit() failed:", err);
    return null;
  }
}
