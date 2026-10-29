"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent, type TouchEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Play, Sparkles, MoveUpRight } from "lucide-react";
import { games, type Game } from "@/data/games";
import { Reveal, TiltCard } from "./motion";

type Props = {
  active: number;
  setActive: (index: number) => void;
  lang: "EN" | "ID";
  navigate: (path: string) => void;
};

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function MagneticLink({ game, label }: { game: Game; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const frame = useRef(0);
  const reduced = useReducedMotion();
  const move = (event: PointerEvent<HTMLAnchorElement>) => {
    if (reduced || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left - bounds.width / 2) * .12;
    const y = (event.clientY - bounds.top - bounds.height / 2) * .16;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      ref.current?.style.setProperty("--magnetic-x", x + "px");
      ref.current?.style.setProperty("--magnetic-y", y + "px");
    });
  };
  const reset = () => {
    cancelAnimationFrame(frame.current);
    ref.current?.style.setProperty("--magnetic-x", "0px");
    ref.current?.style.setProperty("--magnetic-y", "0px");
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <a ref={ref} className="v4-magnetic-cta" onPointerMove={move} onPointerLeave={reset}
      onBlur={reset} href={game.url} {...external}>
      <span className="v4-play-icon"><Play size={14} fill="currentColor" /></span>
      <span>{label}</span>
      <ArrowUpRight size={18} />
    </a>
  );
}

function FloatingAsset({ game }: { game: Game }) {
  if (game.id === "uno-luck") {
    return <img aria-hidden="true" className="v4-hero-asset v4-asset-uno" src="/assets/uno-luck-detail.webp" alt="" />;
  }
  if (game.id === "mahjong-wild") {
    return <div className="v4-asset-mahjong" aria-hidden="true">
      <img className="v4-asset-dragon" src="/assets/mahjong-dragon.webp" alt=""/>
      <img className="v4-asset-tile" src="/assets/mahjong-wild-tile.webp" alt=""/>
    </div>;
  }
  return <div className="v4-lightning-orbit" aria-hidden="true"><span>✳</span><span>✦</span></div>;
}

