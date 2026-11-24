import { NextResponse } from "next/server";
import { findGameRuntime } from "@/lib/game-runtime";
// Read-only public release state. This endpoint never has access to a wallet.
export const dynamic = "force-dynamic";
export function GET() {
  const runtime = findGameRuntime("uno-luck");
  const enabled = runtime?.publicLaunch === "enabled";
  return NextResponse.json({
    game: "uno-luck",
    provider: "XDPLAY",
    status: enabled ? "virtual_demo" : "security_review",
    launch_enabled: enabled,
    purchases_enabled: false,
    redemption_enabled: false,
    canonical_url: "https://xd-play.com/games/uno-luck/play",
  }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
