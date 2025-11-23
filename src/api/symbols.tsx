export const symbols = [
  // 📈 Indices (Yahoo)
  { type: "index", symbol: "^NIFTY50", provider: "yahoo" },
  { type: "index", symbol: "^BANKNIFTY", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYIT", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYFIN", provider: "yahoo" },
  { type: "index", symbol: "^NIFTYAUTO", provider: "yahoo" },

  // 🏦 Major Indian Stocks (Yahoo)
  { type: "stock", symbol: "RELIANCE.NS", provider: "yahoo" },
  { type: "stock", symbol: "TCS.NS", provider: "yahoo" },
  { type: "stock", symbol: "INFY.NS", provider: "yahoo" },
  { type: "stock", symbol: "HDFCBANK.NS", provider: "yahoo" },
  { type: "stock", symbol: "ICICIBANK.NS", provider: "yahoo" },
  { type: "stock", symbol: "LT.NS", provider: "yahoo" },
  { type: "stock", symbol: "SBIN.NS", provider: "yahoo" },
  { type: "stock", symbol: "ITC.NS", provider: "yahoo" },
  { type: "stock", symbol: "HINDUNILVR.NS", provider: "yahoo" },
  { type: "stock", symbol: "MARUTI.NS", provider: "yahoo" },
  { type: "stock", symbol: "AXISBANK.NS", provider: "yahoo" },
  { type: "stock", symbol: "KOTAKBANK.NS", provider: "yahoo" },
  { type: "stock", symbol: "BAJFINANCE.NS", provider: "yahoo" },
  { type: "stock", symbol: "BHARTIARTL.NS", provider: "yahoo" },
  { type: "stock", symbol: "SUNPHARMA.NS", provider: "yahoo" },
  { type: "stock", symbol: "TATAMOTORS.NS", provider: "yahoo" },
  { type: "stock", symbol: "TATASTEEL.NS", provider: "yahoo" },
  { type: "stock", symbol: "HCLTECH.NS", provider: "yahoo" },
  { type: "stock", symbol: "WIPRO.NS", provider: "yahoo" },
  { type: "stock", symbol: "ADANIENT.NS", provider: "yahoo" },
  { type: "stock", symbol: "POWERGRID.NS", provider: "yahoo" },
  { type: "stock", symbol: "ULTRACEMCO.NS", provider: "yahoo" },
  { type: "stock", symbol: "ONGC.NS", provider: "yahoo" },
  { type: "stock", symbol: "COALINDIA.NS", provider: "yahoo" },
  { type: "stock", symbol: "HDFCLIFE.NS", provider: "yahoo" },

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
  { type: "commodity", symbol: "XAUUSD=X", provider: "yahoo" }
];
