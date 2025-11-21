export function applyAdaptiveConfidence(base: number, rlWeight: number) {
  const adjusted = Math.min(100, Math.max(0, base * rlWeight));
  return Math.round(adjusted);
}

// Heatmap color scale: 0 = Red, 100 = Green
export function confidenceToColor(conf: number) {
  const r = Math.min(255, Math.round((100 - conf) * 2.55));
  const g = Math.min(255, Math.round(conf * 2.55));
  return `rgb(${r},${g},50)`;
}
