const timestamps: Record<string, number> = {};

export function getSignalTimestamp(symbol: string) {
  if (!timestamps[symbol]) timestamps[symbol] = Date.now();
  return timestamps[symbol];
}

export function resetSignalTimestamp(symbol: string) {
  timestamps[symbol] = Date.now();
}
