"use client";

import React, { useEffect, useRef, useState } from "react";
import StockCard from "@/components/StockCard";
import NotificationToast from "@/components/NotificationToast";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";
import { getTargetHitTrades } from "@/src/supabase/getUserTrades";
import { RL } from "@/src/quant/rlModel";
import { applyAdaptiveConfidence } from "@/src/quant/confidenceEngine";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";
import { fetchStockData, Provider, StockData } from "@/src/api/fetchStockData";

export default function HomePage() {
  const router = useRouter();
  const [displayStocks, setDisplayStocks] = useState<StockDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockDisplay[]>([]);
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [targetHitTrade, setTargetHitTrade] = useState<any | null>(null);
  const [toast, setToast] = useState<{ message: string; bg: string } | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Supabase auth + saved trades
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setSupabaseUser(data.user);
        const hits = await getTargetHitTrades(data.user.email!);
        setTargetHitTrade(hits.length > 0 ? hits[0] : null);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setSupabaseUser(session.user);
        const hits = await getTargetHitTrades(session.user.email!);
        setTargetHitTrade(hits.length > 0 ? hits[0] : null);
      } else {
        setSupabaseUser(null);
        setTargetHitTrade(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // small beep
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 150);
    } catch {}
  };

  const computeDefaultStopTargets = (prev: number, signal: string) => {
    const stoploss = signal === "BUY" ? prev * 0.98 : prev * 1.02;
    const targets = signal === "BUY"
      ? [prev * 1.05, prev * 1.1, prev * 1.2]
      : [prev * 0.95, prev * 0.9, prev * 0.8];
    return { stoploss, targets };
  };

  // load all stock data
  const loadData = async () => {
    setLoading(true);
    const computed: StockDisplay[] = [];

    let firstStockShown = false;
    let firstIndexShown = false;
    let firstCryptoShown = false;
    let firstGoldShown = false;

    for (const s of allSymbolsRaw) {
      try {
        const provider: Provider = s.type === "stock" || s.type === "index" || s.type === "commodity" ? "yahoo" : "finnhub";
        const stock: StockData = await fetchStockData(s.symbol, provider);
        if (!stock || stock.error) continue;

        // Ensure current price is never zero
        const price = stock.current || stock.previousClose || 0;
        const prev = stock.previousClose || price;

        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: price,
          previousClose: prev,
          ohlc: { open: price, high: price, low: price, close: price },
          history: { prices: stock.prices ?? [], highs: stock.highs ?? [], lows: stock.lows ?? [], volumes: stock.volumes ?? [] },
        });

        const { stoploss, targets } = computeDefaultStopTargets(prev, smc.signal);

        const confidence = (smc.signal === "BUY" || smc.signal === "SELL")
          ? Math.min(100, Math.max(70, applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(s.symbol))))
          : 50;

        const displaySymbol = s.symbol.replace(/\.NS$/, "");

        const type: StockDisplay["type"] =
          displaySymbol === "XAUUSD" ? "commodity" :
          displaySymbol === "BTCUSDT" || displaySymbol === "ETHUSDT" ? "crypto" :
          s.type === "index" ? "index" : "stock";

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

        // Show only first stock/index/crypto/gold on homepage
        if ((type === "stock" && !firstStockShown) ||
            (type === "index" && !firstIndexShown) ||
            (type === "crypto" && !firstCryptoShown) ||
            (type === "commodity" && !firstGoldShown)) {

          computed.push(stockDisplay);
          if (type === "stock") firstStockShown = true;
          if (type === "index") firstIndexShown = true;
          if (type === "crypto") firstCryptoShown = true;
          if (type === "commodity") firstGoldShown = true;
        }

      } catch (err) {
        console.error("symbol processing error", s.symbol, err);
      }
    }

    if (mountedRef.current) setDisplayStocks(computed);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 60_000);
    return () => clearInterval(id);
  }, []);

  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ message: "Only Pro member access", bg: "bg-red-600" });
      return;
    }
    const term = search.trim().toLowerCase();
    setSearchResults(term ? displayStocks.filter(s => s.symbol.toLowerCase().includes(term)) : displayStocks);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && <NotificationToast message={toast.message} bg={toast.bg} onClose={() => setToast(null)} />}

      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button onClick={() => router.push("/watchlist")} className="bg-yellow-500 text-white px-4 py-2 rounded">Pro Member Watchlist</button>
        <button onClick={handleSearch} className="px-4 py-2 rounded text-white bg-blue-500">Search</button>
        <button onClick={() => router.push("/")} className="bg-gray-500 text-white px-4 py-2 rounded">Back to Home</button>
        <span className="text-sm text-gray-600 ml-2">*Educational Research Work</span>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!supabaseUser}
          placeholder="Search (Pro only)"
          className="flex-1 p-2 rounded border"
        />
        <button onClick={handleSearch} className="px-4 py-2 rounded text-white bg-blue-500">Search</button>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        (searchResults.length ? searchResults : displayStocks).map(s => (
          <div key={`${s.symbol}-${s.type}`} className="mb-3">
            <StockCard {...s} />
          </div>
        ))
      )}
    </div>
  );
}
