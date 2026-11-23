import { NextResponse } from "next/server";
// Read-only public release state. This endpoint never has access to a wallet.
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    game: "uno-luck",
    provider: "XDPLAY",
    status: "security_review",
    launch_enabled: false,
    purchases_enabled: false,
    redemption_enabled: false,
    canonical_url: "https://xd-play.com/games/uno-luck",
  }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
