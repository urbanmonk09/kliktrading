export function normalizeSymbolForFinnhub(symbolObj: { symbol: string }) {
  if (!symbolObj?.symbol) return "";

  let symbol = symbolObj.symbol;

  // Remove .NS for finnhub but still usable for UI
  if (symbol.endsWith(".NS")) {
    return symbol.replace(".NS", "") + ":NS";
  }

  if (symbol.toUpperCase() === "XAUUSD") return "OANDA:XAUUSD";
  if (symbol.toUpperCase() === "BTCUSDT") return "BINANCE:BTCUSDT";
  if (symbol.toUpperCase() === "NIFTY") return "NSE:NIFTY";

  return symbol;
}

export function normalizeForKey(symbol: string) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
