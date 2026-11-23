import { NextResponse } from "next/server";

/**
 * First-party XDPLAY discovery link for the approved virtual-credit demo.
 * This is an allowlisted redirect, not a game proxy, and deliberately never
 * forwards query strings, cookies, fragments, or untrusted wallet tokens.
 *
 * Actual gameplay remains on the isolated Mahjong Legend application.
 * Operator/agency wallet mode must complete security gates before exposure.
 */
export function GET() {
  const destination = "https://mahjong-legend-web-production.up.railway.app/?utm_source=xdplay&utm_medium=game_portal&utm_campaign=mahjong_wild";
  const response = NextResponse.redirect(destination, { status: 307 });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
