export const symbols = [
  // 📈 Indices (Yahoo)
  { type: "index", symbol: "^NIFTY50", provider: "yahoo" },
  { type: "index", symbol: "^BANKNIFTY", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYIT", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYFIN", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYAUTO", provider: "yahoo" },

  // 🏦 Major Indian Stocks (Yahoo) - .NS removed
  { type: "stock", symbol: "RELIANCE", provider: "yahoo" },
  { type: "stock", symbol: "TCS", provider: "yahoo" },
  { type: "stock", symbol: "INFY", provider: "yahoo" },
  { type: "stock", symbol: "HDFCBANK", provider: "yahoo" },
  { type: "stock", symbol: "ICICIBANK", provider: "yahoo" },
  { type: "stock", symbol: "LT", provider: "yahoo" },
  { type: "stock", symbol: "SBIN", provider: "yahoo" },
  { type: "stock", symbol: "ITC", provider: "yahoo" },
  { type: "stock", symbol: "HINDUNILVR", provider: "yahoo" },
  { type: "stock", symbol: "MARUTI", provider: "yahoo" },
  { type: "stock", symbol: "AXISBANK", provider: "yahoo" },
  { type: "stock", symbol: "KOTAKBANK", provider: "yahoo" },
  { type: "stock", symbol: "BAJFINANCE", provider: "yahoo" },
  { type: "stock", symbol: "BHARTIARTL", provider: "yahoo" },
  { type: "stock", symbol: "SUNPHARMA", provider: "yahoo" },
  { type: "stock", symbol: "TATAMOTORS", provider: "yahoo" },
  { type: "stock", symbol: "TATASTEEL", provider: "yahoo" },
  { type: "stock", symbol: "HCLTECH", provider: "yahoo" },
  { type: "stock", symbol: "WIPRO", provider: "yahoo" },
  { type: "stock", symbol: "ADANIENT", provider: "yahoo" },
  { type: "stock", symbol: "POWERGRID", provider: "yahoo" },
  { type: "stock", symbol: "ULTRACEMCO", provider: "yahoo" },
  { type: "stock", symbol: "ONGC", provider: "yahoo" },
  { type: "stock", symbol: "COALINDIA", provider: "yahoo" },
  { type: "stock", symbol: "HDFCLIFE", provider: "yahoo" },

  // 🌎 US Stocks (Finnhub) - keep as is
  { type: "stock", symbol: "NASDAQ:TESLA", provider: "finnhub" },
  { type: "stock", symbol: "NASDAQ:APPLE", provider: "finnhub" },
  { type: "stock", symbol: "NASDAQ:NVIDIA", provider: "finnhub" },

  // 💎 Cryptos (Finnhub) - keep as is
  { type: "crypto", symbol: "BINANCE:BTCUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:ETHUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:SOLUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:XRPUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:ADAUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:DOGEUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:MATICUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:AVAXUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:DOTUSDT", provider: "finnhub" },
  { type: "crypto", symbol: "BINANCE:LTCUSDT", provider: "finnhub" },

  // 🌟 Gold (Yahoo)
  { type: "commodity", symbol: "GC=F", provider: "yahoo" }
];
