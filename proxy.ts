import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function proxy(req: NextRequest) {
  // Use NextResponse, NOT Response
  const res = NextResponse.next();

  const supabase = createMiddlewareClient({ req, res });

  // Refresh session & attach cookies
  await supabase.auth.getSession();

  return res;
}

// Only protect specific routes
export const config = {
  matcher: ["/dashboard/:path*", "/account/:path*"],
};
