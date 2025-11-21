// src/components/HeatmapBar.tsx
import React from "react";

export default function HeatmapBar({ confidence = 50 }: { confidence?: number }) {
  const pct = Math.max(0, Math.min(100, confidence));
  const color =
    pct > 80 ? "bg-[linear-gradient(90deg,#059669,#10B981)]" :
    pct > 60 ? "bg-[linear-gradient(90deg,#84CC16,#FACC15)]" :
    pct > 40 ? "bg-[linear-gradient(90deg,#F59E0B,#F97316)]" :
    "bg-[linear-gradient(90deg,#EF4444,#DC2626)]";

  return (
    <div className="w-full h-3 rounded bg-gray-200 overflow-hidden">
      <div style={{ width: `${pct}%` }} className={`h-full transition-all`} role="progressbar">
        <div style={{ width: "100%", height: "100%", background: pct>80 ? "linear-gradient(90deg,#059669,#10B981)" : pct>60 ? "linear-gradient(90deg,#84CC16,#FACC15)" : pct>40 ? "linear-gradient(90deg,#F59E0B,#F97316)" : "linear-gradient(90deg,#EF4444,#DC2626)" }} />
      </div>
    </div>
  );
}
