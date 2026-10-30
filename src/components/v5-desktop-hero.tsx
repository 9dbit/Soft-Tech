"use client";
import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { ArrowRight, ArrowDown, Globe2, Gamepad2, Instagram, Facebook, X, ChevronDown, LockKeyhole, Mail } from "lucide-react";

const V5_LAYERS = [
  { id: "cable", left: 160, top: 784, width: 525, height: 683, depthX: .44, depthY: .4 },
  { id: "monitor", left: 120, top: 40, width: 860, height: 800, depthX: .35, depthY: .35 },
  { id: "keyboard", left: 20, top: 774, width: 716, height: 516, depthX: .67, depthY: .68 },
  { id: "printer", left: 556, top: 902, width: 468, height: 473, depthX: 1.12, depthY: 1.1 },
  { id: "cartridge", left: 30, top: 691, width: 185, height: 239, depthX: 1.42, depthY: 1.5 },
  { id: "cursor", left: 847, top: 771, width: 169, height: 175, depthX: 1.65, depthY: 1.5 }
] as const;
const PARTS_TOTAL = V5_LAYERS.length;
function depthStyle(part: typeof V5_LAYERS[number]): CSSProperties {
  return {
    left: (part.left / 1024 * 100) + "%",
    top: (part.top / 1536 * 100) + "%",
    width: (part.width / 1024 * 100) + "%",
    height: (part.height / 1536 * 100) + "%"
  };
}

/**
 * V5 Phase A/B: static, spatially locked desktop reference composition.
 * Coordinates use the approved 1586×992 master as the authority.
 * No pointer/scroll transforms until the visual snapshot is accepted.
 */
