// src/firebase/firestoreWatchlist.ts
// Compatibility shim: re-exports Supabase-backed watchlist helpers
// so existing imports (e.g. `import { getUserWatchlist } from '@/firebase/firestoreWatchlist'`)
// continue to work without changing your pages.

export { getUserWatchlist, addToWatchlist, removeFromWatchlist } from "../lib/supabaseWatchlist";
