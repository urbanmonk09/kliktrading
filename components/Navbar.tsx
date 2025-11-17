"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../src/lib/supabaseClient"; // <-- Supabase client

interface SupabaseUser {
  email: string | null | undefined;
}


export default function Navbar() {
  const [user, setUser] = useState<SupabaseUser | null>(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser({ email: data.user.email });
      }
    });

    // Listen to auth state changes
    const {
      data: authListener
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({ email: session.user.email });
      } else {
        setUser(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <nav className="backdrop-blur-md bg-gray-900/80 border-b border-white/10 text-white px-6 py-4 sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        
        {/* Logo */}
        <Link
          href="/"
          className="font-extrabold text-2xl tracking-wide bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent hover:opacity-80 transition"
        >
          KlickTrading
        </Link>

        {/* Right Side */}
        <div className="flex gap-4 items-center">
          {/* If no user - show Login & Signup */}
          {!user && (
            <>
              <Link
                href="/login"
                className="px-4 py-2 rounded-full text-sm font-semibold bg-white/10 hover:bg-white/20 border border-white/20 transition"
              >
                Login
              </Link>

              <Link
                href="/signup"
                className="px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md transition"
              >
                Sign Up
              </Link>
            </>
          )}

          {/* If logged in - show user email + logout */}
          {user && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-300">
                {user.email}
              </span>

              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-red-600/80 hover:bg-red-700 transition"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
