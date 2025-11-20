"use client";

import React, { useEffect, useState, useMemo, useRef, useContext } from "react";
import Link from "next/link";

import StockCard from "../../components/StockCard";
import { fetchStockData } from "../../src/api/fetchStockData";
import { symbols as allSymbols } from "@/src/api/symbols";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { AuthContext } from "../../src/context/AuthContext";

// Supabase Helpers
import {
  getUserTrades,
  getTargetHitTrades,
  saveNotification,
  saveTradeToSupabase
} from "@/src/supabase/getUserTrades";

// Firestore Watchlist Helpers
import {
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from "../../src/firebase/firestoreWatchlist";

type SymbolType = "stock" | "index" | "crypto";

const defaultSymbols: { symbol: string; type: SymbolType }[] = [
  { symbol: "RELIANCE.NS", type: "stock" },
  { symbol: "^NSEI", type: "index" },
  { symbol: "BTC/USD", type: "crypto" },
  { symbol: "ETH/USD", type: "crypto" },
  { symbol: "XAU/USD", type: "index" },
];

const REFRESH_INTERVAL = 180000;

export default function Watchlist() {
  const { user } = useContext(AuthContext);
  const userEmail = (user as any)?.email ?? "";

  const [livePrices, setLivePrices] = useState<Record<string, { price: number; previousClose: number; lastUpdated: number }>>({});
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrades, setTargetHitTrades] = useState<any[]>([]);
  const [userWatchlist, setUserWatchlist] = useState<{ id: string; userEmail: string; symbol: string; type: SymbolType }[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "stock" | "crypto" | "index">("all");
  const [toast, setToast] = useState<{ msg: string; bg?: string } | null>(null);
  const [showAllTrades, setShowAllTrades] = useState(false);

  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  // ------------------------------
  // Load Supabase trades and target hits
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;
    let mounted = true;

    (async () => {
      const trades = await getUserTrades(userEmail);
      if (mounted) setSavedTrades(trades ?? []);

      const hits = await getTargetHitTrades(userEmail);
      if (mounted) setTargetHitTrades(hits ?? []);
    })();

    return () => { mounted = false; };
  }, [userEmail]);

  // ------------------------------
  // Load user's Firestore watchlist
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;
    let mounted = true;

    (async () => {
      const wl = await getUserWatchlist(userEmail);
      if (!mounted) return;
      const normalized = (wl ?? []).map((w: any) => ({
        id: w.id,
        userEmail: w.userEmail,
        symbol: w.symbol,
        type: (w.type ?? "stock") as SymbolType,
      }));
      setUserWatchlist(normalized);
    })();

    return () => { mounted = false; };
  }, [userEmail]);

  // ------------------------------
  // Build unique symbols list
  // ------------------------------
  const mappedExtraSymbols = useMemo(() => {
    return allSymbols.map((s) => {
      let yahooSymbol = s.symbol;
      if (s.type === "crypto" && s.symbol.includes("BINANCE:")) {
        const pair = s.symbol.split(":")[1];
        const base = pair.replace("USDT", "");
        yahooSymbol = `${base}-USD`;
      }
      return { symbol: yahooSymbol, type: s.type as SymbolType };
    });
  }, []);

  const userWatchlistSymbols = useMemo(() => userWatchlist.map((w) => ({ symbol: w.symbol, type: w.type })), [userWatchlist]);

  const uniqueSymbols = useMemo(() => {
    const combined = [...defaultSymbols, ...mappedExtraSymbols, ...userWatchlistSymbols];
    const map = new Map<string, { symbol: string; type: SymbolType }>();
    for (const s of combined) if (!map.has(s.symbol)) map.set(s.symbol, s);
    return Array.from(map.values());
  }, [mappedExtraSymbols, userWatchlistSymbols]);

  const symbolsWithoutTrades = useMemo(() => uniqueSymbols.filter(s => !savedTrades.some(t => t.symbol === s.symbol)), [uniqueSymbols, savedTrades]);

  // ------------------------------
  // Live Price Fetcher
  // ------------------------------
  useEffect(() => {
    let isMounted = true;
    const allSymbolsToFetch = uniqueSymbols.map((s) => s.symbol);

    const fetchAll = async () => {
      const now = Date.now();
      for (const sym of allSymbolsToFetch) {
        const last = livePrices[sym]?.lastUpdated ?? 0;
        if (now - last >= REFRESH_INTERVAL) {
          try {
            const fetchSymbol = apiSymbol(sym);
            const resp = await fetchStockData(fetchSymbol);
            if (!isMounted) return;

            setLivePrices(prev => ({
              ...prev,
              [sym]: {
                price: resp.current ?? resp.previousClose ?? 0,
                previousClose: resp.previousClose ?? resp.current ?? 0,
                lastUpdated: now,
              }
            }));
          } catch (err) {
            console.warn("Failed to fetch price", sym, err);
          }
        }
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [uniqueSymbols]);

  // ------------------------------
  // Save new trades to Supabase
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;

    const saveNewTrades = async () => {
      for (const s of symbolsWithoutTrades) {
        const live = livePrices[s.symbol];
        if (!live) continue;
        const prevClose = live.previousClose;

        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: live.price,
          previousClose: prevClose,
          prices: [],
          highs: [],
          lows: [],
          volumes: [],
        });

        if (savedTrades.some(t => t.symbol === s.symbol)) continue;

        const saved = await saveTradeToSupabase({
  user_email: userEmail,
  symbol: s.symbol,
  type: s.type,
  direction:
    smc.signal === "BUY"
      ? "long"
      : smc.signal === "SELL"
      ? "short"
      : "none",

  entry_price: prevClose,
  stop_loss: smc.stoploss ?? prevClose * 0.985,
  targets: smc.targets ?? [prevClose],
  confidence: smc.confidence ?? 50,

  status: "active",
  provider: "yahoo",
  note: smc.explanation ?? "",

  timestamp: Date.now(),
});

        if (saved) setSavedTrades(prev => [...prev, saved]);
      }
    };

    saveNewTrades();
  }, [symbolsWithoutTrades, livePrices, userEmail, savedTrades.length]);

  // ------------------------------
  // Scoring Trades with SMC Logic
  // ------------------------------
  const scoredTrades: StockDisplay[] = useMemo(() => {
    const allTrades = [...savedTrades];

    return allTrades.map(t => {
      const live = livePrices[t.symbol] ?? { price: 0, previousClose: t.entryPrice ?? 0 };
      const prevClose = live.previousClose;

      const signalResult = generateSMCSignal({
        symbol: t.symbol,
        current: live.price,
        previousClose: prevClose,
        prices: t.prices ?? [],
        highs: t.highs ?? [],
        lows: t.lows ?? [],
        volumes: t.volumes ?? [],
      });

      const stoploss = signalResult.stoploss ?? prevClose * 0.985;
      const targets = signalResult.targets ?? [prevClose * 1.01, prevClose * 1.02, prevClose * 1.03];
      const support = prevClose * 0.995;
      const resistance = prevClose * 1.01;

      let hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" = "ACTIVE";
      if (live.price <= stoploss) hitStatus = "STOP ❌";
      else if (live.price >= Math.max(...targets)) hitStatus = "TARGET ✅";

      // Save notification if hit target
      if (hitStatus === "TARGET ✅") {
        saveNotification(userEmail, t.symbol, signalResult.signal, `${t.symbol} hit target`);
      }

      return {
        symbol: t.symbol,
        signal: t.direction === "long" ? "BUY" : t.direction === "short" ? "SELL" : "HOLD",
        confidence: signalResult.confidence ?? 50,
        explanation: t.explanation ?? signalResult.explanation ?? "",
        price: live.price,
        type: t.type ?? "stock",
        stoploss,
        targets,
        support,
        resistance,
        hitStatus,
      };
    });
  }, [savedTrades, livePrices, userEmail]);

  // ------------------------------
  // Symbols without trades
  // ------------------------------
  const newSymbolsScored: StockDisplay[] = useMemo(() => {
    return symbolsWithoutTrades.map(s => {
      const live = livePrices[s.symbol] ?? { price: 0, previousClose: 0 };
      const prevClose = live.previousClose ?? live.price ?? 0;

      const result = generateSMCSignal({
        symbol: s.symbol,
        current: live.price,
        previousClose: prevClose,
        prices: [],
        highs: [],
        lows: [],
        volumes: [],
      });

      return {
        symbol: s.symbol,
        signal: result.signal,
        confidence: result.confidence ?? 50,
        explanation: result.explanation ?? "",
        price: live.price ?? prevClose,
        type: s.type,
        support: prevClose * 0.995,
        resistance: prevClose * 1.01,
        stoploss: prevClose * 0.985,
        targets: result.targets ?? [prevClose],
        hitStatus: result.hitStatus ?? "ACTIVE",
      };
    });
  }, [symbolsWithoutTrades, livePrices]);

  const combinedSorted = useMemo(() => {
    return [...scoredTrades, ...newSymbolsScored].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }, [scoredTrades, newSymbolsScored]);

  const previousTargetHits = useMemo(() => [...targetHitTrades].slice(-2), [targetHitTrades]);

  const filteredTopFive = combinedSorted.filter(t => category === "all" ? true : t.type === category).slice(0, 5);
  const filteredTargetHits = previousTargetHits.filter(t => category === "all" ? true : (t.type ?? "stock") === category);
  const remainingTradesFiltered = showAllTrades ? combinedSorted.filter(t => category === "all" ? true : t.type === category).slice(5) : [];

  const normalizeForKey = (s: string) => s.replace(/\s+/g, "_").replace(/\//g, "-");

  // ------------------------------
  // Render
  // ------------------------------
  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <Link href="/" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">← Back to Home</Link>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search symbol..."
          className="w-full p-2 border rounded"
          value={search}
          onChange={(e) => setSearch(e.target.value.toUpperCase())}
        />
      </div>

      {toast && <div className={`p-3 text-white rounded mb-4 ${toast.bg}`}>{toast.msg}</div>}

      {!user ? <p className="text-gray-500">Please log in to see your watchlist.</p> : (
        <>
          {/* CATEGORY BUTTONS */}
          <div className="mb-6 flex gap-2">
            {["all", "stock", "crypto", "index"].map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat as any)}
                className={`px-3 py-1 rounded-lg border ${category === cat ? "bg-black text-white" : "bg-white text-black"}`}
              >{cat.toUpperCase()}</button>
            ))}
          </div>

          {/* TOP 5 */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">🔥 Top Trades</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTopFive
                .filter(t => t.symbol.includes(search))
                .map((t, idx) => <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />)}
            </div>
          </div>

          {/* PREVIOUS TARGET HITS */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">🏁 Recent Target Hits</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTargetHits
                .filter(t => t.symbol.includes(search))
                .map((t: any, idx) => {
                  const display: StockDisplay = {
                    symbol: t.symbol,
                    signal: t.direction === "long" ? "BUY" : t.direction === "short" ? "SELL" : "HOLD",
                    confidence: t.confidence ?? 0,
                    explanation: t.note ?? t.explanation ?? "",
                    price: t.hit_price ?? t.finalPrice ?? t.entry_price ?? t.entryPrice ?? 0,
                    type: t.type ?? "stock",
                    support: t.support ?? 0,
                    resistance: t.resistance ?? 0,
                    stoploss: t.stop_loss ?? 0,
                    targets: t.targets ?? [],
                    hitStatus: "TARGET ✅",
                  };
                  return <StockCard key={normalizeForKey(display.symbol) + idx} {...display} />;
                })}
            </div>
          </div>

          {/* SHOW REMAINING TRADES */}
          {remainingTradesFiltered.length > 0 && (
            <div className="mb-6">
              <button onClick={() => setShowAllTrades(!showAllTrades)} className="px-4 py-2 bg-gray-800 text-white rounded mb-3">
                {showAllTrades ? "Hide Other Trades" : "Show Other Trades"}
              </button>
              {showAllTrades && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {remainingTradesFiltered
                    .filter(t => t.symbol.includes(search))
                    .map((t, idx) => <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
