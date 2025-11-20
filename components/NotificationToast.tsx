"use client";
import React, { useEffect } from "react";

export default function NotificationToast({
  message,
  currentPrice,
  stoploss,
  targets,
  timestamp,
  bg = "bg-blue-600",
  onClose,
}: {
  message: string;
  currentPrice?: number;
  stoploss?: number;
  targets?: number[];
  timestamp?: number;
  bg?: string;
  onClose?: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onClose && onClose(), 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : "";

  return (
    <div className={`fixed right-4 top-4 z-50 ${bg} text-white px-4 py-3 rounded shadow-lg max-w-sm`}>
      <div className="font-bold">{message}</div>
      {currentPrice !== undefined && <div>Price: {currentPrice.toFixed(2)}</div>}
      {stoploss !== undefined && <div>Stoploss: {stoploss.toFixed(2)}</div>}
      {targets && targets.length > 0 && (
        <div>Targets: {targets.map((t) => t.toFixed(2)).join(", ")}</div>
      )}
      {timeStr && <div className="text-xs mt-1">{timeStr}</div>}
    </div>
  );
}