export default function V5DesktopHero({ navigate, lang }: {
  navigate: (path: string) => void;
  lang: "EN" | "ID";
}) {
  const [missingAsset, setMissingAsset] = useState(false);
  const [loadedParts, setLoadedParts] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frameRef = useRef(0);
  const reducedMotion = useRef(false);
  const applyDepth = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reducedMotion.current) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const rect = stage.getBoundingClientRect();
      const offset = rect.top + rect.height / 2 - window.innerHeight / 2;
      const scroll = Math.max(-1, Math.min(1, -offset / (window.innerHeight + rect.height) * 2));
      stage.querySelectorAll<HTMLElement>("[data-depth-x]").forEach(el => {
        const dx = Number(el.dataset.depthX) || 0;
        const dy = Number(el.dataset.depthY) || 0;
        const x = pointer.current.x * dx * 19;
        const y = pointer.current.y * dy * 12 + scroll * dy * 13;
        el.style.setProperty("--v5-offset-x", x.toFixed(2) + "px");
        el.style.setProperty("--v5-offset-y", y.toFixed(2) + "px");
      });
    });
  };
  const handlePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || reducedMotion.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = {
      x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) * 2 / rect.width)),
      y: Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) * 2 / rect.height))
    };
    applyDepth();
  };
  const handleLeave = () => { pointer.current = {x:0, y:0}; applyDepth(); };
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      reducedMotion.current = mq.matches;
      if (mq.matches) {
        cancelAnimationFrame(frameRef.current);
        stageRef.current?.querySelectorAll<HTMLElement>("[data-depth-x]").forEach(el => {
          el.style.setProperty("--v5-offset-x", "0px");
          el.style.setProperty("--v5-offset-y", "0px");
        });
      } else applyDepth();
    };
    syncMotion();
    mq.addEventListener("change", syncMotion);
    window.addEventListener("scroll", applyDepth, { passive: true });
    window.addEventListener("resize", applyDepth, { passive: true });
    return () => {
      cancelAnimationFrame(frameRef.current);
      mq.removeEventListener("change", syncMotion);
      window.removeEventListener("scroll", applyDepth);
      window.removeEventListener("resize", applyDepth);
    };
  }, []);

  const [showPartnerNotice, setShowPartnerNotice] = useState(false);
  const [language, setLanguage] = useState<"EN"|"ID">(lang);
  useEffect(() => {
    const images = Array.from(stageRef.current?.querySelectorAll<HTMLImageElement>(".v5-depth-part img") ?? []);
    const synchronize = () => setLoadedParts(images.filter(img => img.complete && img.naturalWidth > 0).length);
    for (const img of images) {
      img.addEventListener("load", synchronize);
      img.addEventListener("error", synchronize);
    }
    synchronize();
    return () => {
      for (const img of images) {
        img.removeEventListener("load", synchronize);
        img.removeEventListener("error", synchronize);
      }
    };
  }, []);
  const t = (english: string, indonesian: string) => language === "EN" ? english : indonesian;
  return (
    <section className="v5-hero" aria-label="SOFT TECH digital game studio">
      <div className="v5-stage" ref={stageRef} onPointerMove={handlePointer} onPointerLeave={handleLeave}>
        <header className="v5-header">
          <button className="v5-brand" onClick={() => navigate("/")} aria-label="Soft Tech homepage">
            <img src="/assets/v5/soft-tech-neon-header.webp" alt="Soft Tech official neon logo" />
          </button>
          <nav className="v5-navigation" aria-label="Main navigation">
            <button className="v5-current" onClick={() => navigate("/")}>{t("Home","Beranda")}</button>
            <button onClick={() => navigate("/company")}>{t("About","Tentang")}</button>
            <button onClick={() => navigate("/games")}>{t("Games","Game")} <ChevronDown size={13}/></button>
            <button onClick={() => navigate("/technology")}>{t("Studio","Studio")}</button>
            <button onClick={() => navigate("/partners")}>{t("Partners","Mitra")}</button>
            <button onClick={() => setLanguage(language === "EN" ? "ID" : "EN")}><Globe2 size={16}/>{language === "EN" ? "English" : "Indonesia"} <ChevronDown size={13}/></button>
          </nav>
          <button className="v5-login" onClick={() => setShowPartnerNotice(true)}>Login / Register</button>
        </header>

        <div className="v5-hero-index">[ 1 / 8 ]</div>
        <h1 className="v5-headline">
          <span>BUILDING</span>
          <span>DIGITAL</span>
          <span>GAME WORLDS</span>
          <span>THAT STICK</span>
        </h1>

        <aside className="v5-stat">
          <div className="v5-stat-title"><Gamepad2 aria-hidden="true" size={49}/><strong>3</strong><span>FLAGSHIP<br/>GAMES</span></div>
          <p>{t("Our games deliver immersive play experiences that connect players and spark lasting communities.",
            "Game kami menghadirkan pengalaman imersif yang menghubungkan pemain dan menciptakan komunitas.")}</p>
        </aside>

        <span className="v5-back-word v5-soft" aria-hidden="true">SOFT</span>
        <span className="v5-back-word v5-tech" aria-hidden="true">TECH</span>

        <div className={"v5-art-layer" + (loadedParts === PARTS_TOTAL ? " v5-layers-ready" : "")}
          role="img" aria-label="Orange retro computer, mechanical keyboard, miniature printer and separate floating technological accessories">
          <div className="v5-ground-shadow" aria-hidden="true"/>
          {missingAsset && loadedParts !== PARTS_TOTAL && <div className="v5-computer-vector" aria-hidden="true">
            <div className="v5-vector-display">
              <div className="v5-vector-screen">IDEA FOUND<br/>KEEP GOING_</div>
              <div className="v5-vector-knobs">●<br/>●<br/>●</div>
            </div>
            <div className="v5-vector-keyboard"/>
            <div className="v5-vector-printer">CREATE</div>
          </div>}
          {!missingAsset && (
            <img className="v5-orange-computer"
              src="/assets/v5/orange-computer-cutout.webp"
              alt="Orange retro computer floating above a mechanical keyboard, small printer and coiled cable"
              onError={() => setMissingAsset(true)} />
          )}
          <div className="v5-depth-composition" aria-hidden="true">
            {V5_LAYERS.map(part => (
              <div key={part.id} className={"v5-depth-part v5-depth-" + part.id}
                style={depthStyle(part)} data-depth-x={part.depthX} data-depth-y={part.depthY}>
                <img src={"/assets/v5/" + part.id + "-layer.webp"} alt="" />
              </div>
            ))}
          </div>
          <span className="v5-sticky" aria-hidden="true">☺</span>
          <span className="v5-smile" aria-hidden="true">☺</span>
          <span className="v5-orange-ring" aria-hidden="true"/>
          <span className="v5-white-arc" aria-hidden="true"/>
        </div>

        <div className="v5-bottom-left">
          <p>{t("We create original game experiences, immersive interfaces, and memorable digital entertainment that players love and keep coming back to.",
            "Kami menciptakan game orisinal, antarmuka imersif, dan hiburan digital yang membuat pemain ingin kembali.")}</p>
          <div className="v5-ctas">
            <button className="v5-button-primary" onClick={() => navigate("/games")}>{t("Explore Games","Jelajahi Game")} <ArrowRight size={16}/></button>
            <button className="v5-button-secondary" onClick={() => navigate("/contact")}>{t("Contact Us","Hubungi Kami")}</button>
          </div>
        </div>

        <p className="v5-right-caption">{t("From concept to live gameplay, we craft original interactive worlds that people love to explore.",
          "Dari konsep hingga gameplay, kami membangun dunia interaktif orisinal untuk dijelajahi.")}</p>

        <div className="v5-social-rail" aria-label="Social channels preview">
          <Instagram size={22} aria-hidden="true"/>
          <Facebook size={21} aria-hidden="true"/>
          <span aria-hidden="true">𝕏</span>
        </div>

        <a className="v5-scroll-notch" href="#collection" aria-label="Scroll to explore games">
          <span className="v5-mouse-symbol">◉</span>
          <span>Scroll to<br/>explore more</span>
          <ArrowDown className="v5-scroll-arrow" size={16}/>
        </a>
      </div>
      {showPartnerNotice && (
        <div className="v5-dialog-backdrop" onClick={() => setShowPartnerNotice(false)} role="presentation">
          <div className="v5-dialog" role="dialog" aria-modal="true" aria-label="Partner account notice"
            onClick={e => e.stopPropagation()}>
            <button className="v5-dialog-close" aria-label="Close" onClick={() => setShowPartnerNotice(false)}><X size={20}/></button>
            <LockKeyhole size={27}/>
            <h2>SOFT TECH PARTNER ACCESS</h2>
            <p>Partner accounts are not enabled yet. Contact our studio to discuss distribution or collaboration.</p>
            <button onClick={() => {setShowPartnerNotice(false);navigate("/contact");}}>PARTNER ENQUIRY <Mail size={16}/></button>
          </div>
        </div>
      )}
    </section>
  );
}
