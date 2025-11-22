// src/supabase/markTargetHit.ts
import { saveTargetHitToSupabase } from "./trades";

interface MarkHitOptions {
  userEmail: string;
  symbol: string;
  type: "stock" | "crypto" | "index";
  direction: "long" | "short";
  entryPrice: number;
  stopLoss?: number | null;
  targets: number[];
  confidence: number;
  provider: string;
  note?: string;

  // NEW target hit info
  hitPrice: number;
  hitTargetIndex: number; // 1, 2, 3...
}

export async function markTargetHit(opts: MarkHitOptions) {
  try {
    const payload = {
      userEmail: opts.userEmail,
      symbol: opts.symbol,
      type: opts.type,
      direction: opts.direction,
      entryPrice: opts.entryPrice,
      stopLoss: opts.stopLoss ?? undefined, // ✅ fixed
      targets: opts.targets ?? [],
      confidence: opts.confidence,
      provider: opts.provider,
      note: opts.note ?? "",
      timestamp: Date.now(),

      // Important hit-specific fields
      hitPrice: opts.hitPrice,
      hitTargetIndex: opts.hitTargetIndex,
      status: "target_hit" as const,
    };

    const saved = await saveTargetHitToSupabase(payload);
    return saved;
  } catch (err) {
    console.error("🔥 markTargetHit() failed:", err);
    return null;
  }
}
