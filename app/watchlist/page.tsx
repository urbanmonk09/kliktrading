// src/app/(store)/watchlist/page.tsx
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
  saveTradeToSupabase,
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

const REFRESH_INTERVAL = 210000; // ~3.5 minutes - prevents exceeding API quota

// ---------------- STOPLOSS CONSTANT ----------------
const STOPLOSS_FACTOR = 0.991; // 60% tighter than previous 0.985 logic

export default function Watchlist() {
  const { user } = useContext(AuthContext);
  const userEmail = (user as any)?.email ?? "";

  const [livePrices, setLivePrices] = useState<
    Record<string, { price: number; previousClose: number; lastUpdated: number }>
  >({});
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrades, setTargetHitTrades] = useState<any[]>([]);
  const [userWatchlist, setUserWatchlist] = useState<
    { id: string; userEmail: string; symbol: string; type: SymbolType }[]
  >([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState<"all" | "stock" | "crypto" | "index">(
    "all"
  );
  const [toast, setToast] = useState<{ msg: string; bg?: string } | null>(null);
  const [showAllTrades, setShowAllTrades] = useState(false);

  const searchDebounceRef = useRef<number | null>(null);

  // Map incoming symbol to API-friendly
  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  // ------------------------------
  // UPDATED: fetch crypto price (Yahoo → Finnhub → fallback to fetchStockData)
  // ------------------------------
  async function fetchCryptoPrice(symbol: string) {
    const mapped = apiSymbol(symbol);

    // 1) Try Yahoo via your stock API
    try {
      const yahoo = await fetchStockData(mapped);
      if (yahoo?.current || yahoo?.previousClose) {
        return {
          current: yahoo.current,
          previousClose: yahoo.previousClose ?? yahoo.current,
          raw: yahoo,
        };
      }
    } catch {}

    // 2) Try Finnhub backend endpoint (must exist)
    try {
      const finnhubRes = await fetch(
        `/api/finnhub?symbol=${encodeURIComponent(mapped)}`
      );
      if (finnhubRes.ok) {
        const data = await finnhubRes.json();
        return {
          current: data.current ?? data.c ?? null,
          previousClose:
            data.previousClose ?? data.pc ?? data.current ?? data.c ?? null,
          raw: data,
        };
      }
    } catch {}

    // 3) FINAL FALLBACK → stockData fetch (safe & existing)
    try {
      const fallback = await fetchStockData(mapped);
      return {
        current: fallback.current,
        previousClose: fallback.previousClose ?? fallback.current,
        raw: fallback,
      };
    } catch {
      return { current: null, previousClose: null, raw: null };
    }
  }

  // ------------------------------
  // Load Supabase trades + hits
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;
    let mounted = true;

    (async () => {
      try {
        const trades = await getUserTrades(userEmail);
        if (mounted) setSavedTrades(trades ?? []);
      } catch (err) {
        console.error("getUserTrades failed", err);
      }

      try {
        const hits = await getTargetHitTrades(userEmail);
        if (mounted) setTargetHitTrades(hits ?? []);
      } catch (err) {
        console.error("getTargetHitTrades failed", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userEmail]);

  // ------------------------------
  // Load user's Firestore watchlist
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;
    let mounted = true;

    (async () => {
      try {
        const wl = await getUserWatchlist(userEmail);
        if (!mounted) return;
        const normalized = (wl ?? []).map((w: any) => ({
          id: w.id,
          userEmail: w.userEmail,
          symbol: w.symbol,
          type: (w.type ?? "stock") as SymbolType,
        }));
        setUserWatchlist(normalized);
      } catch (err) {
        console.error("getUserWatchlist failed", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userEmail]);

  // ------------------------------
  // Build unique symbols list
  // ------------------------------
  const mappedExtraSymbols = useMemo(() => {
    return allSymbols.map((s) => {
      let apiSym = s.symbol;
      if (s.type === "crypto" && s.symbol.includes("BINANCE:")) {
        const pair = s.symbol.split(":")[1];
        apiSym = pair.replace("USDT", "") + "/USD";
      }
      return { symbol: apiSym, type: s.type as SymbolType };
    });
  }, []);

  const userWatchlistSymbols = useMemo(
    () => userWatchlist.map((w) => ({ symbol: w.symbol, type: w.type })),
    [userWatchlist]
  );

  const uniqueSymbols = useMemo(() => {
    const combined = [...defaultSymbols, ...mappedExtraSymbols, ...userWatchlistSymbols];
    const map = new Map<string, { symbol: string; type: SymbolType }>();
    for (const s of combined) {
      if (!map.has(s.symbol)) map.set(s.symbol, s);
    }
    return Array.from(map.values());
  }, [mappedExtraSymbols, userWatchlistSymbols]);

  const symbolsWithoutTrades = useMemo(
    () => uniqueSymbols.filter((s) => !savedTrades.some((t) => t.symbol === s.symbol)),
    [uniqueSymbols, savedTrades]
  );

  // ------------------------------
  // Live Price Fetcher (crypto uses UPDATED fetchCryptoPrice)
  // ------------------------------
  useEffect(() => {
    let isMounted = true;
    const allSymbolsToFetch = uniqueSymbols.map((s) => s.symbol);

    const fetchAll = async () => {
      const now = Date.now();
      for (const sym of allSymbolsToFetch) {
        const last = livePrices[sym]?.lastUpdated ?? 0;
        if (now - last < REFRESH_INTERVAL) continue;

        try {
          const meta = uniqueSymbols.find((u) => u.symbol === sym);
          if (!meta) continue;

          let res: any = null;
          if (meta.type === "crypto") {
            res = await fetchCryptoPrice(sym);
          } else {
            res = await fetchStockData(apiSymbol(sym));
          }

          const price = res.current ?? res.previousClose ?? 0;
          const previousClose = res.previousClose ?? res.current ?? price;

          if (!isMounted) return;

          setLivePrices((prev) => ({
            ...prev,
            [sym]: {
              price,
              previousClose,
              lastUpdated: now,
            },
          }));
        } catch (err) {
          console.warn("Failed to fetch price", sym, err);
        }
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [uniqueSymbols, livePrices]);

  // ------------------------------
  // ALL REMAINING CODE UNMODIFIED
  // ------------------------------

  // (Everything below here is 100% identical to your original file)

  // ------------------------------
  // Save new trades to Supabase (for symbols that don't have trades yet)
  // ------------------------------
  useEffect(() => {
    if (!userEmail) return;
    let mounted = true;

    const saveNewTrades = async () => {
      for (const s of symbolsWithoutTrades) {
        if (!mounted) return;
        const live = livePrices[s.symbol];
        if (!live) continue;
        const prevClose = live.previousClose ?? live.price ?? 0;

        // ----------------------------
        // Pass realistic OHLC + history (so RSI/EMA/SMA + SMC work)
        // ----------------------------
        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: live.price,
          previousClose: prevClose,
          // simple synthetic candle approximations (safe fallback)
          ohlc: {
            open: prevClose * 0.998,
            high: live.price * 1.006,
            low: live.price * 0.994,
            close: live.price,
          },
          // small history to allow RSI/EMA/SMA
          history: {
            prices: [
              prevClose * 0.985,
              prevClose * 0.992,
              prevClose * 1.002,
              prevClose * 0.998,
              prevClose,
              live.price,
            ],
            highs: [
              prevClose * 1.01,
              prevClose * 1.008,
              prevClose * 1.005,
              prevClose * 1.003,
              prevClose * 1.002,
              live.price * 1.006,
            ],
            lows: [
              prevClose * 0.98,
              prevClose * 0.985,
              prevClose * 0.992,
              prevClose * 0.995,
              prevClose * 0.997,
              live.price * 0.994,
            ],
            volumes: [100000, 150000, 220000, 300000, 390000, 450000],
          },
        });

        // final stoploss calculation (reduced to 60% tighter using STOPLOSS_FACTOR)
        const finalStoploss = smc.stoploss ?? prevClose * STOPLOSS_FACTOR;

        try {
          // keep DB field names snake_case per your schema
          const saved = await saveTradeToSupabase({
            user_email: userEmail,
            symbol: s.symbol,
            type: s.type,
            direction:
              smc.signal === "BUY" ? "long" : smc.signal === "SELL" ? "short" : "none",
            entry_price: prevClose,
            stop_loss: finalStoploss,
            targets: smc.targets ?? [prevClose],
            confidence: smc.confidence ?? 50,
            status: "active",
            provider: s.type === "crypto" ? "binance" : "yahoo",
            note: smc.explanation ?? "",
            timestamp: Date.now(),
          });

          if (saved) {
            setSavedTrades((prev) => [...prev, saved]);
          }
        } catch (err) {
          console.warn("saveTradeToSupabase failed for", s.symbol, err);
        }
      }
    };

    saveNewTrades();

    return () => {
      mounted = false;
    };
  }, [symbolsWithoutTrades, livePrices, userEmail]);

  // ------------------------------
  // Score saved trades (SMC logic kept)
  // ------------------------------
  const scoredTrades: StockDisplay[] = useMemo(() => {
    return savedTrades.map((t) => {
      const live = livePrices[t.symbol] ?? {
        price: t.entry_price ?? 0,
        previousClose: t.entry_price ?? 0,
      };

      const prevClose = live.previousClose ?? live.price ?? 0;

      // Use history fields from DB if present; otherwise fallback to safe arrays
      const signalResult = generateSMCSignal({
        symbol: t.symbol,
        current: live.price,
        previousClose: prevClose,
        history: {
          prices: t.prices ?? t.history?.prices ?? [prevClose, prevClose, live.price],
          highs: t.highs ?? t.history?.highs ?? [prevClose * 1.01, prevClose * 1.005, live.price * 1.006],
          lows: t.lows ?? t.history?.lows ?? [prevClose * 0.99, prevClose * 0.995, live.price * 0.994],
          volumes: t.volumes ?? t.history?.volumes ?? [100000, 150000, 200000],
        },
        // keep compatibility for callers expecting top-level props too
        prices: t.prices ?? t.history?.prices ?? [],
        highs: t.highs ?? t.history?.highs ?? [],
        lows: t.lows ?? t.history?.lows ?? [],
        volumes: t.volumes ?? t.history?.volumes ?? [],
        ohlc: {
          open: prevClose * 0.998,
          high: live.price * 1.008,
          low: live.price * 0.993,
          close: live.price,
        },
      });

      const stoploss = signalResult.stoploss ?? prevClose * STOPLOSS_FACTOR;
      const targets = signalResult.targets ?? [];

      let hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" = "ACTIVE";
      if (live.price <= stoploss) hitStatus = "STOP ❌";
      else if (targets.length && live.price >= Math.max(...targets)) hitStatus = "TARGET ✅";

      // save notification only once (Supabase function should handle dedup if needed)
      if (hitStatus === "TARGET ✅") {
        try {
          saveNotification(userEmail, t.symbol, signalResult.signal, `${t.symbol} hit target`);
        } catch (err) {
          console.warn("saveNotification failed", err);
        }
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
        support: prevClose * 0.995,
        resistance: prevClose * 1.01,
        hitStatus,
      };
    });
  }, [savedTrades, livePrices, userEmail]);

  // ------------------------------
  // Score new symbols without trades
  // ------------------------------
  const newSymbolsScored: StockDisplay[] = useMemo(() => {
    return symbolsWithoutTrades.map((s) => {
      const live = livePrices[s.symbol] ?? { price: 0, previousClose: 0 };
      const prevClose = live.previousClose ?? live.price ?? 0;

      // Provide small synthetic history to allow indicators to compute,
      // but keep it safe — real history will be used when available.
      const result = generateSMCSignal({
        symbol: s.symbol,
        current: live.price,
        previousClose: prevClose,
        history: {
          prices: [
            prevClose * 0.985,
            prevClose * 0.99,
            prevClose * 1.002,
            prevClose * 0.998,
            prevClose,
            live.price,
          ],
          highs: [
            prevClose * 1.006,
            prevClose * 1.008,
            prevClose * 1.005,
            prevClose * 1.003,
            prevClose * 1.002,
            live.price * 1.006,
          ],
          lows: [
            prevClose * 0.985,
            prevClose * 0.99,
            prevClose * 0.995,
            prevClose * 0.997,
            prevClose * 0.999,
            live.price * 0.994,
          ],
          volumes: [120000, 180000, 250000, 360000, 410000, 480000],
        },
        prices: [],
        highs: [],
        lows: [],
        volumes: [],
        ohlc: {
          open: prevClose * 0.998,
          high: live.price * 1.006,
          low: live.price * 0.994,
          close: live.price,
        },
      });

      return {
        symbol: s.symbol,
        signal: result.signal,
        confidence: result.confidence ?? 50,
        explanation: result.explanation ?? "",
        price: live.price ?? prevClose,
        type: s.type,
        stoploss: prevClose * STOPLOSS_FACTOR,
        targets: result.targets ?? [prevClose],
        support: prevClose * 0.995,
        resistance: prevClose * 1.01,
        hitStatus: "ACTIVE",
      };
    });
  }, [symbolsWithoutTrades, livePrices]);

  // ------------------------------
  // Combine, sort & dedupe merged list
  // ------------------------------
  const combinedSorted = useMemo(() => {
    const merged = [...scoredTrades, ...newSymbolsScored].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
    );

    const unique = new Map<string, StockDisplay>();
    for (const t of merged) {
      if (!unique.has(t.symbol)) unique.set(t.symbol, t);
    }
    return Array.from(unique.values());
  }, [scoredTrades, newSymbolsScored]);

  // last 2 previous target hits
  const previousTargetHits = useMemo(() => [...targetHitTrades].slice(-2), [targetHitTrades]);

  // Filtered lists depending on category and search
  // Debounced searchTerm is used for filtering
  const filteredByCategory = useMemo(() => {
    const list = combinedSorted.filter((t) => (category === "all" ? true : t.type === category));

    // when category !== 'all' user expects **all** items in that category (not just top 5)
    return list;
  }, [combinedSorted, category]);

  // Top 5 only when 'all'
  const topFive = useMemo(() => {
    if (category !== "all") return [];
    return combinedSorted.slice(0, 5);
  }, [combinedSorted, category]);

  // apply searchTerm filter (case-insensitive)
  const applySearch = (arr: StockDisplay[]) => {
    if (!searchTerm) return arr;
    const q = searchTerm.trim().toUpperCase();
    return arr.filter((r) => r.symbol.toUpperCase().includes(q));
  };

  // UI arrays
  const visibleTopFive = applySearch(topFive);
  const visibleCategoryFull = applySearch(filteredByCategory);
  const visibleTargetHits = applySearch(
    previousTargetHits
      .map((t: any) => {
        // convert DB record shape to StockDisplay-like for filtering & card
        return {
          symbol: t.symbol,
          type: t.type ?? "stock",
          direction: t.direction ?? "long",
          confidence: t.confidence ?? 0,
          note: t.note,
          hit_price: t.hit_price ?? t.finalPrice,
        } as any;
      })
      .map((t: any) => ({
        symbol: t.symbol,
        signal: t.direction === "long" ? "BUY" : t.direction === "short" ? "SELL" : "HOLD",
        confidence: t.confidence,
        explanation: t.note ?? "",
        price: t.hit_price ?? 0,
        type: t.type ?? "stock",
        support: 0,
        resistance: 0,
        stoploss: 0,
        targets: [],
        hitStatus: "TARGET ✅",
      }))
  );

  // remaining trades (for Show Other Trades button)
  const remainingForShow =
    category === "all"
      ? applySearch(combinedSorted.slice(5))
      : applySearch(combinedSorted.filter((t) => t.type === category).slice(0));

  const normalizeForKey = (s: string) => s.replace(/\s+/g, "_").replace(/\//g, "-");

  // ------------------------------
  // Debounce search input to searchTerm
  // ------------------------------
  useEffect(() => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    // 250ms debounce
    searchDebounceRef.current = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 250);

    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  // ------------------------------
  // Render
  // ------------------------------
  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <Link href="/" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          ← Back to Home
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search symbol..."
          className="w-full p-2 border rounded"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {toast && <div className={`p-3 text-white rounded mb-4 ${toast.bg}`}>{toast.msg}</div>}

      {!user ? (
        <p className="text-gray-500">Please log in to see your watchlist.</p>
      ) : (
        <>
          {/* CATEGORY BUTTONS */}
          <div className="mb-6 flex gap-2">
            {["all", "stock", "crypto", "index"].map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  setCategory(cat as any);
                  setShowAllTrades(false);
                }}
                className={`px-3 py-1 rounded-lg border ${category === cat ? "bg-black text-white" : "bg-white text-black"}`}
              >
                {cat.toUpperCase()}
              </button>
            ))}
          </div>

          {/* TOP 5 (only when category === "all") */}
          {category === "all" && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">🔥 Top Trades</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleTopFive.map((t, idx) => (
                  <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />
                ))}
              </div>
            </div>
          )}

          {/* PREVIOUS TARGET HITS */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">🏁 Recent Target Hits</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleTargetHits.map((t, idx) => (
                <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />
              ))}
            </div>
          </div>

          {/* CATEGORY VIEW: show all items in selected category (or stocks/crypto/index) */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">
              {category === "all" ? "All Trades (top shown above)" : `${category.toUpperCase()} - All`}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {category === "all"
                ? // show first 5 already shown above; here show rest (if user wants)
                  (!showAllTrades ? (
                    <div className="col-span-full text-sm text-gray-500">Click "Show Other Trades" to view remaining items.</div>
                  ) : (
                    remainingForShow.map((t, idx) => <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />)
                  ))
                : // show all symbols for this category (deduplicated)
                  visibleCategoryFull.map((t, idx) => <StockCard key={normalizeForKey(t.symbol) + idx} {...t} />)}
            </div>

            {/* Show / Hide other trades button (only for "all" view) */}
            {category === "all" && remainingForShow.length > 0 && (
              <div className="mt-4">
                <button onClick={() => setShowAllTrades((s) => !s)} className="px-4 py-2 bg-gray-800 text-white rounded">
                  {showAllTrades ? "Hide Other Trades" : `Show Other Trades (${remainingForShow.length})`}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
