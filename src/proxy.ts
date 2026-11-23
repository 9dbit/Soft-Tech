import { NextRequest, NextResponse } from "next/server";

const VANITY_HOST = "uno.xd-play.com";
const SAFE_DESTINATION = "https://xd-play.com/games/uno-luck";

/**
 * Security-review-only UNO vanity hostname.
 *
 * Never forward a source URL path/query, caller-controlled token or request
 * body to a game, wallet or third-party provider. This is a marketing redirect,
 * not a gaming admission or authentication boundary.
 */
export function proxy(request: NextRequest) {
  const rawHost = (request.headers.get("host") || "").toLowerCase();
  const host = rawHost.replace(/:\d{1,5}$/, "");
  if (host !== VANITY_HOST) return NextResponse.next();

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  const response = NextResponse.redirect(SAFE_DESTINATION, 307);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = { matcher: "/:path*" };
