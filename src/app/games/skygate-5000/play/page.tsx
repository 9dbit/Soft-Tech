import type {Metadata} from "next";
import styles from "./launch.module.css";

// Audited, fixed origin. Never derive a game URL from query parameters,
// referrers, players, operator records, or request headers.
const GAME_URL="https://skygate-web-production.up.railway.app/play/";

export const metadata:Metadata={
  title:"SKYGATE 5000 | Secure Demo",
  description:"Play the Skygate 5000 virtual-credit demo in the isolated XDPLAY game viewer.",
  robots:{index:false,follow:false},
  alternates:{canonical:"/games/skygate-5000/play"}
};

export default function SkygateSecureLaunch(){
  return (
    <main className={styles.launch} aria-label="Skygate 5000 XDPLAY game viewer">
      <a href="#game-frame" className={styles.skip}>Skip to Skygate gameplay</a>
      <iframe
        id="game-frame"
        className={styles.gameFrame}
        src={GAME_URL}
        title="SKYGATE 5000, virtual-credit game"
        sandbox="allow-scripts allow-same-origin allow-modals allow-downloads"
        allow="autoplay; fullscreen"
        allowFullScreen
        loading="eager"
        referrerPolicy="no-referrer"
      />
      <header className={styles.topbar}>
        <a className={styles.exit} href="/games/skygate-5000"
           aria-label="Back to Skygate 5000 on XDPLAY">
          <span aria-hidden="true">‹</span><span className={styles.exitText}>XDPLAY</span>
        </a>
        <div className={styles.labels} aria-label="Game mode">
          <span className={styles.demoLabel}>VIRTUAL-CREDIT DEMO</span>
          <a href={GAME_URL} className={styles.external} target="_blank"
             rel="noopener noreferrer" referrerPolicy="no-referrer">
            Open separately <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
      <noscript>
        <p className={styles.noScript}>JavaScript is required for gameplay.
          <a href={GAME_URL} rel="noopener noreferrer" referrerPolicy="no-referrer"> Open Skygate directly.</a>
        </p>
      </noscript>
    </main>
  );
}
