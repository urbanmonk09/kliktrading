// src/utils/xaiLogic.ts
// Combined RSI + EMA indicator logic + Smart Money Concept (SMC) confluence confidence engine.
// Clean, typed, and null-safe. Logic intended to replace your current xaiLogic implementation
// while preserving existing return shapes and not changing external behavior other than improved confidence.

export interface StockData {
  symbol: string;
  current: number;
  previousClose: number;

  // Full OHLC candle
  ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
  };

  // Core data structure used primarily by SMC + RSI + EMA
  history?: {
    prices: number[];    // closing prices
    highs: number[];     // high values
    lows: number[];      // low values
    volumes: number[];   // volume data
  };

  /** ---- Backward compatibility ----
   * You already have code that expects these directly.
   * This prevents TypeScript errors without rewriting logic.
   */
  prices?: number[];
  highs?: number[];
  lows?: number[];
  volumes?: number[];
}




// =========================================================
// --- Indicator Helpers (SMA, EMA, RSI) ---
// =========================================================

export function calculateSMA(data: number[], period: number): number {
  if (!Array.isArray(data) || data.length === 0) return 0;
  if (data.length < period) return data[data.length - 1] ?? 0;
  const slice = data.slice(-period);
  let sum = 0;
  for (let i = 0; i < slice.length; i++) sum += slice[i];
  return sum / slice.length;
}

