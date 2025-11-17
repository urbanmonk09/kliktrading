// src/utils/xaiLogic.ts
// Cleaned, typed, and null-safe version — logic unchanged

export interface StockData {
  symbol?: string;
  current?: number | null;
  previousClose?: number | null;
  prices?: number[]; // historical close prices
  highs?: number[];
  lows?: number[];
  volumes?: number[];
}

// =========================================================
// --- Indicator Helpers ---
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
// --- Signal & Computation ---
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

  const sma20 = calculateSMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);
  const rsi = calculateRSI(prices, 14);
  const change = prevClose !== 0 ? ((current - prevClose) / prevClose) * 100 : 0;

  const hasFVG = detectFairValueGap(highs, lows);
  const orderBlock = detectOrderBlock(prices);
  const volumeSurge = detectVolumeSurge(volumes);
  const liquiditySweep = detectLiquiditySweep(highs, lows, current);
  const bos = detectBOS(highs, lows);
  const choch = detectCHoCH(highs, lows);
  const mitigation = detectMitigationBlock(prices);
  const breaker = detectBreakerBlock(prices);

  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let confidence = 50;
  let explanation = "Neutral: waiting for confirmation.";

  if (current > sma20 && current > ema50 && rsi < 70 && change > 0) {
    signal = "BUY";
    confidence = 70;
    explanation = "Price above SMA20 & EMA50 with bullish momentum.";
    if (bos === "BULLISH") confidence += 10;
    if (choch === "BULLISH") confidence += 10;
    if (orderBlock === "BULLISH") confidence += 5;
    if (mitigation === "BULLISH") confidence += 5;
    if (breaker === "BULLISH") confidence += 5;
    if (hasFVG) confidence += 3;
    if (volumeSurge) confidence += 3;
    if (liquiditySweep === "BULLISH") confidence += 4;
  }

  if (current < sma20 && current < ema50 && rsi > 30 && change < 0) {
    signal = "SELL";
    confidence = 70;
    explanation = "Price below SMA20 & EMA50 with bearish momentum.";
    if (bos === "BEARISH") confidence += 10;
    if (choch === "BEARISH") confidence += 10;
    if (orderBlock === "BEARISH") confidence += 5;
    if (mitigation === "BEARISH") confidence += 5;
    if (breaker === "BEARISH") confidence += 5;
    if (hasFVG) confidence += 3;
    if (volumeSurge) confidence += 3;
    if (liquiditySweep === "BEARISH") confidence += 4;
  }

  confidence = Math.min(confidence, 99);

  const stoploss = signal === "BUY" ? current * 0.985 : signal === "SELL" ? current * 1.015 : current;
  const targets =
    signal === "BUY"
      ? [current * 1.01, current * 1.02, current * 1.03]
      : signal === "SELL"
      ? [current * 0.99, current * 0.98, current * 0.97]
      : [current];

  return {
    signal,
    stoploss,
    targets,
    confidence,
    explanation,
    hitStatus: "ACTIVE",
    entryPrice: current,
    resolved: false,
  };
}

// =========================================================
// --- Hit Status Update ---
// =========================================================

export interface HitStatusUpdate {
  hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌";
  resolved: boolean;
  finalPrice?: number;
  explanation?: string;
}

export function updateHitStatus(
  stock: {
    signal: "BUY" | "SELL" | "HOLD";
    stoploss: number;
    targets: number[];
    confidence: number;
    hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌";
    explanation: string;
    entryPrice?: number;
    finalPrice?: number;
    resolved?: boolean;
  },
  currentPrice: number
): HitStatusUpdate {
  let hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" = "ACTIVE";
  let resolved = stock.resolved ?? false;
  let finalPrice = stock.finalPrice;
  let explanation = stock.explanation;

  if (stock.signal === "BUY") {
    if (stock.targets.some(t => currentPrice >= t)) {
      hitStatus = "TARGET ✅";
      resolved = true;
      finalPrice = currentPrice;
      explanation = "Target hit for BUY.";
    } else if (currentPrice <= stock.stoploss) {
      hitStatus = "STOP ❌";
      resolved = true;
      finalPrice = currentPrice;
      explanation = "Stoploss hit for BUY.";
    }
  }

  if (stock.signal === "SELL") {
    if (stock.targets.some(t => currentPrice <= t)) {
      hitStatus = "TARGET ✅";
      resolved = true;
      finalPrice = currentPrice;
      explanation = "Target hit for SELL.";
    } else if (currentPrice >= stock.stoploss) {
      hitStatus = "STOP ❌";
      resolved = true;
      finalPrice = currentPrice;
      explanation = "Stoploss hit for SELL.";
    }
  }

  return { hitStatus, resolved, finalPrice, explanation };
}
// src/utils/xaiLogic.ts

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
