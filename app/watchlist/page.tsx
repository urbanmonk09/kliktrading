// src/app/(store)/watchlist/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import StockCard from "@/components/StockCard";
import NotificationToast from "@/components/NotificationToast";
import { supabase } from "@/src/lib/supabaseClient";
import { getTargetHitTrades } from "@/src/supabase/getUserTrades";
import { RL } from "@/src/quant/rlModel";
import { applyAdaptiveConfidence } from "@/src/quant/confidenceEngine";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";
import { fetchStockData, Provider, StockData } from "@/src/api/fetchStockData";
import { useRouter } from "next/navigation"; // <-- add this
type Tab = "TOP" | "STOCK" | "CRYPTO" | "INDEX";

export default function WatchlistPage() {
  const router = useRouter();
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [displayStocks, setDisplayStocks] = useState<StockDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; bg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("TOP");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Supabase auth
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        setSupabaseUser(data.user);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setSupabaseUser(session.user);
      } else {
        setSupabaseUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const computeDefaultStopTargets = (prev: number, signal: string) => {
    const stoploss = signal === "BUY" ? prev * 0.98 : prev * 1.02;
    const targets = signal === "BUY"
      ? [prev * 1.05, prev * 1.1, prev * 1.2]
      : [prev * 0.95, prev * 0.9, prev * 0.8];
    return { stoploss, targets };
  };

  const loadData = async () => {
    if (!supabaseUser) {
      setToast({ message: "Pro membership required!", bg: "bg-red-600" });
      return;
    }

    setLoading(true);
    const computed: StockDisplay[] = [];

    for (const s of allSymbolsRaw) {
      try {
        // Determine provider
        const provider: Provider = s.type === "stock" || s.type === "index" || s.type === "commodity" ? "yahoo" : "finnhub";
        const stock: StockData = await fetchStockData(s.symbol, provider);
        if (!stock || stock.error) continue;

        // Ensure current price never zero
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

        computed.push({
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
        } as StockDisplay);

      } catch (err) {
        console.error("symbol processing error", s.symbol, err);
      }
    }

    // Rank by confidence for each type
    const topTrades = [...computed].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 10);
    const stocks = computed.filter(s => s.type === "stock").sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const cryptos = computed.filter(s => s.type === "crypto").sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const indices = computed.filter(s => s.type === "index").sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (mountedRef.current) {
      setDisplayStocks([...topTrades, ...stocks, ...cryptos, ...indices]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 60_000);
    return () => clearInterval(id);
  }, [supabaseUser]);

  // Search functionality
  const filteredStocks = search.trim()
    ? displayStocks.filter(s => s.symbol.toLowerCase().includes(search.trim().toLowerCase()))
    : displayStocks;

  const renderTabContent = () => {
    switch (tab) {
      case "TOP":
        return filteredStocks.slice(0, 10);
      case "STOCK":
        return filteredStocks.filter(s => s.type === "stock");
      case "CRYPTO":
        return filteredStocks.filter(s => s.type === "crypto");
      case "INDEX":
        return filteredStocks.filter(s => s.type === "index");
    }
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && <NotificationToast message={toast.message} bg={toast.bg} onClose={() => setToast(null)} />}
      
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button onClick={() => router.push("/")} className="bg-gray-500 text-white px-4 py-2 rounded">Back to Home</button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search (Pro only)"
          className="flex-1 p-2 rounded border"
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(["TOP", "STOCK", "CRYPTO", "INDEX"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded ${tab === t ? "bg-blue-500 text-white" : "bg-gray-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        renderTabContent().map(s => (
          <div key={`${s.symbol}-${s.type}`} className="mb-3">
            <StockCard {...s} />
          </div>
        ))
      )}
    </div>
  );
}
