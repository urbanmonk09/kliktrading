"use client";

import React, { useEffect, useState, useRef } from "react";
import StockCard from "../components/StockCard";
import { generateSMCSignal, StockDisplay } from "../src/utils/xaiLogic";
import NotificationToast from "../components/NotificationToast";
import { useRouter } from "next/navigation";

import { supabase } from "../src/lib/supabaseClient";
import saveTradeToSupabase, { saveTargetHitToSupabase } from "@/src/supabase/trades";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades";

// ------------------- IMPORT NEW QUANT AI MODULES -------------------
import { RL } from "../src/quant/rlModel";
import { applyAdaptiveConfidence } from "../src/quant/confidenceEngine";

const homeSymbols = {
  stock: ["RELIANCE.NS", "TCS.NS", "INFY.NS"],
  index: ["^NSEI", "^NSEBANK"],
  crypto: ["BTC/USD", "ETH/USD"],
  commodity: ["XAU/USD"],
};

// ------------------- FIXED TIMESTAMP -------------------
const getSignalTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
};
const FIXED_SIGNAL_TIMESTAMP = getSignalTimestamp();

export default function Home() {
  const [stockData, setStockData] = useState<StockDisplay[]>([]);
  const [livePrices, setLivePrices] = useState<
    Record<string, { price: number; previousClose: number; lastUpdated: number }>
  >({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockDisplay[]>([]);
  const [toast, setToast] = useState<any>(null);

  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrade, setTargetHitTrade] = useState<any | null>(null);

  const lastSignalsRef = useRef<Record<string, string>>({});
  const router = useRouter();
  const userEmail = supabaseUser?.email ?? "";

  // ------------------- AUTH LISTENER -------------------
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (data?.user) {
        setSupabaseUser(data.user);
        setSavedTrades(await getUserTrades(data.user.email!));
        const hit = await getTargetHitTrades(data.user.email!);
        if (hit.length > 0) setTargetHitTrade(hit[0]);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setSupabaseUser(session.user);
        setSavedTrades(await getUserTrades(session.user.email!));
        const hit = await getTargetHitTrades(session.user.email!);
        if (hit.length > 0) setTargetHitTrade(hit[0]);
      } else {
        setSupabaseUser(null);
        setSavedTrades([]);
        setTargetHitTrade(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ------------------- LOAD LAST SIGNAL CACHE -------------------
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem("lastSignals");
        lastSignalsRef.current = raw ? JSON.parse(raw) : {};
      }
    } catch {}
  }, []);

  // ------------------- SYMBOL CONVERSION -------------------
  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  // ------------------- FETCH LIVE PRICES -------------------
  const fetchLivePrices = async () => {
    const allSymbols = [
      ...homeSymbols.stock,
      ...homeSymbols.index,
      ...homeSymbols.crypto,
      ...homeSymbols.commodity,
    ];

    try {
      const response = await fetch(`/api/prices?symbols=${allSymbols.map(apiSymbol).join(",")}`);
      const data = await response.json();
      const now = Date.now();
      const updated: any = {};

      allSymbols.forEach((s) => {
        updated[s] = {
          price: data[apiSymbol(s)]?.price ?? 0,
          previousClose: data[apiSymbol(s)]?.previousClose ?? 0,
          lastUpdated: now,
        };
      });

      setLivePrices(updated);
    } catch {
      setToast({ msg: "Failed to fetch live prices", bg: "bg-red-500" });
    }
  };

  useEffect(() => {
    fetchLivePrices();
    const i = setInterval(fetchLivePrices, 10000);
    return () => clearInterval(i);
  }, []);

  // ------------------- SAVE + NOTIFY + RL LEARNING -------------------
  const maybeNotifyAndSave = async (
    symbol: string,
    provider: string,
    trade: any,
    prevClose: number,
    currentPrice?: number
  ) => {
    // Normalize signals
    const normalizedSignal =
      trade.signal === "BUY" || trade.signal === "SELL"
        ? trade.signal
        : trade.signal === "long"
        ? "BUY"
        : trade.signal === "short"
        ? "SELL"
        : "HOLD";

    if (lastSignalsRef.current[symbol] === normalizedSignal) return;
    lastSignalsRef.current[symbol] = normalizedSignal;
    localStorage.setItem("lastSignals", JSON.stringify(lastSignalsRef.current));

    // Toast UI
    setToast({
      msg: `${normalizedSignal} signal on ${symbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
      currentPrice,
      stoploss: trade.stoploss,
      targets: trade.targets,
      timestamp: FIXED_SIGNAL_TIMESTAMP,
    });

    // Browser Notification
    if (supabaseUser && "Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission();
      if (Notification.permission === "granted") {
        new Notification(`${normalizedSignal} Trade Signal: ${symbol}`);
      }
    }

    if (!supabaseUser?.email || currentPrice === undefined) return;

    let status: "active" | "target_hit" | "stop_loss" = "active";

    if (trade.targets && currentPrice >= Math.max(...trade.targets)) {
      status = "target_hit";
      RL.update(symbol, "WIN"); // <-- Reinforcement learning
    } else if (trade.stoploss && currentPrice <= trade.stoploss) {
      status = "stop_loss";
      RL.update(symbol, "LOSS");
    }

    if (status === "target_hit") {
      // compute safe hitTargetIndex
      let hitIndex = 1;
      if (Array.isArray(trade.targets) && trade.targets.length) {
        // find the highest target that is <= currentPrice and get its 1-based index
        for (let i = trade.targets.length - 1; i >= 0; i--) {
          if (currentPrice >= trade.targets[i]) {
            hitIndex = i + 1;
            break;
          }
        }
      }

      await saveTargetHitToSupabase({
        userEmail,
        symbol,
        type: symbol.includes(".NS") ? "stock" : symbol.includes("/") ? "crypto" : "index",
        direction: normalizedSignal === "BUY" ? "long" : "short",
        entryPrice: prevClose,
        stopLoss: trade.stoploss,
        targets: trade.targets,
        confidence: trade.confidence ?? 0,
        status: "target_hit",
        provider,
        timestamp: FIXED_SIGNAL_TIMESTAMP,
        hitPrice: currentPrice,
        hitTargetIndex: hitIndex,
      });

      return;
    }

    await saveTradeToSupabase({
      userEmail,
      symbol,
      type: symbol.includes(".NS") ? "stock" : symbol.includes("/") ? "crypto" : "index",
      direction: normalizedSignal === "BUY" ? "long" : "short",
      entryPrice: prevClose,
      confidence: trade.confidence ?? 0,
      status,
      provider,
      timestamp: FIXED_SIGNAL_TIMESTAMP,
    });
  };

  // ------------------- LOAD DATA (AI DECISION LOOP) -------------------
  const loadData = async () => {
    setLoading(true);
    const out: StockDisplay[] = [];

    for (const [type, symbols] of Object.entries(homeSymbols)) {
      let best: StockDisplay | null = null;

      for (const symbol of symbols) {
        try {
          const lp = livePrices[symbol];
          const prev = lp?.previousClose ?? 0;
          const price = lp?.price ?? prev;

          const smc = generateSMCSignal({
            symbol,
            current: price,
            previousClose: prev,
            ohlc: {
              open: prev * 0.998,
              high: price * 1.006,
              low: price * 0.994,
              close: price,
            },
            history: {
              prices: [prev * 0.985, prev * 0.992, prev * 1.002, prev * 0.998, prev, price],
              highs: [
                prev * 1.01,
                prev * 1.008,
                prev * 1.005,
                prev * 1.003,
                prev * 1.002,
                price * 1.006,
              ],
              lows: [prev * 0.98, prev * 0.985, prev * 0.992, prev * 0.995, prev * 0.997, price * 0.994],
              volumes: [100000, 150000, 220000, 300000, 390000, 450000],
            },
          });

          // -------- Adaptive RL Confidence Applied --------
          const rlWeight = RL.getWeight(symbol);
          const adaptiveConfidence = applyAdaptiveConfidence(smc.confidence, rlWeight);

          // -------- Stoploss + Targeting (unchanged original logic) --------
          const stoploss =
            smc.signal === "BUY" ? prev * 0.991 : smc.signal === "SELL" ? prev * 1.009 : prev;

          const targets =
            smc.signal === "BUY"
              ? [prev * 1.01, prev * 1.02, prev * 1.03]
              : smc.signal === "SELL"
              ? [prev * 0.99, prev * 0.98, prev * 0.97]
              : [prev];

          const stock: StockDisplay = {
            symbol: symbol.replace(".NS", ""),
            signal: smc.signal,
            confidence: adaptiveConfidence,
            explanation: smc.explanation,
            price,
            type: type as any,
            support: prev * 0.995,
            resistance: prev * 1.01,
            stoploss,
            targets,
            hitStatus:
              price >= Math.max(...targets) ? "TARGET ✅" : price <= stoploss ? "STOP ❌" : "ACTIVE",
          };

          if (!best || stock.confidence > best.confidence) best = stock;

          // Send signal + learn outcome
          await maybeNotifyAndSave(symbol, "quant-ai", stock, prev, price);
        } catch {}
      }

      if (best) out.push(best);
    }

    // -------- Display last trade that hit target --------
    if (targetHitTrade) {
      out.push({
        symbol: targetHitTrade.symbol,
        signal: "BUY",
        confidence: 100,
        explanation: "Target hit previously",
        price: targetHitTrade.entryPrice ?? 0,
        type: "stock",
        support: targetHitTrade.entryPrice ?? 0,
        resistance: targetHitTrade.entryPrice ?? 0,
        stoploss: targetHitTrade.stopLoss ?? 0,
        targets: targetHitTrade.targets ?? [],
        hitStatus: "TARGET ✅",
      });
    }

    setStockData(out);
    setLoading(false);
  };

  // ------------------- RUN AI LOOP CONTINUOUSLY -------------------
  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, [Object.keys(livePrices).length]);

  // ------------------- SEARCH -------------------
  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ msg: "Pro membership required!", bg: "bg-red-600" });
      return;
    }

    const term = search.trim().toLowerCase();
    if (!term) return setSearchResults(stockData);

    setSearchResults(stockData.filter((s) => s.symbol.toLowerCase().includes(term)));
  };

  // ------------------- UI -------------------
  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* Toast */}
      {toast && <NotificationToast {...toast} onClose={() => setToast(null)} />}

      <div className="mb-4">
        <button
          onClick={() => {
            if (!supabaseUser) {
              setToast({ msg: "Please login first!", bg: "bg-red-600" });
              return;
            }
            router.push("/watchlist");
          }}
          className="bg-yellow-500 text-white px-4 py-2 rounded"
        >
          Pro Watchlist
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!supabaseUser}
          placeholder="Search (Pro only)"
          className="flex-1 p-2 rounded border"
        />
        <button onClick={handleSearch} className="px-4 py-2 rounded text-white bg-blue-500">
          Search
        </button>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        (searchResults.length ? searchResults : stockData).map((s) => <StockCard key={s.symbol} {...s} />)
      )}
    </div>
  );
}
