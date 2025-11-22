"use client";

import React, { useEffect, useState, useRef } from "react";
import StockCard from "../components/StockCard";
import NotificationToast from "../components/NotificationToast";
import { useRouter } from "next/navigation";
import { supabase } from "../src/lib/supabaseClient";
import saveTradeToSupabase, { saveTargetHitToSupabase } from "@/src/supabase/trades";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades";
import { RL } from "../src/quant/rlModel";
import { applyAdaptiveConfidence } from "../src/quant/confidenceEngine";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbols } from "../src/api/symbols";

const FIXED_SIGNAL_TIMESTAMP = new Date().setHours(0, 0, 0, 0);
const CLIENT_CACHE_DURATION = 30 * 1000; // 30s
const CHUNK_SIZE = 10; // API chunk size
let clientCache: Record<string, any> = {};
let lastClientFetch = 0;

export default function Home() {
  const [stockData, setStockData] = useState<StockDisplay[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
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

  // ---------- Supabase user handling ----------
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

  useEffect(() => {
    try {
      const raw = localStorage.getItem("lastSignals");
      lastSignalsRef.current = raw ? JSON.parse(raw) : {};
    } catch {}
  }, []);

  const apiSymbol = (symbol: string) => {
    if (symbol === "BTCUSDT") return "BINANCE:BTCUSDT";
    if (symbol === "ETHUSDT") return "BINANCE:ETHUSDT";
    if (symbol === "XAUUSD") return "OANDA:XAUUSD";
    return symbol;
  };

  // ---------- Robust fetch with chunking + retries + fallback ----------
  const fetchLivePrices = async (symbols: string[]): Promise<Record<string, any>> => {
    const now = Date.now();
    if (now - lastClientFetch < CLIENT_CACHE_DURATION) {
      setLivePrices(clientCache);
      return clientCache;
    }

    const fetchedData: Record<string, any> = {};

    const fetchChunk = async (chunk: string[], retries = 3) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await fetch("/api/finnhub", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: chunk }),
          });
          if (!res.ok) throw new Error("Failed to fetch chunk");
          const data = await res.json();
          return data;
        } catch (err) {
          if (attempt === retries - 1) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE).map(apiSymbol);
      try {
        const data = await fetchChunk(chunk);
        Object.assign(fetchedData, data);
      } catch (err) {
        console.error("Failed to fetch chunk after retries:", err);
        chunk.forEach((s) => {
          fetchedData[s] = { c: null, pc: null, o: null, h: null, l: null };
        });
      }
    }

    clientCache = fetchedData;
    lastClientFetch = now;
    setLivePrices(fetchedData);
    return fetchedData;
  };

  // ---------- Notification & Supabase save ----------
  const maybeNotifyAndSave = async (
    symbol: string,
    provider: string,
    trade: StockDisplay,
    prevClose: number,
    currentPrice?: number
  ) => {
    const normalizedSignal =
      trade.signal === "BUY" || trade.signal === "SELL" ? trade.signal : "HOLD";

    if (lastSignalsRef.current[symbol] === normalizedSignal) return;
    lastSignalsRef.current[symbol] = normalizedSignal;
    localStorage.setItem("lastSignals", JSON.stringify(lastSignalsRef.current));

    setToast({
      msg: `${normalizedSignal} signal on ${symbol}`,
      bg: normalizedSignal === "BUY" ? "bg-green-600" : "bg-red-600",
      currentPrice,
      stoploss: trade.stoploss,
      targets: trade.targets,
      timestamp: FIXED_SIGNAL_TIMESTAMP,
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

    const supabaseType: "stock" | "index" | "crypto" =
      symbol.includes(".NS") || symbol.includes("XAU") ? "stock" : symbol.includes("/") ? "crypto" : "index";

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

      await saveTargetHitToSupabase({
        userEmail: supabaseUser.email,
        symbol,
        type: supabaseType,
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
      userEmail: supabaseUser.email,
      symbol,
      type: supabaseType,
      direction: normalizedSignal === "BUY" ? "long" : "short",
      entryPrice: prevClose,
      confidence: trade.confidence ?? 0,
      status,
      provider,
      timestamp: FIXED_SIGNAL_TIMESTAMP,
    });
  };

  // ---------- Load Data ----------
  const loadData = async () => {
    setLoading(true);
    const out: StockDisplay[] = [];
    const liveData = await fetchLivePrices(allSymbols.map((s) => s.symbol));

    const bestByType: Record<string, StockDisplay | null> = {};

    for (const s of allSymbols) {
      try {
        const lp = liveData[apiSymbol(s.symbol)] || {};
        const price = lp.c ?? lp.pc ?? 0;
        const prev = lp.pc ?? price;

        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: price,
          previousClose: prev,
          ohlc: { open: lp.o ?? prev, high: lp.h ?? price, low: lp.l ?? price, close: price },
          history: { prices: [], highs: [], lows: [], volumes: [] },
        });

        const adaptiveConfidence = applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(s.symbol));

        const stoploss =
          smc.signal === "BUY" ? prev * 0.991 : smc.signal === "SELL" ? prev * 1.009 : prev;
        const targets =
          smc.signal === "BUY"
            ? [prev * 1.01, prev * 1.02, prev * 1.03]
            : smc.signal === "SELL"
            ? [prev * 0.99, prev * 0.98, prev * 0.97]
            : [];

        const normalizedType: "stock" | "index" | "crypto" =
          s.type === "stock" || s.type === "index" || s.type === "crypto" ? s.type : "stock";

        const stock: StockDisplay = {
          symbol: s.symbol.split(":").pop()!,
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

        if (!bestByType[s.type] || stock.confidence > bestByType[s.type]!.confidence) {
          bestByType[s.type] = stock;
        }

        await maybeNotifyAndSave(s.symbol, "finnhub", stock, prev, price);
      } catch {}
    }

    Object.values(bestByType).forEach((v) => {
      if (v) out.push(v);
    });

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

  useEffect(() => {
    loadData();
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, [Object.keys(livePrices).length]);

  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ msg: "Pro membership required!", bg: "bg-red-600" });
      return;
    }
    const term = search.trim().toLowerCase();
    if (!term) return setSearchResults(stockData);
    setSearchResults(stockData.filter((s) => s.symbol.toLowerCase().includes(term)));
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && <NotificationToast {...toast} onClose={() => setToast(null)} />}
      <div className="mb-4">
        <button
          onClick={() => router.push("/watchlist")}
          className="bg-yellow-500 text-white px-4 py-2 rounded"
        >
          Pro Member Watchlist
        </button>
        *Educational Research Work
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
        (searchResults.length ? searchResults : stockData).map((s) => (
          <StockCard key={s.symbol} {...s} />
        ))
      )}
    </div>
  );
}