export function calculateEMA(data: number[], period: number): number {
  if (!Array.isArray(data) || data.length === 0) return 0;
  const k = 2 / (period + 1);
  // Start ema at first value (common quick method)
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calculateRSI(data: number[], period = 14): number {
  if (!Array.isArray(data) || data.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  const start = Math.max(1, data.length - period);
  for (let i = start; i < data.length; i++) {
    const diff = data[i] - (data[i - 1] ?? data[i]);
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// =========================================================
// --- SMC Detection Helpers ---
// =========================================================

export function detectFairValueGap(highs: number[], lows: number[]): boolean {
  if (!highs?.length || !lows?.length) return false;
  if (highs.length < 3 || lows.length < 3) return false;
  const i = highs.length - 3;
  const prevHigh = highs[i];
  const nextLow = lows[i + 2];
  if (!isFinite(prevHigh) || !isFinite(nextLow) || prevHigh === 0) return false;
  return Math.abs(nextLow - prevHigh) / Math.abs(prevHigh) > 0.005;
}

export function detectOrderBlock(prices: number[]): "BULLISH" | "BEARISH" | null {
  if (!prices?.length || prices.length < 5) return null;
  const lastFive = prices.slice(-5);
  const avg = lastFive.reduce((a, b) => a + b, 0) / lastFive.length;
  const recent = prices[prices.length - 1];
  if (!isFinite(recent) || !isFinite(avg)) return null;
  if (recent > avg * 1.01) return "BULLISH";
  if (recent < avg * 0.99) return "BEARISH";
  return null;
}

export function detectVolumeSurge(volumes: number[]): boolean {
  if (!volumes?.length || volumes.length < 10) return false;
  const last10 = volumes.slice(-10);
  const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
  const latest = last10[last10.length - 1];
  if (!isFinite(latest) || !isFinite(avg)) return false;
  return latest > avg * 1.5;
}

export function detectLiquiditySweep(
  highs: number[],
  lows: number[],
  current: number
): "BULLISH" | "BEARISH" | null {
  if (!highs?.length || !lows?.length) return null;
  if (highs.length < 5 || lows.length < 5) return null;
  const recentHigh = Math.max(...highs.slice(-6, -1));
  const recentLow = Math.min(...lows.slice(-6, -1));
  const penultimateHigh = highs[highs.length - 2];
  const penultimateLow = lows[lows.length - 2];
  if (!isFinite(current) || !isFinite(recentHigh) || !isFinite(recentLow)) return null;
  if (current > recentHigh * 1.001 && current < penultimateHigh) return "BEARISH";
  if (current < recentLow * 0.999 && current > penultimateLow) return "BULLISH";
  return null;
}

export function detectMitigationBlock(prices: number[]): "BULLISH" | "BEARISH" | null {
  if (!prices?.length || prices.length < 6) return null;
  const last = prices[prices.length - 1];
  const prevLow = Math.min(...prices.slice(-6, -2));
  const prevHigh = Math.max(...prices.slice(-6, -2));
  if (!isFinite(last) || !isFinite(prevLow) || !isFinite(prevHigh)) return null;
  if (last > prevLow * 1.02 && last < prevHigh) return "BULLISH";
  if (last < prevHigh * 0.98 && last > prevLow) return "BEARISH";
  return null;
}

export function detectBreakerBlock(prices: number[]): "BULLISH" | "BEARISH" | null {
  if (!prices?.length || prices.length < 10) return null;
  const prev5 = prices.slice(-10, -5);
  const last5 = prices.slice(-5);
  const prevHigh = Math.max(...prev5);
  const prevLow = Math.min(...prev5);
  const currHigh = Math.max(...last5);
  const currLow = Math.min(...last5);
  if (!isFinite(prevHigh) || !isFinite(prevLow) || !isFinite(currHigh) || !isFinite(currLow)) return null;
  if (currHigh > prevHigh && currLow > prevLow) return "BULLISH";
  if (currLow < prevLow && currHigh < prevHigh) return "BEARISH";
  return null;
}

export function detectBOS(highs: number[], lows: number[]): "BULLISH" | "BEARISH" | null {
  if (!highs?.length || !lows?.length) return null;
  if (highs.length < 6 || lows.length < 6) return null;
  const prevHigh = highs[highs.length - 3];
  const currHigh = highs[highs.length - 1];
  const prevLow = lows[lows.length - 3];
  const currLow = lows[lows.length - 1];
  if (!isFinite(prevHigh) || !isFinite(currHigh) || !isFinite(prevLow) || !isFinite(currLow)) return null;
  if (currHigh > prevHigh * 1.002) return "BULLISH";
  if (currLow < prevLow * 0.998) return "BEARISH";
  return null;
}

export function detectCHoCH(highs: number[], lows: number[]): "BULLISH" | "BEARISH" | null {
  if (!highs?.length || !lows?.length) return null;
  if (highs.length < 8 || lows.length < 8) return null;
  const lastHigh = highs[highs.length - 1];
  const secondLastHigh = highs[highs.length - 3];
  const lastLow = lows[lows.length - 1];
  const secondLastLow = lows[lows.length - 3];
  if (!isFinite(lastHigh) || !isFinite(secondLastHigh) || !isFinite(lastLow) || !isFinite(secondLastLow)) return null;
  const brokeHigh = lastHigh > secondLastHigh * 1.001;
  const brokeLow = lastLow < secondLastLow * 0.999;
  if (brokeHigh && !brokeLow) return "BULLISH";
  if (brokeLow && !brokeHigh) return "BEARISH";
  return null;
}

// =========================================================
// --- SMC Confidence Engine & Helpers ---
// =========================================================

type SMCInputs = {
  bos: "BULLISH" | "BEARISH" | null;
  choch: "BULLISH" | "BEARISH" | null;
  orderBlock: "BULLISH" | "BEARISH" | null;
  liquiditySweep: "BULLISH" | "BEARISH" | null;
  mitigation: "BULLISH" | "BEARISH" | null;
  breaker: "BULLISH" | "BEARISH" | null;
  hasFVG: boolean;
  volumeSurge: boolean;
  fibZone: "PREMIUM" | "DISCOUNT" | "NEUTRAL";
  trendBias: "BULLISH" | "BEARISH" | "NEUTRAL";
};

// Weighted scoring for SMC confluence only (0-100)
export function computeSMCConfidence(inputs: SMCInputs): number {
  const {
    bos,
    choch,
    orderBlock,
    liquiditySweep,
    mitigation,
    breaker,
    hasFVG,
    volumeSurge,
    fibZone,
    trendBias,
  } = inputs;

  let score = 0;

  // Market structure: biggest single factors
  if (bos === "BULLISH" || bos === "BEARISH") score += 22;
  if (choch === "BULLISH" || choch === "BEARISH") score += 20;

  // Liquidity / volume
  if (liquiditySweep) score += 12;
  if (volumeSurge) score += 10;

  // Order blocks / mitigation / breaker
  if (orderBlock) score += 10;
  if (mitigation) score += 8;
  if (breaker) score += 6;

  // Fair value gap
  if (hasFVG) score += 5;

  // Fib zone alignment bonus (premium/discount)
  if (fibZone === "DISCOUNT" && trendBias === "BULLISH") score += 10;
  if (fibZone === "PREMIUM" && trendBias === "BEARISH") score += 10;

  return Math.min(Math.round(score), 99);
}

export function getTrendBias(bos: string | null, choch: string | null): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (bos === "BULLISH" || choch === "BULLISH") return "BULLISH";
  if (bos === "BEARISH" || choch === "BEARISH") return "BEARISH";
  return "NEUTRAL";
}

export function getFibZone(current: number, lookbackHigh: number, lookbackLow: number) {
  if (!isFinite(current) || !isFinite(lookbackHigh) || !isFinite(lookbackLow)) return "NEUTRAL";
  const mid = lookbackLow + (lookbackHigh - lookbackLow) * 0.5;
  if (current < mid) return "DISCOUNT";
  if (current > mid) return "PREMIUM";
  return "NEUTRAL";
}

// =========================================================
// --- Signal & Computation (Combined Indicators + SMC) ---
// =========================================================

export interface SignalResult {
  signal: "BUY" | "SELL" | "HOLD";
  stoploss: number;
  targets: number[];
  confidence: number;
  explanation: string;
  hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌";
  entryPrice?: number;
  finalPrice?: number;
  resolved?: boolean;
  resolvedAt?: string;
}

export function generateSMCSignal(stock: StockData): SignalResult {
  const current = stock.current ?? 0;
  const prevClose = stock.previousClose ?? current;
  const prices = stock.prices ?? [];
  const highs = stock.highs ?? [];
  const lows = stock.lows ?? [];
  const volumes = stock.volumes ?? [];

  // Basic indicators (retain SMA/EMA/RSI presence)
  const sma20 = calculateSMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);
  const ema200 = calculateEMA(prices, 200);
  const rsi = calculateRSI(prices, 14);
  const change = prevClose !== 0 ? ((current - prevClose) / prevClose) * 100 : 0;

  // SMC detections
  const hasFVG = detectFairValueGap(highs, lows);
  const orderBlock = detectOrderBlock(prices);
  const volumeSurge = detectVolumeSurge(volumes);
  const liquiditySweep = detectLiquiditySweep(highs, lows, current);
  const bos = detectBOS(highs, lows);
  const choch = detectCHoCH(highs, lows);
  const mitigation = detectMitigationBlock(prices);
  const breaker = detectBreakerBlock(prices);

  // Trend bias & fib zone (20-period lookback on highs/lows if available)
  const trendBias = getTrendBias(bos, choch);
  const lookbackHigh = highs.length ? Math.max(...highs.slice(-20)) : current;
  const lookbackLow = lows.length ? Math.min(...lows.slice(-20)) : current;
  const fibZone = getFibZone(current, lookbackHigh, lookbackLow);

  // --- Indicator scoring (RSI + EMA/SMA) ---
  // This yields 0-40 points
  let indicatorScore = 0;
  // Price vs SMA/EMA context
  const aboveSMA20 = current > sma20;
  const aboveEMA50 = current > ema50;
  const emaBullish = ema50 > ema200;
  const emaBearish = ema50 < ema200;

  // momentum via RSI (soft thresholds)
  const rsiBull = rsi < 70 && rsi > 40; // momentum but not overbought
  const rsiSellSignal = rsi > 30 && rsi < 60 ? false : false; // placeholder — we'll use strict thresholds below

  // Strong buy indicator: price above SMA20 & EMA50, ema50>ema200, positive change, rsi not overbought
  const indicatorBuy =
    aboveSMA20 && aboveEMA50 && emaBullish && rsi < 70 && change > 0;
  // Strong sell indicator: price below SMA20 & EMA50, ema50<ema200, negative change, rsi not oversold
  const indicatorSell =
    !aboveSMA20 && !aboveEMA50 && emaBearish && rsi > 30 && change < 0;

  // assign points
  if (indicatorBuy) indicatorScore += 28; // bulk points for indicator agreement
  if (indicatorSell) indicatorScore += 28;

  // supportive points for partial agreement
  if (aboveSMA20 && aboveEMA50) indicatorScore += 6;
  if (emaBullish) indicatorScore += 4;
  if (rsi < 60) indicatorScore += 2;
  if (rsi > 40) indicatorScore += 2;

  // combine SMC confidence
  const smcConfidence = computeSMCConfidence({
    bos,
    choch,
    orderBlock,
    liquiditySweep,
    mitigation,
    breaker,
    hasFVG,
    volumeSurge,
    fibZone,
    trendBias,
  });

  // final confidence: weighted average: indicators 40%, SMC 60%
  const finalConfidence = Math.min(
    99,
    Math.round((indicatorScore * 0.4) + (smcConfidence * 0.6))
  );

  // Determine final signal — only emit BUY/SELL when both indicator context + SMC bias align.
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  // Determine bias from SMC (prefer BOS/CHoCH)
  const smcBias = trendBias; // "BULLISH" | "BEARISH" | "NEUTRAL"

  // Condition to BUY:
  // - indicatorBuy (price + ema trend + rsi) OR indicatorScore partial positive
  // - and SMC bias bullish (or strong SMC score)
  const smcStrongBull = smcConfidence >= 55 && (bos === "BULLISH" || choch === "BULLISH");
  const smcStrongBear = smcConfidence >= 55 && (bos === "BEARISH" || choch === "BEARISH");

  if ((indicatorBuy || indicatorScore >= 18) && (smcBias === "BULLISH" || smcStrongBull)) {
    signal = "BUY";
  } else if ((indicatorSell || indicatorScore >= 18) && (smcBias === "BEARISH" || smcStrongBear)) {
    signal = "SELL";
  } else {
    signal = "HOLD";
  }

  // Stoploss and targets unchanged from previous logic (keeps compatibility)
  const stoploss = signal === "BUY" ? current * 0.985 : signal === "SELL" ? current * 1.015 : current;
  const targets =
    signal === "BUY"
      ? [current * 1.01, current * 1.02, current * 1.03]
      : signal === "SELL"
      ? [current * 0.99, current * 0.98, current * 0.97]
      : [current];

  // Explanation - compact, includes both indicator + SMC summary
  const explanationParts: string[] = [];
  explanationParts.push(
    `Indicators: ${indicatorBuy ? "BUY" : indicatorSell ? "SELL" : "Neutral"} (SMA20:${sma20.toFixed(2)}, EMA50:${ema50.toFixed(2)}, EMA200:${ema200.toFixed(2)}, RSI:${Math.round(rsi)})`
  );
  explanationParts.push(
    `SMC: ${smcBias} (BOS:${bos ?? "None"}, CHoCH:${choch ?? "None"}, OB:${orderBlock ?? "None"}, FVG:${hasFVG ? "Yes" : "No"}, VolSurge:${volumeSurge ? "Yes" : "No"})`
  );
  explanationParts.push(`FibZone:${fibZone}, LookbackRange:[${lookbackLow.toFixed(2)} - ${lookbackHigh.toFixed(2)}]`);
  const explanation = explanationParts.join(" | ");

  return {
    signal,
    stoploss,
    targets,
    confidence: finalConfidence,
    explanation,
    hitStatus: "ACTIVE",
    entryPrice: current,
    resolved: false,
  };
}

// =========================================================
// --- StockDisplay Type for UI ---
// =========================================================

export type StockDisplay = {
  symbol: string;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  explanation: string;
  price?: number;
  type: "stock" | "index" | "crypto" | "commodity";
  support?: number;
  resistance?: number;
  stoploss?: number;
  targets?: number[];
  hitStatus?: "ACTIVE" | "TARGET ✅" | "STOP ❌";
};
