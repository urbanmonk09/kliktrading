// src/app/(store)/watchlist/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import StockCard from "@/components/StockCard";
import { fetchStockData } from "@/src/api/fetchStockData";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";
import { generateSMCSignal } from "@/src/utils/xaiLogic";
import { applyAdaptiveConfidence } from "@/src/quant/confidenceEngine";
import { RL } from "@/src/quant/rlModel";
import saveTradeToSupabase, { saveTargetHitToSupabase } from "@/src/supabase/trades";
import { getUserTrades } from "@/src/supabase/getUserTrades";

/* -------------------------------------------------------------------------- *
 * This Watchlist page implements:
 * - Tabs (All / Stock / Crypto / Index)
 * - Secondary filter (All / Gainers / Losers)
 * - Search
 * - Local toast + browser notifications + beep
 * - Recent target hits grid
 * - Cached timestamps per symbol (persisted)
 * - RL adaptive confidence
 * - Fixed stoploss/targets until next signal
 * - Live Finnhub fetching with chunking + retries + cache
 * - Auto refresh every 60s
 * - Pagination (Load more) + chunk logic
 * - Duplicate key fix (unique by display symbol)
 * - Supabase save for trades and target hits
 * - .NS removal for UI
 * - Defensive typing: builds objects exactly matching StockCard props
 * -------------------------------------------------------------------------- */

/* ----------------------------- Configurable ------------------------------ */
const CLIENT_CACHE_DURATION = 30_000; // 30s
const CHUNK_SIZE = 10; // fetch in groups of 10
const PAGE_SIZE = 40; // how many symbols to consider initially (Load more increases)
const REFRESH_INTERVAL = 60_000; // 60s