export function V4Playground({ active, setActive, lang, navigate }: Props) {
  const game = games[active] || games[0];
  const reduced = useReducedMotion();
  const stage = useRef<HTMLElement>(null);
  const touchOrigin = useRef<{x:number;y:number}|null>(null);
  const frame = useRef(0);
  const [hover, setHover] = useState(false);
  const title = lang === "ID" ? "CIPTAKAN DUNIA YANG TAK TERBATAS." : "IMAGINATION IS OUR PLAYGROUND.";

  useEffect(() => {
    if (reduced || hover) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) setActive((active + 1) % games.length);
    }, 9000);
    return () => window.clearInterval(interval);
  }, [active, hover, reduced, setActive]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const move = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || reduced) return;
    const node = stage.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const offsets: Record<string, number> = {
        "--v4-ax": x * 20, "--v4-ay": y * 12,
        "--v4-fx": x * 37, "--v4-fy": y * 23,
        "--v4-bx": x * -20, "--v4-by": y * -13,
        "--v4-dx": x * -16, "--v4-dy": y * -12,
        "--v4-tx": x * 24, "--v4-ty": y * 14,
        "--v4-lx": x * -23, "--v4-ly": y * 18,
        "--v4-srx": x * -10
      };
      for (const [property, amount] of Object.entries(offsets)) {
        node.style.setProperty(property, amount.toFixed(1) + "px");
      }
      node.style.setProperty("--light-left", ((x + .5) * 100).toFixed(1) + "%");
      node.style.setProperty("--light-top", ((y + .5) * 100).toFixed(1) + "%");
    });
  };
  const leave = () => {
    cancelAnimationFrame(frame.current);
    const node = stage.current;
    if (node) {
      for (const property of [
        "--v4-ax","--v4-ay","--v4-fx","--v4-fy","--v4-bx","--v4-by",
        "--v4-dx","--v4-dy","--v4-tx","--v4-ty","--v4-lx","--v4-ly","--v4-srx"
      ]) node.style.setProperty(property, "0px");
    }
    setHover(false);
  };
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((active + games.length - 1) % games.length);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((active + 1) % games.length);
    }
  };

  const touchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    touchOrigin.current = touch ? {x:touch.clientX,y:touch.clientY} : null;
  };
  const touchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchOrigin.current;
    touchOrigin.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 58 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    setActive((active + (dx < 0 ? 1 : games.length - 1)) % games.length);
  };
  return (
    <section id="featured" aria-label="Soft Tech featured worlds" tabIndex={0}
      className="v4-playground" ref={stage}
      onPointerMove={move} onPointerEnter={(event) => { if (event.pointerType === "mouse") setHover(true); }}
      onPointerLeave={leave} onBlur={() => setHover(false)}
      onTouchStart={touchStart} onTouchEnd={touchEnd} onKeyDown={keydown} style={{ "--v4-accent": game.accent } as CSSProperties}>
      <div className="v4-hero-grid" aria-hidden="true" />
      <div className="v4-hero-ambient" aria-hidden="true" />
      <div className="v4-hero-topline">
        <span><span className="v4-live-pixel"/> AN INDEPENDENT CREATIVE GAME STUDIO</span>
        <span className="v4-monogram">ST / 004 <i>✳</i> GLOBAL DIGITAL PLAYGROUND</span>
      </div>

      <div className="v4-hero-lettering" aria-hidden="true">
        <span className="v4-word-beyond">BEYOND</span>
        <span className="v4-word-play">PLAY<span>.</span></span>
      </div>

      <div className="v4-sculpture">
        <div className="v4-orbit v4-orbit-one" aria-hidden="true"/>
        <div className="v4-orbit v4-orbit-two" aria-hidden="true"/>
        <div className="v4-orbit v4-orbit-three" aria-hidden="true"/>
        <div className="v4-sculpture-glow" aria-hidden="true"/>
        <div className="v4-main-art" key={game.id}>
          <div className="v4-art-foil" aria-hidden="true"/>
          <img className={"v4-main-image v4-art-"+game.id} src={game.cover}
            alt={game.name + " official artwork"} fetchPriority={active === 0 ? "high" : "auto"}/>
          <div className="v4-art-bottom"><span className="v4-pixel">SOFT TECH / VOL. 0{active + 1}</span><b>{game.name}</b></div>
        </div>
        <FloatingAsset key={game.id+"-asset"} game={game}/>
        <div className="v4-float-stamp v4-stamp-one" aria-hidden="true"><span>✳</span><b>PIXEL<br/>PERFECT</b></div>
        <div className="v4-float-stamp v4-stamp-two" aria-hidden="true">X&nbsp;/&nbsp;Y&nbsp;:&nbsp;0{active+1}<small>EXPERIENCE NO.</small></div>
      </div>

      <div className="v4-left-rail">
        <span className="v4-index">[ 0{active + 1} / 03 ] <span className="v4-pixel">FEATURED RELEASE</span></span>
        <div key={game.id} className="v4-left-animated">
          <span className="v4-label-pill"><Sparkles size={14}/>{game.genre.toUpperCase()}</span>
          <h2>{game.name}</h2>
          <p>{lang === "ID" ? game.idDescription : game.description}</p>
        </div>
        <div className="v4-hero-buttons">
          <MagneticLink game={game} label={lang === "ID" ? "MAIN DEMO" : "PLAY DEMO"} />
          <button className="v4-explore-cta" onClick={() => navigate("/games/" + game.id)}>
            {lang === "ID" ? "DETAIL GAME" : "DISCOVER"} <ArrowUpRight size={16}/>
          </button>
        </div>
      </div>

      <div className="v4-right-rail">
        <span className="v4-vertical-copy">{title}</span>
        <div className="v4-side-counter"><strong className="v4-pixel">03</strong><span>ORIGINAL<br/>GAME WORLDS</span></div>
      </div>

      <div className="v4-hero-bottomline">
        <a href="#collection" className="v4-scroll-cue">SCROLL TO EXPLORE <ArrowDown size={15}/></a>
        <div className="v4-hero-pagination" aria-label="Select featured game">
          {games.map((g,i)=><button key={g.id} className={i===active?"active":""}
            aria-label={"Feature "+g.name} aria-pressed={active===i} onClick={()=>setActive(i)}>
            <span className="v4-pixel">0{i+1}</span><span className="v4-progress-track"/>
          </button>)}
        </div>
        <div className="v4-hero-arrows">
          <button onClick={()=>setActive((active+games.length-1)%games.length)} aria-label="Previous featured game"><ArrowLeft size={20}/></button>
          <button onClick={()=>setActive((active+1)%games.length)} aria-label="Next featured game"><ArrowRight size={20}/></button>
        </div>
      </div>
      <div className="v4-art-corner v4-corner-left" aria-hidden="true">+</div>
      <div className="v4-art-corner v4-corner-right" aria-hidden="true">+</div>
    </section>
  );
}

export function V4WorldStory({ lang, navigate }: { lang: "EN"|"ID"; navigate: (path:string)=>void }) {
  return (
    <section className="v4-story" aria-label="Explore Soft Tech game worlds">
      <div className="v4-story-left">
        <Reveal>
          <span className="v4-spec-label">[ 04 / EVERY WORLD HAS A STORY ]</span>
          <h2>NOT MADE<br/>TO FIT.<br/><em>MADE TO<br/>FEEL.</em></h2>
          <p>{lang === "EN"
            ? "Three worlds. Three distinct identities. Every interactive detail designed to make you feel something."
            : "Tiga dunia, tiga karakter berbeda. Setiap detail dirancang untuk menghadirkan pengalaman yang berkesan."}</p>
          <div className="v4-story-scroll">SCROLL THROUGH THE WORLDS <ArrowDown size={16}/></div>
        </Reveal>
      </div>
      <div className="v4-story-right">
        {games.map((game,i)=>(
          <Reveal key={game.id} delay={i*70}>
            <TiltCard className={"v4-story-card v4-story-"+game.id}
              style={{"--story-accent":game.accent} as CSSProperties}>
              <div className="v4-story-art"><img src={game.cover} loading="lazy" alt={game.name+" original game art"}/></div>
              <span className="v4-story-serial v4-pixel">0{i+1}</span>
              <div className="v4-story-card-content">
                <span>{game.tag} / SOFT TECH</span>
                <h3>{game.name}</h3>
                <p>{game.slogan}</p>
                <button onClick={()=>navigate("/games/"+game.id)}>{lang==="ID"?"TELUSURI DUNIA":"ENTER WORLD"} <MoveUpRight size={17}/></button>
              </div>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
