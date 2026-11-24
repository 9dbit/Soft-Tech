import type { GameRuntime } from "@/lib/game-runtime";
import { getGameEmbedUrl, getGameLaunchUrl } from "@/lib/game-runtime";
import styles from "./game-viewer.module.css";
import GameFullscreenButton from "./game-fullscreen-button";

export default function GameViewer({ game }: { game: GameRuntime }) {
  const source = getGameLaunchUrl(game);
  if (!source) {
    return <main className={styles.unavailable}>
      <div>
        <p className={styles.brand}>XDPLAY</p>
        <h1>{game.name}</h1>
        <h2>Demo unavailable</h2>
        <p>This game is not available to play yet. Explore our available games on XDPLAY.</p>
        <a className={styles.exit} href="/games">Back to games</a>
      </div>
    </main>;
  }

  // Cross-site frames can lose SameSite=Lax game sessions. Use a top-level
  // launch until the registered same-site hostname has been verified.
  if (!getGameEmbedUrl(game)) {
    return <main className={styles.unavailable} data-launch-mode="direct">
      <div>
        <p className={styles.brand}>XDPLAY</p>
        <h1>{game.name}</h1>
        <p>Play the virtual-credit demo in its dedicated game page.</p>
        <p>No real-money purchases, deposits or withdrawals.</p>
        <nav className={styles.directActions} aria-label="Demo navigation">
          <a className={styles.exit} href={source} rel="noreferrer" referrerPolicy="no-referrer">Open demo <span aria-hidden="true">↗</span></a>
          <a className={styles.exit} href={`/games/${game.id}`} aria-label={`Back to ${game.label} on XDPLAY`}>Back to XDPLAY</a>
        </nav>
      </div>
    </main>;
  }

  return <main className={styles.launch} data-launch-mode="embedded" aria-label={`${game.label} XDPLAY game viewer`}>
    <p id="game-virtual-credit-notice" className={styles.srOnly}>
      This is a virtual-credit demo. No real-money purchases, deposits or withdrawals.
    </p>
    <a href="#game-frame" className={styles.skip}>Skip to {game.label} gameplay</a>
    <iframe
      id="game-frame"
      className={styles.gameFrame}
      src={source}
      title={`${game.name}, virtual-credit game`}
      aria-describedby="game-virtual-credit-notice"
      sandbox="allow-scripts allow-same-origin allow-modals allow-downloads"
      allow="autoplay; fullscreen"
      allowFullScreen
      loading="eager"
      referrerPolicy="no-referrer"
    />
    <header className={styles.topbar}>
      <a className={styles.exit} href={`/games/${game.id}`} aria-label={`Back to ${game.label} on XDPLAY`}>
        <span aria-hidden="true">‹</span><span className={styles.exitText}>XDPLAY</span>
      </a>
      <div className={styles.labels} aria-label="Game mode">
        <span className={styles.demoLabel}>VIRTUAL-CREDIT DEMO</span>
        {game.id === "uno-luck" && <GameFullscreenButton />}
        <a href={source} className={styles.external} target="_blank"
           rel="noopener noreferrer" referrerPolicy="no-referrer">
          Open separately <span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
    <noscript><p className={styles.noScript}>JavaScript is required for gameplay.
      <a href={source} rel="noopener noreferrer" referrerPolicy="no-referrer"> Open {game.label} directly.</a>
    </p></noscript>
  </main>;
}
