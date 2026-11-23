import { NextResponse } from "next/server";
import { findGameRuntime } from "@/lib/game-runtime";

/** Compatibility alias: never forward parameters, tokens or caller destinations. */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const game = findGameRuntime(gameId);
  const headers = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (!game) return new Response(null, { status: 404, headers });
  return new NextResponse(null, {
    status: 307,
    headers: { ...headers, Location: `https://xd-play.com/games/${game.id}/play` }
  });
}
