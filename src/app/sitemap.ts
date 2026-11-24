import type { MetadataRoute } from "next";
import { canLaunchGame, games } from "@/data/games";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://xd-play.com").replace(/\/$/, "");
  const gamePaths = games.filter(canLaunchGame).map(game => `/games/${game.id}`);
  return ["", "/games", ...gamePaths, "/company", "/technology", "/partners", "/contact"]
    .map(path => ({ url: base + path, lastModified: new Date() }));
}
