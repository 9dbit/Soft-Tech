import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GameViewer from "@/components/game-viewer";
import { findGameRuntime, gameRuntimes } from "@/lib/game-runtime";

type Props = { params: Promise<{ gameId: string }> };
export const dynamicParams = false;
export const generateStaticParams = () => gameRuntimes.map(game => ({ gameId: game.id }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { gameId } = await params;
  const game = findGameRuntime(gameId);
  return {
    title: game ? `${game.name} | Demo` : "Game not found",
    description: game ? `Explore ${game.label} on XDPLAY.` : undefined,
    robots: { index: false, follow: false },
    alternates: game ? { canonical: `/games/${game.id}` } : undefined
  };
}

export default async function GameLaunchPage({ params }: Props) {
  const { gameId } = await params;
  const game = findGameRuntime(gameId);
  if (!game) notFound();
  return <GameViewer game={game} />;
}
