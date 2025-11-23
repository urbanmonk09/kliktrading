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
  const [toast, setToast] = useState<{
    message: string;
    bg: string;
    currentPrice?: number;
    stoploss?: number;
    targets?: number[];
    timestamp?: number;
  } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---------------------- Supabase auth + saved trades ----------------------
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) setSupabaseUser(data.user);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setSupabaseUser(session.user);
      else setSupabaseUser(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---------------------- Default stoploss & targets ----------------------
  const computeDefaultStopTargets = (prev: number, signal: string) => {
    const SL = 0.006, T1 = 0.0078, T2 = 0.01, T3 = 0.0132;
    if (signal === "BUY") return { stoploss: prev * (1 - SL), targets: [prev*(1+T1), prev*(1+T2), prev*(1+T3)] };
    if (signal === "SELL") return { stoploss: prev * (1 + SL), targets: [prev*(1-T1), prev*(1-T2), prev*(1-T3)] };
    return { stoploss: prev, targets: [prev] };
  };

  // ---------------------- Load homepage stocks (parallel) ----------------------
  const loadData = async () => {
    setLoading(true);
    try {
      const promises = allSymbolsRaw.map(async (s) => {
        const provider: Provider = s.type === "stock" || s.type === "index" || s.type === "commodity" ? "yahoo" : "finnhub";
        const stock: StockData = await fetchStockData(s.symbol, provider);
        if (!stock || stock.error) return null;
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
        const confidence = smc.signal === "BUY" || smc.signal === "SELL"
          ? Math.min(100, Math.max(70, applyAdaptiveConfidence(smc.confidence ?? 50, RL.getWeight(s.symbol))))
          : 50;
        const type: StockDisplay["type"] =
          s.symbol.includes("XAU") ? "commodity" :
          s.symbol.includes("BTC") || s.symbol.includes("ETH") ? "crypto" :
          s.type === "index" ? "index" : "stock";

        return {
          symbol: s.symbol.replace(/\.NS$/, ""),
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
        } as StockDisplay;
      });

      const results = (await Promise.all(promises)).filter(Boolean) as StockDisplay[];

      // Pick one per type
      const stockCard: StockDisplay[] = [];
      const typesAdded = new Set<string>();
      for (const s of results) {
        if (!typesAdded.has(s.type)) {
          stockCard.push(s);
          typesAdded.add(s.type);
        }
        if (typesAdded.size === 4) break;
      }

      if (mountedRef.current) setDisplayStocks(stockCard);
    } catch (err) {
      console.error("loadData error", err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, []);

  const handleSearch = () => {
    if (!supabaseUser) {
      setToast({ message: "Only Pro members can search", bg: "bg-red-600" });
      return;
    }
    const term = search.trim().toLowerCase();
    setSearchResults(term ? displayStocks.filter(s => s.symbol.toLowerCase().includes(term)) : displayStocks);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      {toast && (
        <NotificationToast
          message={toast.message}
          currentPrice={toast.currentPrice}
          stoploss={toast.stoploss}
          targets={toast.targets}
          timestamp={toast.timestamp}
          bg={toast.bg}
          onClose={() => setToast(null)}
        />
      )}

      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button onClick={() => router.push("/watchlist")} className="bg-yellow-500 text-white px-4 py-2 rounded">Pro Member Watchlist</button>
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
        (searchResults.length ? searchResults : displayStocks).map((s) => {
  const signal: "BUY" | "SELL" | "HOLD" =
    s.signal === "BUY" || s.signal === "SELL" ? s.signal : "HOLD";

  const hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" =
    s.hitStatus === "TARGET ✅" || s.hitStatus === "STOP ❌" ? s.hitStatus : "ACTIVE";

  return (
    <div key={`${s.symbol}-${s.type}`} className="mb-3">
      <StockCard
        symbol={s.symbol}
        price={s.price}
        previousClose={s.previousClose} // optional but safe
        signal={signal}                 // type-safe
        confidence={s.confidence ?? 50}
        stoploss={s.stoploss}
        targets={s.targets}
        hitStatus={hitStatus}           // type-safe
        type={s.type as "stock" | "index" | "crypto" | "commodity"}
        support={s.support}
        resistance={s.resistance}
        explanation={s.explanation ?? ""}
      />
    </div>
  );
})

      )}
    </div>
  );
}
