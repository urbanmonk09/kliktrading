"use client";

import React, { useEffect, useState, useRef, useContext } from "react";
import Link from "next/link";

import StockCard from "@/components/StockCard";
import NotificationToast from "@/components/NotificationToast";
import { fetchStockData, Provider, StockData } from "@/src/api/fetchStockData";
import { generateSMCSignal, StockDisplay } from "@/src/utils/xaiLogic";
import { symbols as allSymbolsRaw } from "@/src/api/symbols";
import { AuthContext } from "@/src/context/AuthContext";
import { supabase } from "@/src/lib/supabaseClient";

// Table names used in Supabase:
// - trades (upsert current active trade per user+symbol)
//   columns: id (uuid), user_email, symbol, type, direction (long/short), entry_price, stoploss, targets (jsonb), confidence, status (active/target_hit/stop_hit), last_updated
// - trade_history (append-only backtest log)
//   columns: id (uuid), user_email, symbol, entry_price, exit_price, outcome (target|stop), target_index (1|2|3|null), timestamp

type TabType = "top" | "stock" | "index" | "crypto" | "commodity" | "all";

export default function WatchlistPage() {
  const { user } = useContext(AuthContext);
  const userEmail = (user as any)?.email ?? "";

  const [livePrices, setLivePrices] = useState<Record<string, { price: number; previousClose: number; lastUpdated: number }>>({});
  const [displayStocks, setDisplayStocks] = useState<StockDisplay[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("top");
  const [toast, setToast] = useState<{ msg: string; bg?: string } | null>(null);

  const mountedRef = useRef(true);
  const REFRESH_INTERVAL = 180_000; // 3 min

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const apiSymbol = (symbol: string) => {
    if (symbol === "BTC/USD") return "BTC-USD";
    if (symbol === "ETH/USD") return "ETH-USD";
    if (symbol === "XAU/USD") return "GC=F";
    return symbol;
  };

  // Risk model from earlier conversation
  const computeRiskModel = (prev: number, signal: string) => {
    let stoploss = prev;
    let targets = [prev];

    const SL = 0.006;
    const T1 = 0.0078;
    const T2 = 0.01;
    const T3 = 0.0132;

    if (signal === "BUY") {
      stoploss = prev * (1 - SL);
      targets = [prev * (1 + T1), prev * (1 + T2), prev * (1 + T3)];
    } else if (signal === "SELL") {
      stoploss = prev * (1 + SL);
      targets = [prev * (1 - T1), prev * (1 - T2), prev * (1 - T3)];
    }

    return { stoploss, targets };
  };

  // ---------------------- Supabase persistence helpers ----------------------
  // Upsert (insert or update) current active trade for user+symbol
  async function upsertTradeToSupabase(trade: {
    user_email: string;
    symbol: string;
    type: string;
    direction: "long" | "short" | null;
    entry_price: number | null;
    stoploss: number | null;
    targets: number[] | null;
    confidence: number | null;
    status: string;
  }) {
    try {
      const { data, error } = await supabase
        .from("trades")
        .upsert(
          [
            {
              user_email: trade.user_email,
              symbol: trade.symbol,
              type: trade.type,
              direction: trade.direction,
              entry_price: trade.entry_price,
              stoploss: trade.stoploss,
              targets: trade.targets,
              confidence: trade.confidence,
              status: trade.status,
              last_updated: new Date().toISOString(),
            },
          ],
          { onConflict: "user_email,symbol" }

        );

      if (error) console.error("Supabase upsert error:", error);
      return data;
    } catch (err) {
      console.error("upsertTradeToSupabase error", err);
      return null;
    }
  }

  // Append a row to trade_history when a target/stop is hit
  async function logTradeHistory(entry: {
    user_email: string;
    symbol: string;
    entry_price: number | null;
    exit_price: number | null;
    outcome: "target" | "stop";
    target_index?: number | null;
    timestamp?: string;
  }) {
    try {
      const payload = {
        ...entry,
        timestamp: entry.timestamp ?? new Date().toISOString(),
      };
      const { data, error } = await supabase.from("trade_history").insert([payload]);
      if (error) console.error("Supabase trade_history insert error:", error);
      return data;
    } catch (err) {
      console.error("logTradeHistory error", err);
      return null;
    }
  }

  // Subscribe to trades table changes for real-time notifications (optional)
  useEffect(() => {
    if (!userEmail) return;
    const channel = supabase
      .channel(`public:trades:user=${userEmail}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trades", filter: `user_email=eq.${userEmail}` },
        (payload) => {
          // When a trade row updates, show notification
          const newRow = (payload as any).new;
          if (!newRow) return;

          // If status moved to target_hit or stop_hit, show notification
          if (newRow.status === "target_hit") {
            const title = `TARGET HIT: ${newRow.symbol}`;
            const body = `Target reached at ${newRow.exit_price ?? "--"}`;
            // Browser notification
            if (typeof window !== "undefined" && "Notification" in window) {
              if (Notification.permission === "granted") {
                new Notification(title, { body });
              } else if (Notification.permission !== "denied") {
                Notification.requestPermission();
              }
            }
            setToast({ msg: `${title} — ${body}`, bg: "bg-green-600" });
          } else if (newRow.status === "stop_hit") {
            const title = `STOP LOSS: ${newRow.symbol}`;
            const body = `Stop hit at ${newRow.exit_price ?? "--"}`;
            if (typeof window !== "undefined" && "Notification" in window) {
              if (Notification.permission === "granted") new Notification(title, { body });
              else if (Notification.permission !== "denied") Notification.requestPermission();
            }
            setToast({ msg: `${title} — ${body}`, bg: "bg-red-600" });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  // ---------------------- Fetch prices loop ----------------------
  useEffect(() => {
    let allowed = true;

    const fetchPrices = async () => {
      const now = Date.now();

      for (const s of allSymbolsRaw) {
        const sym = apiSymbol(s.symbol);
        const last = livePrices[sym]?.lastUpdated ?? 0;
        if (now - last < REFRESH_INTERVAL) continue;

        try {
          const provider: Provider = s.type === "crypto" ? "finnhub" : "yahoo";
          const resp: StockData = await fetchStockData(sym, provider);

          if (!allowed) return;

          setLivePrices((prev) => ({
            ...prev,
            [sym]: {
              price: resp.current ?? 0,
              previousClose: resp.previousClose ?? resp.current ?? 0,
              lastUpdated: now,
            },
          }));
        } catch (err) {
          console.warn("Fetch failed for:", s.symbol, err);
        }
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 10000);

    return () => { allowed = false; clearInterval(interval); };
  }, [JSON.stringify(allSymbolsRaw.map((s) => s.symbol)), livePrices]);

  // ---------------------- Build display and persist trades ----------------------
  useEffect(() => {
    const run = async () => {
      const computed: StockDisplay[] = [];

      for (const s of allSymbolsRaw) {
        const symbolClean = apiSymbol(s.symbol);
        const live = livePrices[symbolClean] ?? { price: 0, previousClose: 0 };
        const prevClose = live.previousClose || live.price || 0;

        const smc = generateSMCSignal({
          symbol: s.symbol,
          current: live.price,
          previousClose: prevClose,
          ohlc: { open: live.price, high: live.price, low: live.price, close: live.price },
          history: { prices: [], highs: [], lows: [], volumes: [] },
        });

        // Compute stoploss/targets using the stable risk model
        const { stoploss, targets } = computeRiskModel(prevClose, smc.signal);

        const hitStatus =
          live.price >= Math.max(...targets)
            ? "TARGET ✅"
            : live.price <= stoploss
            ? "STOP ❌"
            : "ACTIVE";

        const type =
          s.symbol === "XAU/USD" ? "commodity" : s.type === "crypto" ? "crypto" : s.type === "index" ? "index" : "stock";

        // Persist trade to Supabase (create or update) if user logged in and we have a BUY/SELL
        if (userEmail && (smc.signal === "BUY" || smc.signal === "SELL")) {
          const direction = smc.signal === "BUY" ? "long" : "short";

          // Upsert trade: entry_price is prevClose (you can change logic to use live.price if desired)
          await upsertTradeToSupabase({
            user_email: userEmail,
            symbol: s.symbol.replace(/\.NS$/, ""),
            type,
            direction,
            entry_price: prevClose,
            stoploss,
            targets,
            confidence: smc.confidence ?? 50,
            status: "active",
          });
        }

        // If the trade was active in DB and hit target or stop, record in trade_history and update trade row
        // We'll query Supabase for active trade for this user+symbol and then update if needed
        if (userEmail) {
          try {
            const { data: activeTrades, error } = await supabase
              .from("trades")
              .select("id,symbol,status,entry_price,targets")
              .eq("user_email", userEmail)
              .eq("symbol", s.symbol.replace(/\.NS$/, ""))
              .eq("status", "active")
              .limit(1);

            if (error) console.error("supabase select error:", error);

            if (activeTrades && activeTrades.length > 0) {
              const active = activeTrades[0] as any;

              if (hitStatus === "TARGET ✅") {
                // determine which target
                let targetIndex: number | null = null;
                const tArr: number[] = active.targets ?? targets;
                for (let i = 0; i < tArr.length; i++) {
                  if (live.price >= tArr[i]) { targetIndex = i + 1; break; }
                }

                // log history and update trade status -> target_hit
                await logTradeHistory({
                  user_email: userEmail,
                  symbol: active.symbol,
                  entry_price: active.entry_price ?? prevClose,
                  exit_price: live.price,
                  outcome: "target",
                  target_index: targetIndex,
                });

                await supabase.from("trades").update({ status: "target_hit", exit_price: live.price }).match({ id: active.id });
              } else if (hitStatus === "STOP ❌") {
                await logTradeHistory({
                  user_email: userEmail,
                  symbol: active.symbol,
                  entry_price: active.entry_price ?? prevClose,
                  exit_price: live.price,
                  outcome: "stop",
                  target_index: null,
                });

                await supabase.from("trades").update({ status: "stop_hit", exit_price: live.price }).match({ id: active.id });
              }
            }
          } catch (err) {
            console.error("Error checking/updating active trade:", err);
          }
        }

        // Build display object
        const uiSignal = smc.signal === "BUY" ? "LONG" : smc.signal === "SELL" ? "SHORT" : "HOLD";

        const display: StockDisplay = {
          symbol: s.symbol.replace(/\.NS$/, ""),
          price: live.price,
          type,
          signal: uiSignal as any,
          confidence: smc.confidence ?? 50,
          stoploss,
          targets,
          support: prevClose * 0.995,
          resistance: prevClose * 1.01,
          hitStatus,
          explanation: smc.explanation ?? "",
        };

        computed.push(display);
      }

      if (mountedRef.current) setDisplayStocks(computed);
    };

    run();
  }, [livePrices, userEmail]);

  // ---------------------- Filtering and sorting ----------------------
  const filtered = displayStocks.filter((s) => {
    const matchSearch = s.symbol.toLowerCase().includes(search.toLowerCase());
    if (activeTab === "all" || activeTab === "top") return matchSearch;
    return matchSearch && s.type === activeTab;
  });

  const sorted = [...filtered].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const topFive = sorted.slice(0, 5);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded">← Home</Link>
      </div>

      {toast && (
        <div className={`p-3 rounded text-white mb-4 ${toast.bg}`}>{toast.msg}</div>
      )}

      {/* Search */}
      <input
        className="w-full p-2 border rounded mb-4"
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {["top", "stock", "index", "crypto", "commodity", "all"].map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t as TabType)}
            className={`px-4 py-2 rounded ${ activeTab === t ? "bg-black text-white" : "bg-white border" }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(activeTab === "top" ? topFive : sorted).map((s) => (
          <StockCard key={s.symbol} {...s} />
        ))}
      </div>
    </div>
  );
}
