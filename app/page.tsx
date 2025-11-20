"use client";

import React, { useEffect, useState, useRef } from "react";
import StockCard from "../components/StockCard";
import { generateSMCSignal, StockDisplay } from "../src/utils/xaiLogic";
import NotificationToast from "../components/NotificationToast";
import { useRouter } from "next/navigation";

import { supabase } from "../src/lib/supabaseClient";
import saveTradeToSupabase, { saveTargetHitToSupabase } from "@/src/supabase/trades";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades";

const homeSymbols = {
  stock: ["RELIANCE.NS", "TCS.NS", "INFY.NS"],
  index: ["^NSEI", "^NSEBANK"],
  crypto: ["BTC/USD", "ETH/USD"],
  commodity: ["XAU/USD"],
};

// ------------------- FIXED TIMESTAMP -------------------
// Signal timestamp fixed for entire day
const getSignalTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // midnight today
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
  const [toast, setToast] = useState<{
    msg: string;
    bg?: string;
    currentPrice?: number;
    stoploss?: number;
    targets?: number[];
    timestamp?: number;
  } | null>(null);

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

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
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
      }
    );

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

  // ------------------- SYMBOL MAPPING -------------------
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
      const response = await fetch(
        `/api/prices?symbols=${allSymbols.map(apiSymbol).join(",")}`
      );
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

  // ------------------- DUPLICATE TARGET-HIT CHECK -------------------
  const alreadyRecordedTargetHit = (
    symbol: string,
    hitIndex: number,
    hitPrice: number
  ) => {
    const norm = (s: string) => s?.replace?.(".NS", "");
    const clean = norm(symbol);

    for (const t of savedTrades) {
      if (norm(t.symbol) === clean && t.status === "target_hit") {
        if (t.hit_target_index === hitIndex) return true;
        if (t.hit_price === hitPrice) return true;
      }
    }
    return false;
  };

  // ------------------- SAVE + NOTIFY -------------------
  const maybeNotifyAndSave = async (
    symbol: string,
    provider: string,
    trade: any,
    prevClose: number,
    currentPrice?: number
  ) => {
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

    // ------------------- TOAST NOTIFICATION -------------------
    setToast({
      msg: `${normalizedSignal} signal on ${symbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
      currentPrice,
      stoploss: trade.stoploss,
      targets: trade.targets,
      timestamp: FIXED_SIGNAL_TIMESTAMP,
    });

    // ------------------- BROWSER NOTIFICATION -------------------
    if (supabaseUser && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(`${normalizedSignal} signal - ${symbol}`);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }

    if (!supabaseUser?.email || currentPrice === undefined) return;

    let status: "active" | "target_hit" | "stop_loss" = "active";

    if (trade.targets && currentPrice >= Math.max(...trade.targets)) {
      status = "target_hit";
    } else if (trade.stoploss && currentPrice <= trade.stoploss) {
      status = "stop_loss";
    }

    if (status === "target_hit") {
      let hitIndex = 1;
      if (Array.isArray(trade.targets)) {
        for (let i = trade.targets.length - 1; i >= 0; i--) {
          if (currentPrice >= trade.targets[i]) {
            hitIndex = i + 1;
            break;
          }
        }
      }

      if (alreadyRecordedTargetHit(symbol, hitIndex, currentPrice)) return;

      const saved = await saveTargetHitToSupabase({
        userEmail,
        symbol,
        type: symbol.includes(".NS")
          ? "stock"
          : symbol.includes("/")
          ? "crypto"
          : "index",
        direction: normalizedSignal === "BUY" ? "long" : "short",
        entryPrice: prevClose,
        stopLoss: trade.stoploss,
        targets: trade.targets,
        confidence: trade.confidence ?? 0,
        status: "target_hit",
        provider,
        note: trade.explanation ?? "",
        timestamp: FIXED_SIGNAL_TIMESTAMP,
        hitPrice: currentPrice,
        hitTargetIndex: hitIndex,
      });

      if (saved) {
        setSavedTrades((p) => [saved, ...p]);
        setTargetHitTrade(saved);
      }
      return;
    }

    const saved = await saveTradeToSupabase({
      userEmail,
      symbol,
      type: symbol.includes(".NS")
        ? "stock"
        : symbol.includes("/")
        ? "crypto"
        : "index",
      direction: normalizedSignal === "BUY" ? "long" : "short",
      entryPrice: prevClose,
      stopLoss: trade.stoploss,
      targets: trade.targets,
      confidence: trade.confidence ?? 0,
      status,
      provider,
      note: trade.explanation ?? "",
      timestamp: FIXED_SIGNAL_TIMESTAMP,
    });

    if (saved) {
      setSavedTrades((p) => (p.find((x) => x.id === saved.id) ? p : [saved, ...p]));
    }
  };

  // ------------------- LOAD DATA -------------------
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

          const smc = generateSMCSignal({ current: price, previousClose: prev });

          // 60% reduced stoploss
const stoploss =
  smc.signal === "BUY"
    ? prev * (1 - (1 - 0.985) * 0.6) // → prev * 0.991
    : smc.signal === "SELL"
    ? prev * (1 + (0.015 * 0.6))     // → prev * 1.009
    : prev;


          const targets =
            smc.signal === "BUY"
              ? [prev * 1.01, prev * 1.02, prev * 1.03]
              : smc.signal === "SELL"
              ? [prev * 0.99, prev * 0.98, prev * 0.97]
              : [prev];

          const stock: StockDisplay = {
            symbol: symbol.replace(".NS", ""),
            signal: smc.signal,
            confidence: smc.confidence,
            explanation: smc.explanation,
            price,
            type: type as any,
            support: prev * 0.995,
            resistance: prev * 1.01,
            stoploss,
            targets,
            hitStatus:
              price >= Math.max(...targets)
                ? "TARGET ✅"
                : price <= stoploss
                ? "STOP ❌"
                : "ACTIVE",
          };

          if (
            savedTrades.find(
              (t) =>
                t.symbol.replace(".NS", "") === symbol.replace(".NS", "") &&
                t.status === "target_hit"
            )
          ) {
            stock.hitStatus = "TARGET ✅";
          }

          if (!best || stock.confidence > best.confidence) best = stock;

          await maybeNotifyAndSave(
            stock.symbol,
            "yahoo",
            { ...smc, stoploss, targets },
            prev,
            price
          );
        } catch {}
      }

      if (best) out.push(best);
    }

    if (targetHitTrade) {
      out.push({
        symbol: targetHitTrade.symbol,
        signal: "BUY",
        confidence: 100,
        explanation: "Previously Hit Target Trade",
        price:
          targetHitTrade.entry_price ?? targetHitTrade.entryPrice ?? 0,
        type: "stock",
        support:
          targetHitTrade.entry_price ?? targetHitTrade.entryPrice ?? 0,
        resistance:
          targetHitTrade.entry_price ?? targetHitTrade.entryPrice ?? 0,
        stoploss:
          targetHitTrade.stop_loss ?? targetHitTrade.stopLoss,
        targets: targetHitTrade.targets,
        hitStatus: "TARGET ✅",
      });
    }

    setStockData(out);
    setLoading(false);
  };

  // ------------------- FIXED DEPENDENCIES -------------------
  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, [
    Object.keys(livePrices).length,
    savedTrades.length,
    targetHitTrade ? targetHitTrade.id : null,
  ]);

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

  // ------------------- RENDER -------------------
  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* FIXED TOAST */}
      {toast && (
        <NotificationToast
          message={toast.msg}
          bg={toast.bg}
          currentPrice={toast.currentPrice}
          stoploss={toast.stoploss}
          targets={toast.targets}
          timestamp={toast.timestamp}
          onClose={() => setToast(null)}
        />
      )}

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
          Pro Members Watchlist
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
        <button
          onClick={handleSearch}
          className="px-4 py-2 rounded text-white bg-blue-500"
        >
          Search
        </button>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        (searchResults.length ? searchResults : stockData).map((s) => (
          <StockCard key={s.symbol} {...s} />
        ))
      )}
    </div>
  );
}
