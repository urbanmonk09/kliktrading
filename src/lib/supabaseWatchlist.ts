// src/lib/supabaseWatchlist.ts
import { supabase } from "@/src/lib/supabaseClient";

export async function getUserWatchlist(userEmail: string) {
  if (!userEmail) return [];
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getUserWatchlist error:", error);
    return [];
  }
  return data ?? [];
}

export async function addToWatchlist(userEmail: string, symbol: string, type: string = "stock") {
  try {
    const payload = { user_email: userEmail, symbol, type };
    const { data, error } = await supabase.from("watchlist").insert(payload).select();
    if (error) {
      // Could be unique constraint violation; still return
      console.warn("addToWatchlist warning:", error);
      return null;
    }
    return data?.[0] ?? null;
  } catch (err) {
    console.error("addToWatchlist catch:", err);
    return null;
  }
}

export async function removeFromWatchlist(idOrUserSymbol: string) {
  try {
    // Delete by id OR by symbol (flexible, matches how your code calls it)
    const { data, error } = await supabase
      .from("watchlist")
      .delete()
      .or(`id.eq.${idOrUserSymbol},symbol.eq.${idOrUserSymbol}`);

    if (error) {
      console.error("removeFromWatchlist error:", error);
      return null;
    }
    return data;
  } catch (err) {
    console.error("removeFromWatchlist catch:", err);
    return null;
  }
}
