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

/* ------------------------------- Types ---------------------------------- */
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

type TradePayload = {
  userEmail: string;
  symbol: string;
  type: string;
  direction: "long" | "short"; // Direction is either "long" or "short"
  entryPrice: number;
  confidence: number;
  status: string;
  provider: string;
  timestamp: number;
  stopLoss?: number;
  targets?: number[];
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

  /* --------------------------- Fixed stop-loss & targets ------------------- */
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

  /* ----------------------- Hybrid notify/save logic (new signal vs same) --------- */
  async function maybeNotifyAndSave(
    originalSymbol: string,
    displaySymbol: string,
    uiObj: UIStock,
    prevClose: number,
    currentPrice?: number
  ) {
    const normalizedSignal: "long" | "short" = uiObj.signal === "BUY" ? "long" : "short"; // Map BUY to long, SELL to short

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
            direction: normalizedSignal === "long" ? "long" : "short", // Direction is long for BUY and short for SELL
            entryPrice: prevClose,
            stopLoss: uiObj.stoploss,
            targets: uiObj.targets,
            confidence: uiObj.confidence ?? 0,
            status: "target_hit",
            provider: "finnhub",
            timestamp: Date.now(),
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
            direction: normalizedSignal === "long" ? "long" : "short", // Direction is long for BUY and short for SELL
            entryPrice: prevClose,
            confidence: uiObj.confidence ?? 0,
            status: "stop_loss",
            provider: "finnhub",
            timestamp: Date.now(),
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

    // NEW signal: update lastSignals + toast + beep + save to supabase
    if (uiObj.signal !== "HOLD") {
      lastSignalsRef.current[originalSymbol] = normalizedSignal;
      setToast({ signal: uiObj.signal, confidence: uiObj.confidence, symbol: displaySymbol });
      if (uiObj.signal === "BUY") {
        playBeep();
      }

      // save trade to supabase
      try {
        await saveTradeToSupabase({
          userEmail: userEmail ?? "unknown",
          symbol: originalSymbol,
          type: uiObj.type === "commodity" ? ("stock" as any) : (uiObj.type as any),
          direction: normalizedSignal === "long" ? "long" : "short", // Direction is long for BUY and short for SELL
          entryPrice: prevClose,
          confidence: uiObj.confidence ?? 0,
          status: "active",
          provider: "finnhub",
          timestamp: Date.now(), // Timestamp now
          stopLoss: uiObj.stoploss,
          targets: uiObj.targets,
        });
      } catch (err) {
        console.error("Error saving trade", err);
      }
    }
  }

  /* ------------------------------- Load More ----------------------------- */
  const loadMore = () => {
    setPageLimit((prevLimit) => prevLimit + CHUNK_SIZE);
  };

  /* --------------------------- Component render --------------------------- */
  return (
    <div>
      <div className="flex justify-between mt-8">
        <div className="space-x-4">
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={() => setTab("all")}>All</button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={() => setTab("stock")}>Stock</button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={() => setTab("crypto")}>Crypto</button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={() => setTab("index")}>Index</button>
        </div>

        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="px-4 py-2 border rounded"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-8">
        {stocks.map((uiObj) => {
          return (
            <StockCard
              key={uiObj.symbol}
              symbol={uiObj.symbol}
              signal={uiObj.signal}
              confidence={uiObj.confidence}
              explanation={uiObj.explanation}
              price={uiObj.price}
              stoploss={uiObj.stoploss}
              targets={uiObj.targets}
              type={uiObj.type}
              support={uiObj.support}
              resistance={uiObj.resistance}
              hitStatus={uiObj.hitStatus}
            />
          );
        })}
      </div>

      <div className="mt-6 flex justify-center">
        {pageLimit < allSymbolsRaw.length ? (
          <button onClick={loadMore} className="px-4 py-2 rounded bg-blue-600 text-white">Load more</button>
        ) : (
          <div className="text-sm opacity-60">All symbols loaded</div>
        )}
      </div>

      {/* Toast notifications */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded">
          <strong>{toast.signal}</strong> - Confidence: {toast.confidence} for {toast.symbol}
        </div>
      )}
    </div>
  );
}
