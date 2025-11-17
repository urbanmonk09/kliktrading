// src/context/AuthContext.tsx
"use client";

import React, { createContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/src/lib/supabaseClient";

type AuthContextType = {
  user: any | null;
  signUp: (email: string, password: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<any>;
  refreshUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  signUp: async () => {},
  signIn: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    // initial session check
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription?.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    return supabase.auth.signUp({ email, password });
  };

  const signIn = async (email: string, password: string) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async () => {
    const res = await supabase.auth.signOut();
    setUser(null);
    return res;
  };

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    setUser(data?.session?.user ?? null);
  };

  return (
    <AuthContext.Provider value={{ user, signUp, signIn, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
