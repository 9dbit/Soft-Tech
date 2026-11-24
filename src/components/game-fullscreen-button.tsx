"use client";

import { useEffect, useState } from "react";
import styles from "./game-viewer.module.css";

export default function GameFullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSupported(Boolean(document.fullscreenEnabled));
    const sync = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function toggle() {
    setMessage("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setMessage("Fullscreen is unavailable. You can open the game separately.");
    }
  }

  if (!supported) return null;
  return <>
    <button type="button" className={styles.external} onClick={toggle}
      aria-label={active ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={active}>
      {active ? "Exit fullscreen" : "Fullscreen"}
    </button>
    <span className={styles.srOnly} role="status">{message}</span>
  </>;
}
