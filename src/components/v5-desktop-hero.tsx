"use client";
import { useState } from "react";
import { ArrowRight, ArrowDown, Globe2, Gamepad2, Instagram, Facebook, X, ChevronDown, LockKeyhole, Mail } from "lucide-react";
import { logo } from "@/data/games";

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
  const [showPartnerNotice, setShowPartnerNotice] = useState(false);
  const [language, setLanguage] = useState<"EN"|"ID">(lang);
  const t = (english: string, indonesian: string) => language === "EN" ? english : indonesian;
  return (
    <section className="v5-hero" aria-label="SOFT TECH digital game studio">
      <div className="v5-stage">
        <header className="v5-header">
          <button className="v5-brand" onClick={() => navigate("/")} aria-label="Soft Tech homepage">
            <img src={logo} alt="Soft Tech official logo" />
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

        <div className="v5-art-layer" aria-label="Original orange retro computer illustration">
          <div className="v5-ground-shadow" aria-hidden="true"/>
          {missingAsset && <div className="v5-computer-vector" aria-hidden="true">
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
