// src/utils/rlAgent.ts
import fetch from "node-fetch";

export interface RLContext {
  rsi: number;
  ema50: number;
  ema200: number;
  trendBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  smcConfidence: number;
  sma20: number;
  signal: "BUY" | "SELL" | "HOLD";
}

// Q table type
type QTable = Record<string, number[]>;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Attempt to load weights from Supabase (optional).
 */
async function loadQTable(): Promise<QTable> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_weights?select=weights&id=eq.1`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!res.ok) return {};
    const json = await res.json();
    return json?.[0]?.weights ?? {};
  } catch {
    console.log("⚠️ No Q-table found, using fallback model.");
    return {};
  }
}

/**
 * Convert numerical context to a state key.
 */
function encodeState(ctx: RLContext) {
  const bucket = (v: number, steps: number[]) => {
    for (let i = 0; i < steps.length; i++) if (v <= steps[i]) return i;
    return steps.length;
  };

  const r = bucket(ctx.rsi, [30, 40, 50, 60, 70]);
  const trend = ctx.trendBias[0]; // B, S, N
  const smc = bucket(ctx.smcConfidence, [20, 40, 60, 80]);

  return `r${r}_t${trend}_smc${smc}`;
}

/**
 * Compute best action from q-values
 */
function bestAction(q: number[]) {
  const max = Math.max(...q);
  const idx = q.indexOf(max);
  const total = q.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const confidence = Math.round((max / total) * 100);
  return { action: idx, confidence };
}

/**
 * MAIN FUNCTION — This returns BUY/SELL/HOLD based on learned values or heuristic fallback.
 */
export async function policyFromContext(ctx: RLContext) {
  const qtable = await loadQTable();
  const state = encodeState(ctx);

  let qvals = qtable[state];

  // If the state is unknown — create heuristic default so RL can update later
  if (!qvals) {
    const bias = ctx.trendBias === "BULLISH" ? 2 : ctx.trendBias === "BEARISH" ? 0 : 1;
    const smcFactor = ctx.smcConfidence / 100;

    qvals = [
      smcFactor * (bias === 0 ? 1.2 : 0.7), // SELL
      smcFactor * 0.5,                      // HOLD
      smcFactor * (bias === 2 ? 1.3 : 0.8)  // BUY
    ];
  }

  const { action, confidence } = bestAction(qvals);

  const mapping: ("SELL" | "HOLD" | "BUY")[] = ["SELL", "HOLD", "BUY"];

  return {
    signal: mapping[action],
    confidence,
    qvals,
    state,
    mode: qtable && Object.keys(qtable).length > 0 ? "TRAINED" : "BOOTSTRAP",
  };
}
