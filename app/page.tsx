"use client";

import React, { useEffect, useState, useRef } from "react";
import StockCard from "../components/StockCard";
import { fetchStockData } from "../src/api/fetchStockData";
import { generateSMCSignal, StockDisplay } from "../src/utils/xaiLogic";
import NotificationToast from "../components/NotificationToast";
import { useRouter } from "next/navigation";

// ⭐ Supabase imports
import { supabase } from "../src/lib/supabaseClient";

// ⭐ Supabase helpers
import saveTradeToSupabase from "@/src/supabase/trades";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades"; // <-- added helper

// Home screen symbols
const homeSymbols = {
  stock: ["RELIANCE.NS", "TCS.NS", "INFY.NS"],
  index: ["^NSEI", "^NSEBANK"],
  crypto: ["BTC/USD", "ETH/USD"],
  commodity: ["XAU/USD"],
};

const REFRESH_INTERVAL = 180000; // 3 minutes

export default function Home() {
  const [stockData, setStockData] = useState<StockDisplay[]>([]);
  const [livePrices, setLivePrices] = useState<
    Record<string, { price: number; previousClose: number; lastUpdated: number }>
  >({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockDisplay[]>([]);
  const [toast, setToast] = useState<{ msg: string; bg?: string } | null>(null);

  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrade, setTargetHitTrade] = useState<any | null>(null); // ⭐ NEW

  const lastSignalsRef = useRef<Record<string, string>>({});
  const router = useRouter();

  // ----------------------------------------------------
  // ⭐ Supabase Auth Listener
  // ----------------------------------------------------
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (data?.user) {
        setSupabaseUser(data.user);

        const trades = await getUserTrades(data.user.email!);
        setSavedTrades(trades);

        // ⭐ Fetch one previous target-hit trade
        const prevHit = await getTargetHitTrades(data.user.email!);
        if (prevHit.length > 0) setTargetHitTrade(prevHit[0]);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          setSupabaseUser(session.user);

          const trades = await getUserTrades(session.user.email!);
          setSavedTrades(trades);

          const prevHit = await getTargetHitTrades(session.user.email!);
          if (prevHit.length > 0) setTargetHitTrade(prevHit[0]);
        } else {
          setSupabaseUser(null);
          setSavedTrades([]);
          setTargetHitTrade(null);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const userEmail = supabaseUser?.email ?? "";

  // ----------------------------------------------------
  // Load Last Signal Cache
  // ----------------------------------------------------
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem("lastSignals");
        lastSignalsRef.current = raw ? JSON.parse(raw) : {};
      }
    } catch {}
  }, []);

  // ----------------------------------------------------
  // API Symbol Mapping
  // ----------------------------------------------------
  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  // ----------------------------------------------------
  // Fetch Live Prices
  // ----------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const allSymbols = [
      ...homeSymbols.stock,
      ...homeSymbols.index,
      ...homeSymbols.crypto,
      ...homeSymbols.commodity,
    ];

    const fetchAllPrices = async () => {
      const now = Date.now();

      for (const symbol of allSymbols) {
        const last = livePrices[symbol]?.lastUpdated ?? 0;
        if (now - last < REFRESH_INTERVAL) continue;

         try {
    // We are only using Yahoo now
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
    );
    const json = await response.json();

    const result = {
      current: json.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0,
      previousClose: json.chart?.result?.[0]?.meta?.chartPreviousClose ?? 0,
    };

    return result;
  } catch {
          setToast({
            msg: `Failed fetching ${symbol}`,
            bg: "bg-red-500",
          });
        }
      }
    };

    fetchAllPrices();
    const interval = setInterval(fetchAllPrices, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [livePrices]);

  // ----------------------------------------------------
  // Save Trade + Notify
  // ----------------------------------------------------
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

    if (typeof window !== "undefined") {
      localStorage.setItem("lastSignals", JSON.stringify(lastSignalsRef.current));
    }

    if (supabaseUser && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(`${normalizedSignal} signal - ${symbol}`, {
          body: `${symbol} ${currentPrice ?? ""}`,
        });
      } else if (Notification.permission !== "denied") {
        await Notification.requestPermission();
      }
    }

    setToast({
      msg: `${normalizedSignal} signal on ${symbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
    });

    if (supabaseUser?.email) {
      await saveTradeToSupabase({
        userEmail,
        symbol,
        type: symbol.startsWith("^")
          ? "index"
          : symbol.includes("/USD") || symbol === "XAU/USD"
          ? "crypto"
          : "stock",
        direction: normalizedSignal === "BUY" ? "long" : "short",
        entryPrice: prevClose,
        stopLoss: trade.stoploss ?? undefined,
        targets: trade.targets ?? undefined,
        confidence: trade.confidence ?? 0,
        status: "active",
        provider,
        note: trade.explanation ?? "",
        timestamp: Date.now(),
      });
    }
  };

  // ----------------------------------------------------
  // Load Home Data
  // ----------------------------------------------------
  const loadData = async () => {
    setLoading(true);
    const out: StockDisplay[] = [];

    for (const [type, symbols] of Object.entries(homeSymbols) as [
      keyof typeof homeSymbols,
      string[]
    ][]) {
      let bestSymbol: StockDisplay | null = null;

      for (const symbol of symbols) {
        try {
          const live = livePrices[symbol];
          const prevClose = live?.previousClose ?? 0;
          const currentPrice = live?.price ?? prevClose;

          const smc = generateSMCSignal({
            current: currentPrice,
            previousClose: prevClose,
          });

          const stoploss =
            smc.signal === "BUY"
              ? prevClose * 0.985
              : smc.signal === "SELL"
              ? prevClose * 1.015
              : prevClose;

          const targets =
            smc.signal === "BUY"
              ? [prevClose * 1.01, prevClose * 1.02, prevClose * 1.03]
              : smc.signal === "SELL"
              ? [prevClose * 0.99, prevClose * 0.98, prevClose * 0.97]
              : [prevClose];

          const stock: StockDisplay = {
            symbol: symbol.replace(".NS", ""),
            signal: smc.signal,
            confidence: smc.confidence,
            explanation: smc.explanation,
            price: currentPrice,
            type: type as StockDisplay["type"],
            support: prevClose * 0.995,
            resistance: prevClose * 1.01,
            stoploss,
            targets,
            hitStatus:
              currentPrice >= Math.max(...targets)
                ? "TARGET ✅"
                : currentPrice <= stoploss
                ? "STOP ❌"
                : "ACTIVE",
          };

          const prevHitTrade = savedTrades.find(
            (t) =>
              t.symbol.replace(".NS", "") === symbol.replace(".NS", "") &&
              t.status === "target_hit"
          );

          if (prevHitTrade) stock.hitStatus = "TARGET ✅";

          if (!bestSymbol || stock.confidence > bestSymbol.confidence)
            bestSymbol = stock;

          await maybeNotifyAndSave(
            stock.symbol,
            "yahoo",
            { ...smc, stoploss, targets },
            prevClose,
            currentPrice
          );
        } catch {}
      }

      if (bestSymbol) out.push(bestSymbol);
    }

    // ⭐ Add one previous trade from database
    if (targetHitTrade) {
      out.push({
        symbol: targetHitTrade.symbol,
        signal: "BUY",
        confidence: 100,
        explanation: "Previously Hit Target Trade",
        price: targetHitTrade.entryPrice,
        type: "stock",
        support: targetHitTrade.entryPrice,
        resistance: targetHitTrade.entryPrice,
        stoploss: targetHitTrade.stopLoss,
        targets: targetHitTrade.targets,
        hitStatus: "TARGET ✅",
      });
    }

    setStockData(out);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [livePrices, targetHitTrade]);

  // ----------------------------------------------------
  // Search (Locked for Free)
  // ----------------------------------------------------
  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ msg: "Pro membership required!", bg: "bg-red-600" });
      return;
    }

    const term = search.trim().toLowerCase();
    if (!term) {
      setSearchResults(stockData);
      return;
    }

    const filtered = stockData.filter((s) =>
      s.symbol.toLowerCase().includes(term)
    );
    setSearchResults(filtered);
  };

  // ----------------------------------------------------
  // Render
  // ----------------------------------------------------
  return (
    <div className="p-6 bg-gray-100 min-h-screen">

      {toast && (
        <NotificationToast
          message={toast.msg}
          bg={toast.bg}
          onClose={() => setToast(null)}
        />
      )}

      {/* Watchlist */}
      <div className="mb-4">
        <button
          onClick={() => {
            if (!supabaseUser) {
              setToast({ msg: "Please login first!", bg: "bg-red-600" });
              return;
            }
            router.push("/watchlist");
          }}
          className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
        >
          Pro Members Watchlist
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search signal for stock and crypto only for Pro member"
          disabled={!supabaseUser}  // ⭐ LOCKED
          className={`flex-1 p-2 rounded border ${
            !supabaseUser ? "bg-gray-300 cursor-not-allowed" : "bg-white"
          }`}
        />

        <button
          onClick={handleSearch}
          className={`px-4 py-2 rounded text-white ${
            supabaseUser
              ? "bg-blue-500 hover:bg-blue-600"
              : "bg-gray-500 cursor-not-allowed"
          }`}
        >
          Search
        </button>
      </div>

      {/* Cards */}
      {loading ? (
        <div>Loading…</div>
      ) : (searchResults.length ? searchResults : stockData).map((s) => (
          <StockCard key={s.symbol} {...s} />
        ))}
    </div>
  );
}
