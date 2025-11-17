"use client";

import React from "react";
import { StockDisplay } from "../src/utils/xaiLogic"; // ✅ correct type import

interface StockCardProps extends Omit<StockDisplay, "signal" | "explanation"> {
  signal: "BUY" | "SELL" | "HOLD" | "LONG" | "SHORT";
  hitStatus?: "TARGET ✅" | "STOP ❌" | "ACTIVE";
  explanation?: string; // ✅ made optional (fixes type error)
}

export default function StockCard({
  symbol,
  signal,
  confidence = 0,
  explanation,
  price,
  type,
  support,
  resistance,
  stoploss,
  targets,
  hitStatus = "ACTIVE",
}: StockCardProps) {
  const formatPrice = (p?: number | null) =>
    p !== undefined && p !== null && !isNaN(p) ? p.toFixed(2) : "--";

  const formatConfidence = (c: number) =>
    !isNaN(c) ? `${c.toFixed(2)}%` : "--";

  // Map signal to display text for UI
  const displaySignal: "LONG" | "SHORT" | "HOLD" =
    signal === "BUY" || signal === "LONG"
      ? "LONG"
      : signal === "SELL" || signal === "SHORT"
      ? "SHORT"
      : "HOLD";

  // Compute hit comments based on price
  const hitComments: string[] = [];
  if (price !== undefined && stoploss !== undefined) {
    if (
      (displaySignal === "LONG" && price <= stoploss) ||
      (displaySignal === "SHORT" && price >= stoploss)
    ) {
      hitComments.push("STOP ❌");
    }
  }
  if (price !== undefined && targets?.length) {
    targets.forEach((t) => {
      if (
        (displaySignal === "LONG" && price >= t) ||
        (displaySignal === "SHORT" && price <= t)
      ) {
        hitComments.push(`TARGET ✅`);
      }
    });
  }
  const hitCommentText = hitComments.join(", ");

  // Confidence gauge circle
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference * (1 - Math.min(Math.max(confidence, 0), 100) / 100);

  // Border color based on signal
  const borderColor =
    displaySignal === "LONG"
      ? "border-green-500"
      : displaySignal === "SHORT"
      ? "border-red-500"
      : "border-blue-500";

  return (
    <div
      className={`bg-white shadow-md rounded-lg p-4 mb-4 border-l-4 ${borderColor} hover:shadow-xl transition`}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-bold">{symbol}</h2>
        <span
          className={`px-2 py-1 rounded text-white font-semibold ${
            displaySignal === "LONG"
              ? "bg-green-500"
              : displaySignal === "SHORT"
              ? "bg-red-500"
              : "bg-gray-500"
          }`}
        >
          {displaySignal}
        </span>
      </div>

      {/* Price & Status */}
      <p className="text-gray-700">
        <span className="font-semibold">Price:</span> {formatPrice(price)}
      </p>
      <p className="text-gray-700">
        <span className="font-semibold">Status:</span> {hitStatus}
      </p>

      {/* Support / Resistance */}
      <div className="flex gap-4 text-gray-600 text-sm my-1">
        <p>
          <span className="font-semibold">Support:</span> {formatPrice(support)}
        </p>
        <p>
          <span className="font-semibold">Resistance:</span>{" "}
          {formatPrice(resistance)}
        </p>
      </div>

      {/* Stoploss */}
      {stoploss !== undefined && (
        <p className="text-red-600 text-sm">
          <span className="font-semibold">Stoploss:</span>{" "}
          {formatPrice(stoploss)}
        </p>
      )}

      {/* Targets */}
      {targets?.length ? (
        <div className="text-green-600 text-sm my-1">
          <span className="font-semibold">Targets:</span>{" "}
          {targets.map((t, i) => (
            <span key={i} className="mr-2">
              {formatPrice(t)}
            </span>
          ))}
        </div>
      ) : null}

      {/* Confidence Gauge */}
      <div className="flex items-center gap-2 mt-2">
        <svg width="70" height="70" viewBox="0 0 70 70">
          <circle
            cx="35"
            cy="35"
            r={radius}
            stroke="#e5e7eb"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="35"
            cy="35"
            r={radius}
            stroke={
              confidence >= 70
                ? "#22c55e"
                : confidence >= 40
                ? "#eab308"
                : "#ef4444"
            }
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 35 35)"
          />
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontSize="12"
            fill="#111827"
          >
            {formatConfidence(confidence)}
          </text>
        </svg>
        <span className="font-semibold text-gray-700">Confidence</span>
      </div>

      {/* Hit Comments */}
      {hitCommentText && (
        <p className="text-blue-600 text-sm mt-1 font-semibold">
          {hitCommentText}
        </p>
      )}

      {/* Explanation */}
      {explanation && (
        <p className="text-gray-600 text-xs mt-1">
          <span className="font-semibold">Note:</span> {explanation}
        </p>
      )}
    </div>
  );
}
