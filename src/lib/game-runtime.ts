import registry from "../../config/game-runtimes.json";
import { gameEmbedUrl, gameLaunchUrl, validateRuntimeRegistry } from "../../config/runtime-policy.mjs";

export type GameRuntime = {
  id: string;
  name: string;
  label: string;
  canonicalOrigin: string;
  stagingOrigin: string | null;
  domainReady: boolean;
  publicLaunch: "enabled" | "security_review" | "staging_only";
  deploymentOrigin: string | null;
  entryPath: string | null;
};

validateRuntimeRegistry(registry);
export const gameRuntimes = registry.runtimes as GameRuntime[];
export const findGameRuntime = (id: string) => gameRuntimes.find(game => game.id === id);
export const getGameLaunchUrl = (game: GameRuntime): string | null => gameLaunchUrl(game);
export const getGameEmbedUrl = (game: GameRuntime): string | null => gameEmbedUrl(game);
