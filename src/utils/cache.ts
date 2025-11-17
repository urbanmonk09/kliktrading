type CacheEntry = {
  timestamp: number;
  data: any;
};

const cache: Record<string, CacheEntry> = {};

export function getCache(key: string) {
  const entry = cache[key];
  if (!entry) return null;

  // cache lifetime 60 seconds
  if (Date.now() - entry.timestamp > 60000) {
    delete cache[key];
    return null;
  }

  return entry.data;
}

export function setCache(key: string, data: any) {
  cache[key] = {
    timestamp: Date.now(),
    data
  };
}
