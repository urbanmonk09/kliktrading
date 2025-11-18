"use client";

import React, { useEffect, useState, useMemo, useRef, useContext } from "react";
import Link from "next/link";
import Fuse from "fuse.js";

import StockCard from "../../components/StockCard";
import { fetchStockData } from "../../src/api/fetchStockData";
import { symbols as allSymbols } from "@/src/api/symbols";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { AuthContext } from "../../src/context/AuthContext";

import {
  getUserTrades as getUserTradesFromFirestore,
} from "../../src/firebase/firestoreActions";
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
  const userEmail = (user as any)?.email ?? (user as any)?.emailAddress ?? "";

  const [livePrices, setLivePrices] = useState<
    Record<string, { price: number; previousClose: number; lastUpdated: number }>
  >({});
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [userWatchlist, setUserWatchlist] = useState<
    { id: string; userEmail: string; symbol: string; type: SymbolType }[]
  >([]);
  const [search, setSearch] = useState("");
  const [filteredResults, setFilteredResults] = useState<StockDisplay[]>([]);
  const [suggestions, setSuggestions] = useState<StockDisplay[]>([]);
  const [category, setCategory] = useState<"all" | "stock" | "crypto" | "index">(
    "all"
  );
  const [toast, setToast] = useState<{ msg: string; bg?: string } | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  useEffect(() => {
    if (!userEmail) {
      setSavedTrades([]);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const trades = await getUserTradesFromFirestore(userEmail);
        if (!mounted) return;
        setSavedTrades(trades ?? []);
      } catch (err) {
        console.error("Failed to load trades from Firestore", err);
        setSavedTrades([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userEmail]);

  useEffect(() => {
    if (!userEmail) {
      setUserWatchlist([]);
      return;
    }
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
        console.error("Failed to load watchlist", err);
        setUserWatchlist([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userEmail]);

  const mappedExtraSymbols = allSymbols.map((s) => {
    let yahooSymbol = s.symbol;
    if (s.type === "crypto" && s.symbol.includes("BINANCE:")) {
      const pair = s.symbol.split(":")[1];
      const base = pair.replace("USDT", "");
      yahooSymbol = `${base}-USD`;
    }
    return { symbol: yahooSymbol, type: s.type as SymbolType };
  });

  const userWatchlistSymbols = userWatchlist.map((w) => ({
    symbol: w.symbol,
    type: w.type,
  }));

  const combinedSymbols = [
    ...defaultSymbols,
    ...mappedExtraSymbols,
    ...userWatchlistSymbols,
  ];

  const uniqueSymbols = combinedSymbols.filter(
    (v, i, a) => a.findIndex((x) => x.symbol === v.symbol) === i
  );

  const symbolsWithoutTrades = uniqueSymbols.filter(
    (s) => !savedTrades.some((t: any) => t.symbol === s.symbol)
  );

  // ------------------------------
  // ✅ Fully patched: Live price fetcher (only fetch fix for crypto)
  useEffect(() => {
    let isMounted = true;

    const allSymbolsToFetch = uniqueSymbols.map((s) => s.symbol);

    const fetchAllPrices = async () => {
      const now = Date.now();
      for (const sym of allSymbolsToFetch) {
        const last = livePrices[sym]?.lastUpdated ?? 0;
        if (now - last >= REFRESH_INTERVAL) {
          try {
            let fetchSymbol = apiSymbol(sym);

            // Fetch crypto via Yahoo only
            if (["BTC/USD", "ETH/USD"].includes(sym)) {
              fetchSymbol = sym.replace("/", "-");
            } else if (sym === "XAU/USD") {
              fetchSymbol = "GC=F";
            }

            const resp = await fetchStockData(fetchSymbol);
            if (!isMounted) return;

            setLivePrices((prev) => ({
              ...prev,
              [sym]: {
                price: resp.current ?? 0,
                previousClose: resp.previousClose ?? resp.current ?? 0,
                lastUpdated: now,
              },
            }));
          } catch (err) {
            console.warn("Failed to fetch price", sym, err);
          }
        }
      }
    };

    fetchAllPrices();
    const interval = setInterval(fetchAllPrices, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [JSON.stringify(uniqueSymbols.map((s) => s.symbol)), livePrices]);

  // ------------------------------
  // All other logic for trades, scoring, etc. remains untouched
  const tradesWithPrices = savedTrades.map((t: any) => {
    const live = livePrices[t.symbol] ?? { price: 0, previousClose: 0 };
    const prevClose = live.previousClose ?? t.entryPrice ?? 0;

    const stoploss = prevClose * 0.985;
    const targets = [prevClose * 1.01, prevClose * 1.02, prevClose * 1.03];
    const support = prevClose * 0.995;
    const resistance = prevClose * 1.01;

    let hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" = "ACTIVE";
    if (live.price <= stoploss) hitStatus = "STOP ❌";
    else if (live.price >= Math.max(...targets)) hitStatus = "TARGET ✅";

    return {
      ...t,
      price: live.price ?? t.entryPrice,
      stoploss,
      targets,
      support,
      resistance,
      hitStatus,
      signal:
        t.direction === "long" ? "BUY" : t.direction === "short" ? "SELL" : "HOLD",
    };
  });

  const savedTradesForScoring: StockDisplay[] = tradesWithPrices.map((t: any) => {
    const stockInput = {
      symbol: t.symbol,
      current: t.price ?? t.entryPrice ?? 0,
      previousClose: t.previousClose ?? t.entryPrice ?? 0,
      prices: t.prices ?? [],
      highs: t.highs ?? [],
      lows: t.lows ?? [],
      volumes: t.volumes ?? [],
    };

    const signalResult = generateSMCSignal(stockInput);

    return {
      symbol: t.symbol,
      signal: t.signal ?? "HOLD",
      confidence: signalResult.confidence ?? 50,
      explanation:
        (t.explanation ?? "") +
        (signalResult.explanation ? ` ${signalResult.explanation}` : ""),
      price: t.price ?? t.entryPrice,
      type: t.type ?? ("stock" as const),
      support: t.support,
      resistance: t.resistance,
      stoploss: signalResult.stoploss ?? t.stoploss,
      targets: signalResult.targets ?? t.targets,
      hitStatus: t.hitStatus ?? signalResult.hitStatus,
    };
  });

  const symbolsForScoring: StockDisplay[] = symbolsWithoutTrades.map((s) => {
    const live = livePrices[s.symbol] ?? { price: 0, previousClose: 0 };
    const prevClose = live.previousClose ?? live.price ?? 0;

    const stockInput = {
      symbol: s.symbol,
      current: live.price ?? prevClose,
      previousClose: prevClose,
      prices: [],
      highs: [],
      lows: [],
      volumes: [],
    };

    const signalResult = generateSMCSignal(stockInput);

    return {
      symbol: s.symbol,
      signal: signalResult.signal ?? "HOLD",
      confidence: signalResult.confidence ?? 50,
      explanation: signalResult.explanation ?? "",
      price: live.price ?? prevClose,
      type: s.type ?? ("stock" as const),
      support: prevClose * 0.995,
      resistance: prevClose * 1.01,
      stoploss: prevClose * 0.985,
      targets: signalResult.targets ?? [prevClose],
      hitStatus: signalResult.hitStatus ?? "ACTIVE",
    } as StockDisplay;
  });

  const combinedForRanking: StockDisplay[] = [
    ...savedTradesForScoring,
    ...symbolsForScoring,
  ];

  const combinedSorted = [...combinedForRanking].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );

  const topFive = combinedSorted.slice(0, 5);
  const screenerList = combinedSorted.slice(5);

  const sortedTrades = [...tradesWithPrices].sort(
    (a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0)
  );

  const topTrades: typeof sortedTrades = [];
  const seenTypes: Record<string, boolean> = {};
  const remainingTrades: typeof sortedTrades = [];

  for (const t of sortedTrades) {
    if (!seenTypes[t.type]) {
      topTrades.push(t);
      seenTypes[t.type] = true;
    } else {
      remainingTrades.push(t);
    }
  }

  const previousTargetHits = [...savedTrades]
    .filter(
      (t) =>
        t?.status === "target_hit" ||
        t?.hitStatus === "TARGET ✅" ||
        (t?.resolved && t?.finalPrice)
    )
    .sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0))
    .slice(0, 2);

  const fuseIndex = useMemo(() => {
    const options: Fuse.IFuseOptions<StockDisplay> = {
      keys: ["symbol"],
      threshold: 0.35,
      includeScore: true,
    };
    return new Fuse(combinedSorted, options);
  }, [combinedSorted.length]);

  const handleSearch = (term?: string) => {
    const isPro = Boolean((user as any)?.isPro);

    if (!isPro) {
      setToast({ msg: "Please upgrade to Pro to enable search.", bg: "bg-red-600" });
      return;
    }

    const rawTerm = (term ?? search).toLowerCase().trim();
    if (!rawTerm) {
      setFilteredResults([]);
      setSuggestions([]);
      return;
    }

    const results = fuseIndex.search(rawTerm, { limit: 100 }).map((r) => r.item);
    const catFiltered =
      category === "all" ? results : results.filter((r) => r.type === category);

    setFilteredResults(catFiltered);
    setSuggestions(catFiltered.slice(0, 6));
  };

  const handleSelectSuggestion = (s: StockDisplay) => {
    const isPro = Boolean((user as any)?.isPro);
    if (!isPro) {
      setToast({ msg: "Please upgrade to Pro to enable search.", bg: "bg-red-600" });
      return;
    }
    setSearch(s.symbol);
    setFilteredResults([s]);
    setSuggestions([]);
  };

  const handleAddToWatchlist = async (symbol: string, type: SymbolType = "stock") => {
    if (!userEmail) {
      setToast({ msg: "Please login to add to watchlist.", bg: "bg-red-600" });
      return;
    }
    try {
      await addToWatchlist(userEmail, symbol, type);
      setToast({ msg: `${symbol} added to watchlist`, bg: "bg-green-600" });
      const wl = await getUserWatchlist(userEmail);
      setUserWatchlist((wl ?? []).map((w: any) => ({ id: w.id, userEmail: w.userEmail, symbol: w.symbol, type: (w.type ?? "stock") })));
    } catch (err) {
      console.error(err);
      setToast({ msg: "Failed to add to watchlist", bg: "bg-red-600" });
    }
  };

  const handleRemoveFromWatchlist = async (id: string) => {
    if (!userEmail) {
      setToast({ msg: "Please login to remove from watchlist.", bg: "bg-red-600" });
      return;
    }
    try {
      await removeFromWatchlist(id);
      setToast({ msg: `Removed from watchlist`, bg: "bg-yellow-600" });
      const wl = await getUserWatchlist(userEmail);
      setUserWatchlist((wl ?? []).map((w: any) => ({ id: w.id, userEmail: w.userEmail, symbol: w.symbol, type: (w.type ?? "stock") })));
    } catch (err) {
      console.error(err);
      setToast({ msg: "Failed to remove from watchlist", bg: "bg-red-600" });
    }
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!suggestionsRef.current) return;
      if (!suggestionsRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const normalizeForKey = (s: string) => s.replace(/\s+/g, "_").replace(/\//g, "-");

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* Back to Home + Title */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <Link href="/" className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
          ← Back to Home
        </Link>
      </div>

      {toast && <div className={`p-3 text-white rounded mb-4 ${toast.bg}`}>{toast.msg}</div>}

      {!user ? (
        <p className="text-gray-500">Please log in to see your watchlist.</p>
      ) : (
        <>
          {/* SEARCH + AUTOSUGGEST */}
          <div className="mb-6">
            <div className="flex gap-2">
              <div className="relative flex-1" ref={suggestionsRef}>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    const isPro = Boolean((user as any)?.isPro);
                    if (isPro && e.target.value.trim().length > 0) {
                      const res = fuseIndex.search(e.target.value, { limit: 6 }).map((r) => r.item);
                      const catFiltered = category === "all" ? res : res.filter((r) => r.type === category);
                      setSuggestions(catFiltered.slice(0, 6));
                    } else {
                      setSuggestions([]);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="Search symbols…"
                  className="w-full px-4 py-2 rounded-lg border border-gray-300"
                />

                {suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-white shadow-lg rounded border z-50 max-h-72 overflow-auto">
                    {suggestions.map((s, idx) => (
                      <div
                        key={`${normalizeForKey(s.symbol)}-suggest-${idx}`}
                        onClick={() => handleSelectSuggestion(s)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{s.symbol}</div>
                          <div className="text-sm text-gray-500">{s.type}</div>
                        </div>
                        {s.explanation ? <div className="text-xs text-gray-500 truncate">{s.explanation}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => handleSearch()} className="bg-blue-600 text-white px-4 py-2 rounded">
                Search
              </button>
            </div>

            {/* Category filter */}
            <div className="flex gap-2 mt-3">
              {["all", "stock", "crypto", "index"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setCategory(cat as any);
                    if (search.trim().length > 0) handleSearch(search);
                  }}
                  className={`px-3 py-1 rounded-lg border ${category === cat ? "bg-black text-white" : "bg-white"}`}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* SEARCH RESULTS */}
          {filteredResults.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">Search Results</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredResults.map((s, idx) => (
                  <StockCard key={`${normalizeForKey(s.symbol)}-search-${idx}`} {...s} />
                ))}
              </div>
            </div>
          )}

          {/* TOP 5 TRADES */}
          {topFive.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">🔥 Top Trades</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {topFive.map((t, idx) => (
                  <StockCard key={`${normalizeForKey(t.symbol)}-top-${idx}`} {...t} />
                ))}
              </div>
            </div>
          )}

          {/* PREVIOUS TARGET HITS */}
          {previousTargetHits.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">🏁 Recent Target Hits</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {previousTargetHits.map((t, idx) => {
                  const key = (t._id ?? `${t.symbol}-${t.timestamp ?? idx}`) as string;
                  const display: StockDisplay = {
                    symbol: t.symbol,
                    signal: t.direction === "long" ? "BUY" : t.direction === "short" ? "SELL" : "HOLD",
                    confidence: t.confidence ?? 0,
                    explanation: t.note ?? t.explanation ?? "",
                    price: t.finalPrice ?? t.entryPrice ?? 0,
                    type: t.type ?? ("stock" as const),
                    support: t.support ?? 0,
                    resistance: t.resistance ?? 0,
                    stoploss: t.stopLoss ?? t.stoploss ?? 0,
                    targets: t.targets ?? [],
                    hitStatus: "TARGET ✅",
                  };
                  return <StockCard key={`${normalizeForKey(key)}-prevhit-${idx}`} {...display} />;
                })}
              </div>
            </div>
          )}

          {/* SCREENER */}
          {screenerList.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">Screener</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {screenerList.map((s, idx) => (
                  <StockCard key={`${normalizeForKey(s.symbol)}-screener-${idx}`} {...s} />
                ))}
              </div>
            </div>
          )}

          {/* REMAINING TRADES */}
          {remainingTrades.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-2">All Other Trades</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {remainingTrades.map((t, idx) => {
                  const key = (t._id ?? `${t.symbol}-${t.timestamp ?? idx}`) as string;
                  return <StockCard key={`${normalizeForKey(key)}-rem-${idx}`} {...t} />;
                })}
              </div>
            </div>
          )}

          {/* LIVE PRICES */}
          {symbolsWithoutTrades.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Live Prices</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {symbolsWithoutTrades.map((s, idx) => {
                  const live = livePrices[s.symbol] ?? { price: 0, previousClose: 0 };
                  const prevClose = live.previousClose ?? live.price ?? 0;

                  const stoploss = prevClose * 0.985;
                  const targets = [prevClose * 1.01, prevClose * 1.02, prevClose * 1.03];
                  const support = prevClose * 0.995;
                  const resistance = prevClose * 1.01;

                  let hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" = "ACTIVE";
                  if (live.price <= stoploss) hitStatus = "STOP ❌";
                  else if (live.price >= Math.max(...targets)) hitStatus = "TARGET ✅";

                  return (
                    <StockCard
                      key={`${normalizeForKey(s.symbol)}-live-${idx}`}
                      symbol={s.symbol}
                      type={s.type}
                      signal="HOLD"
                      confidence={0}
                      price={live.price ?? prevClose}
                      stoploss={stoploss}
                      targets={targets}
                      support={support}
                      resistance={resistance}
                      hitStatus={hitStatus}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
