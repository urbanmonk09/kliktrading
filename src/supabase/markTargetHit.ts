// src/supabase/markTargetHit.ts
import { saveTargetHit, TargetHitPayload } from "./trades";

export interface MarkHitOptions {
  userEmail: string;
  symbol: string;
  type: "stock" | "crypto" | "index" | "commodity";
  direction: "long" | "short";
  entryPrice: number;
  stopLoss?: number; // ✅ make undefined instead of null
  targets: number[];
  confidence: number;
  provider: string;
  note?: string;

  // Target hit info
  hitPrice: number;
  hitTargetIndex: number; // 1, 2, 3...
}

export async function markTargetHit(opts: MarkHitOptions) {
  try {
    const payload: TargetHitPayload = {
      userEmail: opts.userEmail,
      symbol: opts.symbol,
      type: opts.type,
      direction: opts.direction,
      entryPrice: opts.entryPrice,
      stopLoss: opts.stopLoss, // ✅ undefined is allowed
      targets: opts.targets,
      confidence: opts.confidence,
      provider: opts.provider,
      note: opts.note ?? "",
      timestamp: Date.now(),

      hitPrice: opts.hitPrice,
      hitTargetIndex: opts.hitTargetIndex,
      status: "target_hit", // ✅ force correct type
    };

    const saved = await saveTargetHit(payload);
    return saved;
  } catch (err) {
    console.error("🔥 markTargetHit() failed:", err);
    return null;
  }
}
