// src/components/StockCard.tsx
"use client";

import React, { useEffect, useState } from "react";

export interface StockCardProps {
  symbol: string;
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
}

export default function StockCard({
  symbol,
  signal,
  confidence,
  explanation,
  price,
  type,
  stoploss = 0,
  targets = [],
  support,
  resistance,
  hitStatus,
}: StockCardProps) {
  const adjustedConfidence =
    signal === "HOLD"
      ? 50
      : confidence < 70
      ? 70
      : confidence > 100
      ? 100
      : confidence;

  const [animatedValue, setAnimatedValue] = useState(adjustedConfidence);

  useEffect(() => {
    let rafId: number;
    const animate = () => {
      setAnimatedValue((prev) => {
        if (Math.abs(prev - adjustedConfidence) < 0.5) return adjustedConfidence;
        return prev + (adjustedConfidence - prev) * 0.1;
      });
      rafId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(rafId);
  }, [adjustedConfidence]);

  const color =
    signal === "BUY"
      ? "#16a34a"
      : signal === "SELL"
      ? "#ef4444"
      : "#9ca3af";

  const normalizedValue = Math.min(Math.max(animatedValue, 0), 100);
  const dashArray = `${normalizedValue}, 100`;

  return (
    <div className="bg-white p-4 rounded-lg shadow flex items-center gap-4">
      {/* Left: Confidence Donut */}
      <div className="w-16 h-16 relative flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full">
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="4"
          />
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={dashArray}
            strokeLinecap="round"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
          {Math.round(animatedValue)}%
        </div>
      </div>

      {/* Right: Info */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">{symbol}</h2>
          <span
            className={`px-2 py-1 rounded font-semibold text-white ${
              signal === "BUY"
                ? "bg-green-600"
                : signal === "SELL"
                ? "bg-red-600"
                : "bg-gray-400"
            }`}
          >
            {signal}
          </span>
        </div>

        <p className="text-sm">
          Price: <span className="font-medium">{price ?? "-"}</span>
        </p>
        <p className="text-sm">
          Stoploss: <span className="font-medium">{stoploss ?? "-"}</span>
        </p>
        {targets.length > 0 && (
          <p className="text-sm">
            Targets: {targets.map((t) => t.toFixed(2)).join(", ")}
          </p>
        )}
        {support !== undefined && (
          <p className="text-sm">Support: {support.toFixed(2)}</p>
        )}
        {resistance !== undefined && (
          <p className="text-sm">Resistance: {resistance.toFixed(2)}</p>
        )}
        {hitStatus && (
          <p
            className={`text-sm font-semibold ${
              hitStatus === "TARGET ✅"
                ? "text-green-600"
                : hitStatus === "STOP ❌"
                ? "text-red-600"
                : "text-gray-600"
            }`}
          >
            {hitStatus}
          </p>
        )}
        {explanation && (
          <p className="text-xs text-gray-500 mt-1">{explanation}</p>
        )}
      </div>
    </div>
  );
}