/* -------------------------- Local helper fallbacks ------------------------ */
/* If you already have these helpers in your repo, import them there and remove the fallback. */
function fallbackNormalizeSymbolForFinnhub(sym: string) {
  // Input: "TCS.NS" or "BTCUSDT" or "XAUUSD"
  const s = sym.toUpperCase();
  if (s === "BTCUSDT") return "BINANCE:BTCUSDT";
  if (s === "ETHUSDT") return "BINANCE:ETHUSDT";
  if (s === "XAUUSD") return "OANDA:XAUUSD";
  // For NSE symbols, finnhub often uses "TCS.NS" (keeping original)
  return s;
}
function fallbackNormalizeForKey(sym: string) {
  return (sym || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* signal timestamp store: per-symbol timestamp kept in-memory + localStorage fallback */
const SIGNAL_TS_KEY = "signalTimestamps_v1";
function loadSignalTimestamps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SIGNAL_TS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveSignalTimestamps(obj: Record<string, number>) {
  try {
    localStorage.setItem(SIGNAL_TS_KEY, JSON.stringify(obj));
  } catch {}
}
let signalTimestamps = loadSignalTimestamps();
function getSignalTimestamp(sym: string) {
  if (!signalTimestamps[sym]) signalTimestamps[sym] = Date.now();
  saveSignalTimestamps(signalTimestamps);
  return signalTimestamps[sym];
}
function resetSignalTimestamp(sym: string) {
  signalTimestamps[sym] = Date.now();
  saveSignalTimestamps(signalTimestamps);
}

/* ------------------------------- Types ---------------------------------- */
/* Minimal UI item used by StockCard — matches StockCard props from your repo */
type UIStock = {
  symbol: string; // display symbol without .NS
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  explanation: string;
  price?: number;
  type: "stock" | "index" | "crypto" | "commodity";
  stoploss?: number;
  targets?: number[];
  support?: number;
  resistance?: number;
  hitStatus?: "ACTIVE" | "TARGET ✅" | "STOP ❌";
};

/* ---------------------------- Client cache state ------------------------ */
let clientCache: Record<string, any> = {};
let lastClientFetch = 0;

/* --------------------------- Main Component ----------------------------- */
export default function WatchlistPage() {
  // data / ui state
  const [stocks, setStocks] = useState<UIStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE); // pagination Load more
  const [tab, setTab] = useState<"all" | "stock" | "crypto" | "index">("all");
  const [secondaryFilter, setSecondaryFilter] = useState<"all" | "gainers" | "losers">("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<any | null>(null);
  const [recentHits, setRecentHits] = useState<any[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);

  // refs for dedupe + last signals
  const lastSignalsRef = useRef<Record<string, string>>({});
  const mountedRef = useRef(true);
  const tradeBookRef = useRef<Record<string, { stoploss?: number; targets?: number[]; signal?: string }>>({});

  // prefer project helpers if they exist; otherwise use fallback
  const normalizeSymbolForFinnhub = ((): (s: string) => string => {
    try {
      // prefer import if available (won't throw if module exists)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const maybe = require("@/src/utils/helpers");
      if (maybe && typeof maybe.normalizeSymbolForFinnhub === "function") return maybe.normalizeSymbolForFinnhub;
    } catch {}
    return fallbackNormalizeSymbolForFinnhub;
  })();

  const normalizeForKey = ((): (s: string) => string => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const maybe = require("@/src/utils/helpers");
      if (maybe && typeof maybe.normalizeForKey === "function") return maybe.normalizeForKey;
    } catch {}
    return fallbackNormalizeForKey;
  })();

  // mount/unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // load supabase user & saved trades (dynamic import to avoid SSR issues)
  useEffect(() => {
    (async () => {
      try {
        const { supabase } = await import("@/src/lib/supabaseClient");
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setUserEmail(data.user.email ?? null);
          setSavedTrades(await getUserTrades(data.user.email ?? ""));
        }
        const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
          if (session?.user) {
            setUserEmail(session.user.email ?? null);
            getUserTrades(session.user.email ?? "").then((t) => setSavedTrades(t));
          } else {
            setUserEmail(null);
            setSavedTrades([]);
          }
        });
        // cleanup
        return () => listener.subscription.unsubscribe();
      } catch (err) {
        // ignore auth errors during dev
      }
    })();
  }, []);

  /* ---------------------------- Audio beep ----------------------------- */
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 140);
    } catch {}
  };

  /* --------------------------- Finnhub fetching ------------------------ */
  const fetchChunkedFinnhub = async (symbols: string[]): Promise<Record<string, any>> => {
    const now = Date.now();
    if (now - lastClientFetch < CLIENT_CACHE_DURATION && Object.keys(clientCache).length) {
      return clientCache;
    }

    const fetched: Record<string, any> = {};

    const fetchChunk = async (chunk: string[], retries = 3) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await fetch("/api/finnhub", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: chunk }),
          });
          if (!res.ok) throw new Error("finnhub chunk failed");
          return await res.json();
        } catch (err) {
          if (attempt === retries - 1) throw err;
          await new Promise((r) => setTimeout(r, 700 + attempt * 300));
        }
      }
    };

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunkRaw = symbols.slice(i, i + CHUNK_SIZE);
      const chunk = chunkRaw.map(normalizeSymbolForFinnhub);
      try {
        const data = await fetchChunk(chunk);
        Object.assign(fetched, data);
      } catch (err) {
        console.error("finnhub chunk error", err);
        chunk.forEach((k) => (fetched[k] = { c: null, pc: null, o: null, h: null, l: null }));
      }
    }

    clientCache = fetched;
    lastClientFetch = Date.now();
    return fetched;
  };

  /* ----------------------- Fixed stop-loss & targets ------------------- */
  // stoploss fixed at 0.6% -> BUY: *0.994, SELL: *1.006
  // targets: 0.78%, 1%, 1.32% -> multipliers 1.0078, 1.01, 1.0132 (BUY)
  function fixedStopTargets(price: number, signal: "BUY" | "SELL" | "HOLD") {
    if (!price || price <= 0) return { stoploss: 0, targets: [] as number[] };
    const stoploss = signal === "BUY" ? price * 0.994 : signal === "SELL" ? price * 1.006 : price;
    const targets =
      signal === "BUY"
        ? [price * 1.0078, price * 1.01, price * 1.0132]
        : signal === "SELL"
        ? [price * 0.9922, price * 0.99, price * 0.9868]
        : [];
    return { stoploss, targets };
  }

  /* ------------ Hybrid notify/save logic (new signal vs same) --------- */
  async function maybeNotifyAndSave(
    originalSymbol: string,
    displaySymbol: string,
    uiObj: UIStock,
    prevClose: number,
    currentPrice?: number
  ) {
    const normalizedSignal = uiObj.signal === "BUY" || uiObj.signal === "SELL" ? uiObj.signal : "HOLD";

    // if same signal as last time: only auto-save hits
    if (lastSignalsRef.current[originalSymbol] === normalizedSignal) {
      // target hit -> insert target_hit
      if (currentPrice !== undefined && uiObj.targets && uiObj.targets.length && currentPrice >= Math.max(...uiObj.targets)) {
        let hitIndex = 1;
        for (let i = uiObj.targets.length - 1; i >= 0; i--) {
          if (currentPrice >= (uiObj.targets?.[i] ?? 0)) {
            hitIndex = i + 1;
            break;
          }
        }
        try {
          await saveTargetHitToSupabase({
            userEmail: userEmail ?? "unknown",
            symbol: originalSymbol,
            type: uiObj.type === "commodity" ? ("stock" as any) : (uiObj.type as any),
            direction: normalizedSignal === "BUY" ? "long" : "short",
            entryPrice: prevClose,
            stopLoss: uiObj.stoploss,
            targets: uiObj.targets,
            confidence: uiObj.confidence ?? 0,
            status: "target_hit",
            provider: "finnhub",
            timestamp: getSignalTimestamp(originalSymbol),
            hitPrice: currentPrice,
            hitTargetIndex: hitIndex,
          });
        } catch (err) {
          console.error("save target hit error", err);
        }
        return;
      }

      // stoploss hit -> save stop_loss
      if (currentPrice !== undefined && uiObj.stoploss !== undefined && uiObj.stoploss > 0 && currentPrice <= uiObj.stoploss) {
        try {
          await saveTradeToSupabase({
            userEmail: userEmail ?? "unknown",
            symbol: originalSymbol,
            type: uiObj.type === "commodity" ? ("stock" as any) : (uiObj.type as any),
            direction: normalizedSignal === "BUY" ? "long" : "short",
            entryPrice: prevClose,
            confidence: uiObj.confidence ?? 0,
            status: "stop_loss",
            provider: "finnhub",
            timestamp: getSignalTimestamp(originalSymbol),
            stopLoss: uiObj.stoploss,
            targets: uiObj.targets,
          } as any);
        } catch (err) {
          console.error("save stop loss error", err);
        }
        return;
      }

      return;
    }

    // NEW signal: update lastSignals + toast + beep + optional save flow
    resetSignalTimestamp(originalSymbol);
    lastSignalsRef.current[originalSymbol] = normalizedSignal;
    try {
      localStorage.setItem("lastSignals", JSON.stringify(lastSignalsRef.current));
    } catch {}

    setToast({
      msg: `${normalizedSignal} signal on ${displaySymbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
      currentPrice,
      stoploss: uiObj.stoploss,
      targets: uiObj.targets,
      timestamp: getSignalTimestamp(originalSymbol),
    });
    setTimeout(() => setToast(null), 6000);
    playBeep();

    if ("Notification" in window && Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") new Notification(`${normalizedSignal} Trade Signal: ${displaySymbol}`);
      });
    }

    if (normalizedSignal === "HOLD") return;

    // Hybrid behavior: ask user confirm before saving active trade
    const ok = window.confirm(`${normalizedSignal} on ${displaySymbol} at ${currentPrice ?? "-"}\nSave trade to your account?`);
    if (ok && userEmail) {
      try {
        await saveTradeToSupabase({
          userEmail,
          symbol: originalSymbol,
          type: uiObj.type === "commodity" ? ("stock" as any) : (uiObj.type as any),
          direction: normalizedSignal === "BUY" ? "long" : "short",
          entryPrice: prevClose,
          confidence: uiObj.confidence ?? 0,
          status: "active",
          provider: "finnhub",
          timestamp: getSignalTimestamp(originalSymbol),
          stopLoss: uiObj.stoploss,
          targets: uiObj.targets,
        } as any);

        // refresh saved trades list
        setSavedTrades(await getUserTrades(userEmail));
      } catch (err) {
        console.error("save trade error", err);
      }
    }
  }

  /* --------------------------- Core loader ----------------------------- */
  const loadWatchlist = async () => {
    setLoading(true);

    // take symbols up to pageLimit (pagination/load more)
    const limitedSymbols = allSymbolsRaw.slice(0, pageLimit).map((s) => s.symbol);

    // fetch live price chunks
    const live = await fetchChunkedFinnhub(limitedSymbols);

    // dedupe by display symbol
    const uniqueMap = new Map<string, UIStock>();

    for (const rawSym of allSymbolsRaw.slice(0, pageLimit)) {
      const orig = rawSym.symbol;
      try {
        const apiKey = normalizeSymbolForFinnhub(orig);
        const lp = live[apiKey] || {};
        const price = Number(lp.c ?? lp.pc ?? 0);
        const prev = Number(lp.pc ?? price);

        // sanitize numbers and pass to SMC generator
        const smc = generateSMCSignal({
          symbol: orig,
          current: Number(price),
          previousClose: Number(prev),
          ohlc: { open: Number(lp.o ?? prev), high: Number(lp.h ?? price), low: Number(lp.l ?? price), close: Number(price) },
          history: { prices: [], highs: [], lows: [], volumes: [] },
        });

        // fixed stop/targets for this symbol (persist until next signal change)
        const { stoploss, targets } = fixedStopTargets(prev, smc.signal as any);

        // adaptive confidence: HOLD=50, BUY/SELL 70..100
        let confidence = 50;
        if (smc.signal === "BUY" || smc.signal === "SELL") {
          confidence = Math.min(100, Math.max(70, applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(orig))));
        }

        // display symbol without .NS
        const displaySymbol = orig.replace(/\.NS$/, "");

        // detect type required by your StockDisplay (lowercase)
        let detectedType: UIStock["type"] = "stock";
        if (/BTC|ETH|SOL|DOGE|USDT/i.test(displaySymbol)) detectedType = "crypto";
        else if (/NIFTY|BANKNIFTY|SPX|DOW|NASDAQ|FTSE|HSI|N225/i.test(displaySymbol)) detectedType = "index";
        else if (/XAUUSD|GOLD|SILVER|WTI|BRENT|OIL/i.test(displaySymbol)) detectedType = "commodity";

        // Build UIStock that matches StockCard props exactly (no extra fields such as 'current')
        const uiObj: UIStock = {
          symbol: displaySymbol,
          signal: smc.signal as "BUY" | "SELL" | "HOLD",
          confidence,
          explanation: smc.explanation ?? "",
          price,
          type: detectedType,
          support: prev * 0.995,
          resistance: prev * 1.01,
          stoploss: stoploss || undefined,
          targets: targets || [],
          hitStatus: targets.length ? (price >= Math.max(...targets) ? "TARGET ✅" : price <= (stoploss ?? -Infinity) ? "STOP ❌" : "ACTIVE") : "ACTIVE",
        };

        // dedupe: if same displaySymbol exists, keep the one with higher confidence
        const existing = uniqueMap.get(displaySymbol);
        if (!existing || (uiObj.confidence ?? 0) > (existing.confidence ?? 0)) {
          uniqueMap.set(displaySymbol, uiObj);
        }

        // Hybrid save/notify
        await maybeNotifyAndSave(orig, displaySymbol, uiObj, prev, price);
      } catch (err) {
        console.error("watchlist loop err", rawSym.symbol, err);
      }
    }

    // Build array from map
    let arr = Array.from(uniqueMap.values());

    // Secondary filters (gainers/losers) use targets vs price or support/resistance heuristics
    if (secondaryFilter === "gainers") {
      arr = arr.filter((x) => (x.targets && x.targets.length ? x.price! >= x.targets[0] : false));
    } else if (secondaryFilter === "losers") {
      arr = arr.filter((x) => x.stoploss && x.price !== undefined ? x.price <= x.stoploss : false);
    }

    // Search + Tab filtering
    const searchTerm = search.trim().toLowerCase();
    arr = arr.filter((x) => {
      if (tab !== "all" && x.type !== tab) return false;
      if (!searchTerm) return true;
      return x.symbol.toLowerCase().includes(searchTerm);
    });

    // Sort by confidence desc
    arr.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    if (mountedRef.current) setStocks(arr);
    setLoading(false);
  };

  // initial load + interval
  useEffect(() => {
    loadWatchlist();
    const id = setInterval(loadWatchlist, REFRESH_INTERVAL);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLimit, tab, secondaryFilter, search]);

  /* -------------------------- UI helpers --------------------------- */
  const loadMore = () => setPageLimit((p) => Math.min(allSymbolsRaw.length, p + PAGE_SIZE));

  const topByType = useMemo(() => {
    // return best 1 per type for a compact home if needed
    const byType = { stock: null as UIStock | null, crypto: null as UIStock | null, index: null as UIStock | null, commodity: null as UIStock | null };
    for (const s of stocks) {
      if (!byType[s.type] || (s.confidence ?? 0) > (byType[s.type]!.confidence ?? 0)) byType[s.type] = s;
    }
    return byType;
  }, [stocks]);

  /* ------------------------ Recent hits (from savedTrades) ---------------- */
  useEffect(() => {
    (async () => {
      if (!userEmail) return;
      const hits = await getUserTrades(userEmail); // returns trades; adjust if you have separate endpoint
      // Filter for target_hit entries and keep most recent 10
      const th = (hits || []).filter((t: any) => t.status === "target_hit").slice(0, 10);
      setRecentHits(th);
    })();
  }, [userEmail, savedTrades]);

  /* --------------------------- Render UI ---------------------------- */
  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {/* Header / controls */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Watchlist</h1>

          {/* Tabs: All / Stock / Crypto / Index */}
          <div className="flex gap-1 ml-4">
            {(["all", "stock", "crypto", "index"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded ${tab === t ? "bg-blue-600 text-white" : "bg-gray-200"}`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Secondary filter */}
          <div className="ml-4">
            <select
              value={secondaryFilter}
              onChange={(e) => setSecondaryFilter(e.target.value as any)}
              className="p-1 rounded border"
            >
              <option value="all">All</option>
              <option value="gainers">Gainers</option>
              <option value="losers">Losers</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            placeholder="Search symbol (Pro only)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="p-2 rounded border w-48"
          />

          {/* Manual AI Recalc button (optional) */}
          <button
            onClick={() => {
              // manual recalc: recompute SMC locally for current list using price snapshot
              const recalculated = stocks.map((s) => {
                try {
                  const smc = generateSMCSignal({
                    symbol: s.symbol,
                    current: s.price ?? 0,
                    previousClose: s.price ?? 0,
                    ohlc: { open: s.price ?? 0, high: s.price ?? 0, low: s.price ?? 0, close: s.price ?? 0 },
                    history: { prices: [], highs: [], lows: [], volumes: [] },
                  });
                  const { stoploss, targets } = fixedStopTargets(s.price ?? 0, smc.signal as any);
                  let confidence = 50;
                  if (smc.signal === "BUY" || smc.signal === "SELL") {
                    confidence = Math.min(100, Math.max(70, applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(s.symbol))));
                  }
                  return { ...s, signal: smc.signal as any, confidence, stoploss, targets };
                } catch {
                  return s;
                }
              });
              setStocks(recalculated);
            }}
            className="px-3 py-1 bg-green-600 text-white rounded"
          >
            Manual AI
          </button>

          <Link href="/" className="px-3 py-1 bg-gray-200 rounded">Home</Link>
        </div>
      </div>

      {/* Recent Target Hits */}
      <div className="mb-4">
        <h3 className="font-semibold mb-2">Recent Target Hits</h3>
        <div className="flex gap-3 overflow-x-auto">
          {recentHits.length ? recentHits.map((h: any, idx: number) => (
            <div key={idx} className="bg-white p-3 rounded shadow min-w-[200px]">
              <div className="font-semibold">{h.symbol}</div>
              <div className="text-sm">Hit Price: {h.hit_price ?? h.hitPrice ?? "-"}</div>
              <div className="text-xs opacity-70">{new Date(h.hit_timestamp ?? h.timestamp ?? Date.now()).toLocaleString()}</div>
            </div>
          )) : <div className="text-sm opacity-60">No recent hits</div>}
        </div>
      </div>

      {/* Loading */}
      {loading && <div className="mb-4">Loading…</div>}

      {/* Grid of StockCards */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {stocks.map((s) => (
          <div key={`${normalizeForKey(s.symbol)}-${s.type}`}>
            <StockCard {...s} />
          </div>
        ))}
      </div>

      {/* Load more */}
      <div className="mt-6 flex justify-center">
        {pageLimit < allSymbolsRaw.length ? (
          <button onClick={loadMore} className="px-4 py-2 rounded bg-blue-600 text-white">Load more</button>
        ) : (
          <div className="text-sm opacity-60">All symbols loaded</div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 p-3 rounded shadow-lg text-white ${toast.bg}`}
          onClick={() => setToast(null)}
        >
          <div className="font-semibold">{toast.msg}</div>
          {toast.currentPrice !== undefined && <div>Price: {toast.currentPrice}</div>}
          {toast.stoploss !== undefined && <div>SL: {Number(toast.stoploss).toFixed(2)}</div>}
          {toast.targets && <div>Targets: {toast.targets.map((t: number) => t.toFixed(2)).join(", ")}</div>}
          <div className="text-xs opacity-80">{new Date(toast.timestamp ?? Date.now()).toLocaleTimeString()}</div>
        </div>
      )}
    </div>
  );
}
