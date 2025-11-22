"use client";

import React, { useEffect, useState, useRef } from "react";
import StockCard from "../../components/StockCard";
import NotificationToast from "../../components/NotificationToast";
import { supabase } from "../../src/lib/supabaseClient";
import saveTradeToSupabase, { saveTargetHitToSupabase } from "@/src/supabase/trades";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades";
import { RL } from "../../src/quant/rlModel";
import { applyAdaptiveConfidence } from "../../src/quant/confidenceEngine";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";

const WATCHLIST_REFRESH_INTERVAL = 30000; // 30s
const CLIENT_CACHE_DURATION = 30 * 1000; // 30s cache
const MAX_CHUNK_SIZE = 10;
let clientCache: Record<string, any> = {};
let lastClientFetch = 0;

export default function Watchlist() {
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [stockData, setStockData] = useState<StockDisplay[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<any>(null);
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrade, setTargetHitTrade] = useState<any | null>(null);

  const lastSignalsRef = useRef<Record<string, string>>({});

  // ---------------- Supabase user ----------------
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

  // ---------------- Load last signals ----------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem("lastSignals");
      lastSignalsRef.current = raw ? JSON.parse(raw) : {};
    } catch {}
  }, []);

  // ---------------- Helper: normalize symbol for API ----------------
  const apiSymbol = (symbol: string) => {
    if (symbol === "BTCUSDT") return "BINANCE:BTCUSDT";
    if (symbol === "ETHUSDT") return "BINANCE:ETHUSDT";
    if (symbol === "XAUUSD") return "OANDA:XAUUSD";
    return symbol;
  };

  // ---------------- Fetch live prices with chunking, cache, retries ----------------
  const fetchLivePrices = async (symbols: string[]) => {
    const now = Date.now();
    if (now - lastClientFetch < CLIENT_CACHE_DURATION) {
      setLivePrices(clientCache);
      return clientCache;
    }

    const fetchedData: Record<string, any> = {};

    try {
      for (let i = 0; i < symbols.length; i += MAX_CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + MAX_CHUNK_SIZE).map(apiSymbol);

        let attempts = 0;
        const maxRetries = 3;
        let chunkData: Record<string, any> = {};

        while (attempts < maxRetries) {
          try {
            const res = await fetch("/api/finnhub", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbols: chunk }),
            });

            if (!res.ok) throw new Error("Failed to fetch from server");

            chunkData = await res.json();
            break;
          } catch (err) {
            attempts++;
            if (attempts >= maxRetries) {
              console.error("Failed chunk fetch:", chunk, err);
              chunk.forEach((s) => (chunkData[s] = { c: 0, pc: 0, o: 0, h: 0, l: 0 }));
            }
            await new Promise((r) => setTimeout(r, 1000 * attempts));
          }
        }

        Object.assign(fetchedData, chunkData);
      }

      clientCache = fetchedData;
      lastClientFetch = now;
      setLivePrices(fetchedData);
      return fetchedData;
    } catch (err) {
      console.error("Failed to fetch live prices:", err);
      setToast({ msg: "Failed to fetch live prices", bg: "bg-red-500" });
      return {};
    }
  };

  // ---------------- Notification + Supabase ----------------
  const maybeNotifyAndSave = async (
    symbol: string,
    provider: string,
    trade: StockDisplay,
    prevClose: number,
    currentPrice?: number
  ) => {
    const normalizedSignal = trade.signal === "BUY" || trade.signal === "SELL" ? trade.signal : "HOLD";

    if (lastSignalsRef.current[symbol] === normalizedSignal) return;
    lastSignalsRef.current[symbol] = normalizedSignal;
    localStorage.setItem("lastSignals", JSON.stringify(lastSignalsRef.current));

    setToast({
      msg: `${normalizedSignal} signal on ${symbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
      currentPrice,
      stoploss: trade.stoploss,
      targets: trade.targets,
      timestamp: new Date().setHours(0, 0, 0, 0),
    });

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
      RL.update(symbol, "WIN");
    } else if (trade.stoploss && currentPrice <= trade.stoploss) {
      status = "stop_loss";
      RL.update(symbol, "LOSS");
    }

    if (status === "target_hit") {
      let hitIndex = 1;
      if (Array.isArray(trade.targets) && trade.targets.length) {
        for (let i = trade.targets.length - 1; i >= 0; i--) {
          if (currentPrice >= trade.targets[i]) {
            hitIndex = i + 1;
            break;
          }
        }
      }

      const normalizedType: "stock" | "index" | "crypto" =
        symbol.includes(".NS") || symbol.includes("XAU") || symbol.includes("OANDA")
          ? "stock"
          : symbol.includes("/") || symbol.includes("USDT")
          ? "crypto"
          : "index";

      await saveTargetHitToSupabase({
        userEmail: supabaseUser.email,
        symbol,
        type: normalizedType,
        direction: normalizedSignal === "BUY" ? "long" : "short",
        entryPrice: prevClose,
        stopLoss: trade.stoploss,
        targets: trade.targets,
        confidence: trade.confidence ?? 0,
        status: "target_hit",
        provider,
        timestamp: new Date().setHours(0, 0, 0, 0),
        hitPrice: currentPrice,
        hitTargetIndex: hitIndex,
      });

      return;
    }

    const normalizedType: "stock" | "index" | "crypto" =
      symbol.includes(".NS") || symbol.includes("XAU") || symbol.includes("OANDA")
        ? "stock"
        : symbol.includes("/") || symbol.includes("USDT")
        ? "crypto"
        : "index";

    await saveTradeToSupabase({
      userEmail: supabaseUser.email,
      symbol,
      type: normalizedType,
      direction: normalizedSignal === "BUY" ? "long" : "short",
      entryPrice: prevClose,
      confidence: trade.confidence ?? 0,
      status,
      provider,
      timestamp: new Date().setHours(0, 0, 0, 0),
    });
  };

  // ---------------- Load watchlist data ----------------
  const loadWatchlistData = async () => {
    if (!watchlistSymbols.length) return;

    setLoading(true);
    const out: StockDisplay[] = [];
    const liveData = await fetchLivePrices(watchlistSymbols);

    for (const symbol of watchlistSymbols) {
      try {
        const lp = liveData[apiSymbol(symbol)] || {};
        const price = lp.c ?? lp.pc ?? 0;
        const prev = lp.pc ?? price;

        const smc = generateSMCSignal({
          symbol,
          current: price,
          previousClose: prev,
          ohlc: { open: lp.o ?? prev, high: lp.h ?? price, low: lp.l ?? price, close: price },
          history: { prices: [], highs: [], lows: [], volumes: [] },
        });

        const adaptiveConfidence = applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(symbol));

        const stoploss =
          smc.signal === "BUY" ? prev * 0.991 : smc.signal === "SELL" ? prev * 1.009 : prev;
        const targets =
          smc.signal === "BUY"
            ? [prev * 1.01, prev * 1.02, prev * 1.03]
            : smc.signal === "SELL"
            ? [prev * 0.99, prev * 0.98, prev * 0.97]
            : [];

        const normalizedType: "stock" | "index" | "crypto" =
          symbol.includes(".NS") || symbol.includes("XAU") || symbol.includes("OANDA")
            ? "stock"
            : symbol.includes("/") || symbol.includes("USDT")
            ? "crypto"
            : "index";

        const stock: StockDisplay = {
          symbol: symbol.replace(".NS", ""),
          signal: smc.signal,
          confidence: adaptiveConfidence,
          explanation: smc.explanation ?? "",
          price,
          type: normalizedType,
          support: prev * 0.995,
          resistance: prev * 1.01,
          stoploss,
          targets,
          hitStatus: price >= Math.max(...targets) ? "TARGET ✅" : price <= stoploss ? "STOP ❌" : "ACTIVE",
        };

        out.push(stock);

        await maybeNotifyAndSave(symbol, "finnhub", stock, prev, price);
      } catch {}
    }

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

  // ---------------- Effects ----------------
  useEffect(() => {
    loadWatchlistData();
    const i = setInterval(loadWatchlistData, WATCHLIST_REFRESH_INTERVAL);
    return () => clearInterval(i);
  }, [watchlistSymbols, Object.keys(livePrices).length]);

  useEffect(() => {
    const loadUserWatchlist = async () => {
      if (!supabaseUser?.email) return;
      const trades = await getUserTrades(supabaseUser.email);
      setWatchlistSymbols(trades.map((t) => t.symbol));
    };
    loadUserWatchlist();
  }, [supabaseUser]);

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && <NotificationToast {...toast} onClose={() => setToast(null)} />}
      <h2 className="text-xl mb-4">My Watchlist</h2>
      {loading ? (
        <div>Loading…</div>
      ) : (
        stockData.map((s) => <StockCard key={s.symbol} {...s} />)
      )}
    </div>
  );
}
