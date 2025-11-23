"use client";

import React, { useEffect, useState, useRef, useContext } from "react";
import Link from "next/link";
import StockCard, { StockCardProps } from "@/components/StockCard";
import NotificationToast from "@/components/NotificationToast";
import { supabase } from "@/src/lib/supabaseClient";
import { AuthContext } from "@/src/context/AuthContext";
import { fetchStockData, StockData, Provider } from "@/src/api/fetchStockData";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";

type TabType = "top" | "stock" | "crypto" | "index";

const MAX_CALLS_PER_3MIN = 60;

export default function WatchlistPage() {
  const { user } = useContext(AuthContext);
  const userEmail = user?.email ?? "";

  const [displayStocks, setDisplayStocks] = useState<StockDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockDisplay[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("top");
  const [toast, setToast] = useState<{ message: string; bg?: string } | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -------------------- Supabase realtime listener --------------------
  useEffect(() => {
    if (!userEmail || typeof window === "undefined") return;

    const channel = supabase
      .channel(`public:trades:user=${userEmail}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trades", filter: `user_email=eq.${userEmail}` },
        (payload: any) => {
          const newRow = payload.new;
          if (!newRow) return;

          let title = "";
          let body = "";
          let bg = "";

          if (newRow.status === "target_hit") {
            title = `TARGET HIT: ${newRow.symbol}`;
            body = `Target reached at ${newRow.exit_price ?? "--"}`;
            bg = "bg-green-600";
          } else if (newRow.status === "stop_hit") {
            title = `STOP LOSS: ${newRow.symbol}`;
            body = `Stop hit at ${newRow.exit_price ?? "--"}`;
            bg = "bg-red-600";
          }

          if (title && body) {
            if (Notification.permission === "granted") new Notification(title, { body });
            else if (Notification.permission !== "denied") Notification.requestPermission();
            setToast({ message: `${title} — ${body}`, bg });
          }
        }
      );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  // -------------------- Throttled parallel fetch --------------------
  const fetchAllSymbols = async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    const symbolBatches = [];
    for (let i = 0; i < allSymbolsRaw.length; i += MAX_CALLS_PER_3MIN) {
      symbolBatches.push(allSymbolsRaw.slice(i, i + MAX_CALLS_PER_3MIN));
    }

    const results: StockDisplay[] = [];

    for (const batch of symbolBatches) {
      const batchPromises = batch.map(async (s) => {
        const provider: Provider =
          s.type === "crypto" ? "finnhub" : "yahoo";

        const data: StockData = await fetchStockData(s.symbol, provider);

        const price = data.current ?? data.previousClose ?? 0;
        const previousClose = data.previousClose ?? price;

        const smcSignal = generateSMCSignal({
          symbol: s.symbol,
          current: price,
          previousClose,
          ohlc: { open: price, high: price, low: price, close: price },
          history: { prices: data.prices ?? [], highs: data.highs ?? [], lows: data.lows ?? [], volumes: data.volumes ?? [] },
        });

         const signal: "BUY" | "SELL" | "HOLD" =
      smcSignal.signal === "BUY" || smcSignal.signal === "SELL" ? smcSignal.signal : "HOLD";

        // TS-safe normalization
       

        const stoploss = signal === "BUY" ? previousClose * 0.994 : signal === "SELL" ? previousClose * 1.006 : previousClose;
        const targets = signal === "BUY"
          ? [previousClose * 1.0078, previousClose * 1.01, previousClose * 1.0132]
          : signal === "SELL"
          ? [previousClose * 0.9922, previousClose * 0.99, previousClose * 0.9868]
          : [previousClose];

        

        const stockType: "stock" | "crypto" | "index" | "commodity" =
          s.type === "crypto"
            ? "crypto"
            : s.type === "index"
            ? "index"
            : s.symbol === "XAU/USD"
            ? "commodity"
            : "stock";

            const hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" =
          price >= Math.max(...targets) ? "TARGET ✅" : price <= stoploss ? "STOP ❌" : "ACTIVE";

        return {
          symbol: s.symbol,
          price,
          previousClose,
          signal,
          confidence: smcSignal.confidence ?? 50,
          stoploss,
          targets,
          hitStatus,
          type: stockType,
          support: previousClose * 0.995,
          resistance: previousClose * 1.01,
          explanation: smcSignal.explanation ?? "",
        } as StockDisplay;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Wait 3 minutes before next batch to respect API throttling
      if (batch !== symbolBatches[symbolBatches.length - 1]) {
        await new Promise((res) => setTimeout(res, 180_000));
      }
    }

    if (mountedRef.current) {
      setDisplayStocks(results);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllSymbols();
  }, [userEmail]);

  // -------------------- Filter & Tabs --------------------
  const topTrades = displayStocks
    .filter((s) => s.hitStatus === "TARGET ✅")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 2); // last 2 target hits

  const filteredStocks = displayStocks.filter((s) => {
    if (activeTab === "top") return topTrades.includes(s);
    if (activeTab === "stock") return s.type === "stock";
    if (activeTab === "crypto") return s.type === "crypto";
    if (activeTab === "index") return s.type === "index";
    return true;
  });

  const sortedStocks = [...filteredStocks].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  // -------------------- Search --------------------
  const handleSearch = () => {
    if (!user) {
      setToast({ message: "Pro users only can search" });
      return;
    }
    const term = search.toLowerCase();
    setSearchResults(term ? displayStocks.filter((s) => s.symbol.toLowerCase().includes(term)) : displayStocks);
  };

    

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded">← Home</Link>
      </div>

      <p className="text-center text-sm text-gray-600 mb-4">
        Educational Research Work for guidance Only
      </p>

      {toast && (
        <NotificationToast
          message={toast.message}
          bg={toast.bg}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 p-2 border rounded"
          placeholder="Search (Pro only)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={handleSearch} className="px-4 py-2 rounded bg-blue-600 text-white">
          Search
        </button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {["top", "stock", "crypto", "index"].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as TabType)}
            className={`px-4 py-2 rounded ${
              activeTab === t ? "bg-black text-white" : "bg-white border"
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(searchResults.length > 0 ? searchResults : sortedStocks).map((s) => {
  // ✅ Type-safe signal
  const signal: "BUY" | "SELL" | "HOLD" =
    s.signal === "BUY" || s.signal === "SELL" ? s.signal : "HOLD";

  // ✅ Type-safe hitStatus
  const hitStatus: "ACTIVE" | "TARGET ✅" | "STOP ❌" =
    s.hitStatus === "TARGET ✅" || s.hitStatus === "STOP ❌" ? s.hitStatus : "ACTIVE";

  return (
    <StockCard
      key={s.symbol}
      symbol={s.symbol}
      price={s.price}
      previousClose={s.previousClose} // optional but safe
      signal={signal}                 // use the local variable
      confidence={s.confidence ?? 50}
      stoploss={s.stoploss}
      targets={s.targets}
      hitStatus={hitStatus}           // use the local variable
      type={s.type as "stock" | "index" | "crypto" | "commodity"}
      support={s.support}
      resistance={s.resistance}
      explanation={s.explanation ?? ""}
    />
  );
})}

        </div>
      )}
    </div>
  );
}
