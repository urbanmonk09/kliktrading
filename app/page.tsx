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
    return () => {
      mountedRef.current = false;
    };
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

  // Compute stoploss and targets
const computeDefaultStopTargets = (prev: number, signal: string) => {
  // Default values (for HOLD or unknown signal)
  let stoploss = prev;
  let targets = [prev];

  // Percent values
  const SL_PERCENT = 0.006;   // 0.6%
  const T1_PERCENT = 0.0078;  // 0.78%
  const T2_PERCENT = 0.01;    // 1.00%
  const T3_PERCENT = 0.0132;  // 1.32%

  switch (signal) {
    case "BUY":
      stoploss = prev * (1 - SL_PERCENT);
      targets = [
        prev * (1 + T1_PERCENT),
        prev * (1 + T2_PERCENT),
        prev * (1 + T3_PERCENT),
      ];
      break;

    case "SELL":
      stoploss = prev * (1 + SL_PERCENT);
      targets = [
        prev * (1 - T1_PERCENT),
        prev * (1 - T2_PERCENT),
        prev * (1 - T3_PERCENT),
      ];
      break;

    // HOLD or unsupported signal → defaults stay as previous
    default:
      stoploss = prev;
      targets = [prev];
      break;
  }

  return { stoploss, targets };
};


  // Load homepage stocks
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

        const displaySymbol = s.symbol.replace(/\.NS(\.NS)?$/, ""); // remove duplicate .NS

        const type: StockDisplay["type"] =
          displaySymbol === "XAUUSD" ? "commodity" :
          displaySymbol.includes("BTC") || displaySymbol.includes("ETH") ? "crypto" :
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

        // Show toast for signals
        if (smc.signal === "BUY" || smc.signal === "SELL") {
          setToast({
            message: `Signal: ${smc.signal} (${displaySymbol})`,
            currentPrice: price,
            stoploss,
            targets,
            timestamp: Date.now(),
            bg: smc.signal === "BUY" ? "bg-green-600" : "bg-red-600",
          });
        }

        // Only show first stock/index/crypto/gold on homepage
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
        console.error("Error processing symbol", s.symbol, err);
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
        (searchResults.length ? searchResults : displayStocks).map(s => (
          <div key={`${s.symbol}-${s.type}`} className="mb-3">

            <StockCard {...s} />
          </div>
        ))
      )}
    </div>
  );
}
