// src/app/(store)/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import StockCard from "@/components/StockCard";
import NotificationToast from "@/components/NotificationToast";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";
import { getUserTrades, getTargetHitTrades } from "@/src/supabase/getUserTrades";
import { RL } from "@/src/quant/rlModel";
import { applyAdaptiveConfidence } from "@/src/quant/confidenceEngine";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";
import { fetchStockData } from "@/src/api/fetchStockData"; // Import the fetchStockData function

const FIXED_SIGNAL_TIMESTAMP = new Date().setHours(0, 0, 0, 0);
const CLIENT_CACHE_DURATION = 30 * 1000;
const CHUNK_SIZE = 10;
let clientCache: Record<string, any> = {};
let lastClientFetch = 0;

export default function HomePage() {
  const router = useRouter();

  const [displayStocks, setDisplayStocks] = useState<StockDisplay[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockDisplay[]>([]);
  const [toast, setToast] = useState<any>(null);
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [targetHitTrade, setTargetHitTrade] = useState<any | null>(null);

  const lastSignalsRef = useRef<Record<string, string>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Supabase auth and saved trades
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setSupabaseUser(data.user);
        setSavedTrades(await getUserTrades(data.user.email!));
        const hits = await getTargetHitTrades(data.user.email!);
        if (hits.length > 0) setTargetHitTrade(hits[0]);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setSupabaseUser(session.user);
        setSavedTrades(await getUserTrades(session.user.email!));
        const hits = await getTargetHitTrades(session.user.email!);
        if (hits.length > 0) setTargetHitTrade(hits[0]);
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
    } catch {
      lastSignalsRef.current = {};
    }
  }, []);

  // Symbol map to Finnhub expected form
  const apiSymbol = (symbol: string) => {
    if (symbol === "BTCUSDT") return "BINANCE:BTCUSDT";
    if (symbol === "ETHUSDT") return "BINANCE:ETHUSDT";
    if (symbol === "XAUUSD") return "OANDA:XAUUSD";
    return symbol;
  };

  // small beep using WebAudio
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 150);
    } catch (e) {
      // ignore if browser blocks audio
    }
  };

  // Fetch live prices using fetchStockData
  const fetchLivePrices = async (symbols: string[]): Promise<Record<string, any>> => {
    const now = Date.now();
    if (now - lastClientFetch < CLIENT_CACHE_DURATION && Object.keys(clientCache).length) {
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
          return await res.json();
        } catch (err) {
          if (attempt === retries - 1) throw err;
          await new Promise((r) => setTimeout(r, 800 + attempt * 400));
        }
      }
    };

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunkOriginal = symbols.slice(i, i + CHUNK_SIZE);
      const chunk = chunkOriginal.map(apiSymbol);
      try {
        const data = await fetchChunk(chunk);
        Object.assign(fetchedData, data);
      } catch (err) {
        console.error("Chunk failed:", err);
        chunk.forEach((k) => {
          fetchedData[k] = { c: null, pc: null, o: null, h: null, l: null };
        });
      }
    }

    clientCache = fetchedData;
    lastClientFetch = Date.now();
    setLivePrices(fetchedData);
    return fetchedData;
  };

  // Compute default stoploss and targets
  const computeDefaultStopTargets = (prev: number, signal: string) => {
    const stoploss = signal === "BUY" ? prev * 0.98 : prev * 1.02;
    const targets = signal === "BUY"
      ? [prev * 1.05, prev * 1.1, prev * 1.2]
      : [prev * 0.95, prev * 0.9, prev * 0.8];
    return { stoploss, targets };
  };

  // Notify and save hybrid logic
  const maybeNotifyAndSaveHybrid = async (symbol: string, displaySymbol: string, stockDisplay: StockDisplay, prev: number, price: number) => {
    // Your hybrid notification and saving logic here
    // Example: Notify if signal is new, save to database if target is hit
  };

  // Update loadData to use fetchStockData for each symbol
  const loadData = async () => {
    setLoading(true);

    const computed: StockDisplay[] = [];

    for (const s of allSymbolsRaw) {
      try {
        const stock = await fetchStockData(s.symbol, "finnhub");

        if (!stock) continue;

        const price = stock.current ?? 0;
        const prev = stock.previousClose ?? price;

        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: price,
          previousClose: prev,
          ohlc: { open: price, high: price, low: price, close: price },
          history: { prices: stock.prices ?? [], highs: stock.highs ?? [], lows: stock.lows ?? [], volumes: stock.volumes ?? [] },
        });

        const { stoploss, targets } = computeDefaultStopTargets(prev, smc.signal);

        let confidence = 50;
        if (smc.signal === "BUY" || smc.signal === "SELL") {
          confidence = Math.min(100, Math.max(70, applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(s.symbol))));
        }

        const displaySymbol = s.symbol.replace(/\.NS$/, "");

        const type: StockDisplay["type"] =
          displaySymbol === "XAUUSD" ? ("commodity" as any) : displaySymbol === "BTCUSDT" || displaySymbol === "ETHUSDT" ? "crypto" : s.type === "index" ? "index" : "stock";

        const stockDisplay: StockDisplay = {
          symbol: displaySymbol,
          signal: smc.signal,
          confidence,
          explanation: smc.explanation ?? "",
          price,
          type,
          support: prev * 0.995,
          resistance: prev * 1.01,
          stoploss,
          targets,
          hitStatus: targets.length ? (price >= Math.max(...targets) ? "TARGET ✅" : price <= stoploss ? "STOP ❌" : "ACTIVE") : "ACTIVE",
        };

        computed.push(stockDisplay);

        // hybrid handling (notify + confirm for new signals; auto-save for hits)
        await maybeNotifyAndSaveHybrid(s.symbol, displaySymbol, stockDisplay, prev, price);
      } catch (err) {
        console.error("symbol proc error", s.symbol, err);
      }
    }

    if (targetHitTrade) {
      computed.push({
        symbol: targetHitTrade.symbol.replace(/\.NS$/, ""),
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
      } as StockDisplay);
    }

    // ensure fields
    const enhanced = computed.map((c) => {
      const price = c.price ?? 0;
      const { stoploss: defStop, targets: defTargets } = computeDefaultStopTargets(price, c.signal);
      const stop = c.stoploss ?? defStop;
      const targets = Array.isArray(c.targets) && c.targets.length ? c.targets : defTargets;
      const support = c.support ?? price * 0.995;
      const resistance = c.resistance ?? price * 1.01;
      const hitStatus = targets.length ? (price >= Math.max(...targets) ? "TARGET ✅" : price <= stop ? "STOP ❌" : "ACTIVE") : "ACTIVE";
      const confidence = Math.min(Math.max(c.confidence ?? 50, 50), 100);
      return { ...c, stoploss: stop, targets, support, resistance, hitStatus, confidence } as StockDisplay;
    });

    // group and pick top by type
    const group = {
      stock: enhanced.filter((x) => x.type === "stock"),
      index: enhanced.filter((x) => x.type === "index"),
      crypto: enhanced.filter((x) => x.type === "crypto"),
      commodity: enhanced.filter((x) => x.type === "commodity"),
    };

    const pickTop = (arr: StockDisplay[]) => (arr.length ? arr.sort((a, b) => b.confidence - a.confidence)[0] : null);

    const topStock = pickTop(group.stock);
    const topIndex = pickTop(group.index);
    const topCrypto = pickTop(group.crypto);
    const topCommodity = group.commodity.find((c) => c.symbol === "XAUUSD") ?? pickTop(group.commodity);

    const finalSet = [topStock, topIndex, topCrypto, topCommodity].filter(Boolean) as StockDisplay[];

    if (mountedRef.current) setDisplayStocks(finalSet);
    setLoading(false);
  };

  // auto-refresh
  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 60_000);
    return () => clearInterval(id);
  }, []);

  // search (pro)
  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ msg: "Pro membership required!", bg: "bg-red-600" });
      return;
    }
    const term = search.trim().toLowerCase();
    setSearchResults(term ? displayStocks.filter((s) => s.symbol.toLowerCase().includes(term)) : displayStocks);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && <NotificationToast {...toast} onClose={() => setToast(null)} />}

      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button onClick={() => router.push("/watchlist")} className="bg-yellow-500 text-white px-4 py-2 rounded">Pro Member Watchlist</button>
        <button onClick={handleSearch} className="px-4 py-2 rounded text-white bg-blue-500">Search</button>
        <button onClick={() => router.push("/")} className="bg-gray-500 text-white px-4 py-2 rounded">Back to Home</button>
        <span className="text-sm text-gray-600 ml-2">*Educational Research Work</span>
      </div>

      <div className="flex gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} disabled={!supabaseUser} placeholder="Search (Pro only)" className="flex-1 p-2 rounded border" />
        <button onClick={handleSearch} className="px-4 py-2 rounded text-white bg-blue-500">Search</button>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        (searchResults.length ? searchResults : displayStocks).map((s) => (
          <div key={`${s.symbol}-${s.type}`} className="mb-3"><StockCard {...s} /></div>
        ))
      )}
    </div>
  );
}
