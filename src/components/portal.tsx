"use client";
import {
  useEffect, useMemo, useState, type CSSProperties, type ReactNode
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, ChevronDown,
  ChevronLeft, ChevronRight, CirclePlay, Compass, Gamepad2, Globe2, Layers3,
  Mail, Menu, Play, Search, ShieldCheck, Sparkles, WandSparkles, X, Zap
} from "lucide-react";
import { games, logo, type Game } from "@/data/games";
import { ParallaxScene, Reveal, ScrollProgress, TiltCard } from "./motion";
import { V4WorldStory } from "./v4-playground";
import V52MobileHero from "./v52-mobile-hero";
import V5DesktopHero from "./v5-desktop-hero";

type Language = "EN" | "ID";
const links = [
  { path: "/", label: "Home", id: "Beranda" },
  { path: "/games", label: "Games", id: "Game" },
  { path: "/company", label: "Studio", id: "Studio" },
  { path: "/technology", label: "Technology", id: "Teknologi" },
  { path: "/partners", label: "Partners", id: "Mitra" }
];
const externalProps = { target: "_blank", rel: "noopener noreferrer" } as const;

function ArrowLink({ children }: { children: ReactNode }) {
  return <span className="arrow-link-circle" aria-hidden="true"><ArrowUpRight size={17}/>{children}</span>;
}

function GameCard({ game, navigate, index }: {
  game: Game; navigate: (href: string) => void; index: number
}) {
  return (
    <TiltCard className="game-card" style={{ "--game-accent": game.accent } as CSSProperties}>
      <div className="game-card-media">
        <img src={game.cover} alt={game.name + " official artwork"} loading="lazy" />
        <span className="game-card-shine" aria-hidden="true" />
        <div className="card-top"><span>SOFT TECH ORIGINAL</span><span>0{index + 1} / 03</span></div>
        <button className="card-image-link" onClick={() => navigate("/games/" + game.id)}
          aria-label={"View " + game.name + " game details"} />
        <div className="card-cover-name">
          <span className="small-label">{game.genre.toUpperCase()}</span>
          <h3>{game.name}</h3>
        </div>
        <span className="card-hover-prompt" aria-hidden="true">DISCOVER <ArrowUpRight size={17}/></span>
      </div>
      <div className="game-card-foot">
        <div>
          <span className="eyebrow">{game.tag}</span>
          <p>{game.slogan}</p>
        </div>
        <a className="card-play" href={game.url} {...externalProps} aria-label={"Play " + game.name + " demo"}>
          <Play size={15} fill="currentColor"/><span>PLAY DEMO</span>
        </a>
      </div>
    </TiltCard>
  );
}

function HeroShowcase({
  active, setActive, lang, navigate
}: {
  active: number;
  setActive: (index: number) => void;
  lang: Language;
  navigate: (href: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const game = games[active];
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (paused || motion.matches) return;
    const id = window.setInterval(() => setActive((active + 1) % games.length), 8500);
    return () => window.clearInterval(id);
  }, [active, paused, setActive]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight") setActive((active + 1) % games.length);
      if (event.key === "ArrowLeft") setActive((active + games.length - 1) % games.length);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, setActive]);

  return (
    <ParallaxScene className="showcase-stage">
      <div className="stage-backdrop" key={game.id} style={{ backgroundImage: "url('" + game.cover + "')" }} />
      <div className="stage-raster" aria-hidden="true" />
      <div className="stage-halo" aria-hidden="true" />
      <div className="stage-ring ring-one" aria-hidden="true" />
      <div className="stage-ring ring-two" aria-hidden="true" />
      <div className="stage-ring ring-three" aria-hidden="true" />
      <div className="stage-grid-marker stage-grid-top">ST_ / INTERACTIVE SHOWCASE</div>
      <div className="stage-grid-marker stage-grid-right">EST. IN THE IMAGINATION</div>

      <div className="poster-stack" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
        {games.map((item, index) => {
          const offset = (index - active + games.length) % games.length;
          const slot = offset === 0 ? "center" : offset === 1 ? "next" : "prev";
          return (
            <button key={item.id}
              className={"poster poster-" + slot}
              style={{ "--poster-accent": item.accent } as CSSProperties}
              onClick={() => slot === "center" ? navigate("/games/" + item.id) : setActive(index)}
              aria-label={slot === "center" ? "Explore " + item.name : "Feature " + item.name}
              aria-current={slot === "center" ? "true" : undefined}>
              <img src={item.cover} alt={item.name + " featured cover"} draggable={false} />
              <span className="poster-lens" aria-hidden="true" />
              <span className="poster-topline"><span>SOFT TECH</span><span>VOL. 0{index + 1}</span></span>
              <span className="poster-bottomline"><strong>{item.name}</strong><small>{item.genre.toUpperCase()}</small></span>
              <span className="poster-edge" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className="stage-content" key={game.id}>
        <span className="stage-kicker"><span className="blink-dot" /> FEATURED WORLD <span className="minor-text">/ 0{active + 1} — 03</span></span>
        <div className="stage-number" aria-hidden="true">0{active + 1}</div>
        <h2>{game.name}</h2>
        <p className="stage-slogan">{game.slogan}</p>
        <p className="stage-description">{lang === "EN" ? game.description : game.idDescription}</p>
        <div className="stage-actions">
          <a className="btn btn-light" href={game.url} {...externalProps}>
            <CirclePlay size={18}/> {lang === "EN" ? "PLAY THE DEMO" : "MAIN DEMO"} <ArrowUpRight size={16}/>
          </a>
          <button className="btn btn-glass" onClick={() => navigate("/games/" + game.id)}>
            {lang === "EN" ? "EXPLORE GAME" : "DETAIL GAME"} <ArrowUpRight size={16}/>
          </button>
        </div>
      </div>
      <div className="stage-footer">
        <div className="stage-count"><strong>0{active + 1}</strong><div className="stage-progress">{games.map((g, i) => <button key={g.id}
          className={"stage-progress-segment " + (active === i ? "selected" : "")}
          onClick={() => setActive(i)} aria-label={"Feature " + g.name} aria-current={active === i ? "true" : undefined}/>)}</div><span>03</span></div>
        <div className="stage-controls">
          <span>CHANGE WORLD</span>
          <button onClick={() => setActive((active + games.length - 1) % games.length)} aria-label="Previous featured game"><ArrowLeft size={19}/></button>
          <button onClick={() => setActive((active + 1) % games.length)} aria-label="Next featured game"><ArrowRight size={19}/></button>
        </div>
      </div>
    </ParallaxScene>
  );
}

function StudioArt() {
  return (
    <div className="studio-art" aria-hidden="true">
      <div className="studio-art-noise" />
      <div className="studio-orbit orbit-a" /><div className="studio-orbit orbit-b" /><div className="studio-orbit orbit-c" />
      <div className="studio-core"><img src={logo} alt=""/></div>
      <div className="studio-float-label float-a">DESIGN / 01</div>
      <div className="studio-float-label float-b">IMAGINE / CREATE</div>
      <div className="studio-float-label float-c">THE NEXT EXPERIENCE</div>
    </div>
  );
}

function SiteFooter({ navigate }: { navigate: (href: string) => void }) {
  return (
    <footer className="site-footer">
      <div className="footer-upper">
        <div><span className="eyebrow">BEYOND PLAY®</span><h2>LET'S CREATE<br/><em>WHAT'S NEXT.</em></h2></div>
        <button className="footer-cta" onClick={() => navigate("/contact")}>START A CONVERSATION <ArrowUpRight size={21}/></button>
      </div>
      <div className="footer-baseline">
        <div className="footer-brand"><img src={logo} alt="Soft Tech"/><span>Creative worlds.<br/>Intelligent technology.</span></div>
        <div className="footer-nav">{links.map(link => <button key={link.path} onClick={() => navigate(link.path)}>{link.label}</button>)}</div>
      </div>
      <div className="footer-legal"><span>© 2026 SOFT TECH. ALL RIGHTS RESERVED.</span><span>BUILT FOR IMAGINATION · MADE FOR PLAY.</span></div>
    </footer>
  );
}

function Corporate({ section, lang, navigate }: {
  section: string;
  lang: Language;
  navigate: (href: string) => void;
}) {
  const intro: Record<string, { over: string; first: string; second: string; sub: string }> = {
    company: { over: "MEET THE STUDIO", first: "IMAGINATION", second: "UNLIMITED.", sub: "We create worlds you don't just see. You feel." },
    technology: { over: "HOW WE BUILD", first: "CRAFTED WITH", second: "INTENTION.", sub: "Every interaction tells a story. Every pixel has a purpose." },
    partners: { over: "CREATE TOGETHER", first: "GREAT IDEAS", second: "CONNECT.", sub: "The next world is better when it's built together." },
    contact: { over: "START A CONVERSATION", first: "LET'S MAKE", second: "SOMETHING.", sub: "Tell us what you're imagining. We love a good beginning." }
  };
  const header = intro[section] || intro.company;
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState(false);
  const draft = "Soft Tech collaboration enquiry\nFrom: " + (name.trim() || "(Your name)") + "\n\n" + (message.trim() || "(Your project introduction)");
  return (
    <div className="inner-page corporate-page">
      <Reveal className="page-head"><span className="eyebrow"><span className="blink-dot"/> SOFT TECH / {header.over}</span>
        <h1>{header.first}<br/><em>{header.second}</em></h1><p>{header.sub}</p></Reveal>
      {section === "company" && <>
        <div className="corp-two">
          <Reveal><span className="section-tag">01 — OUR STORY</span><h2>NOT JUST<br/>GAMES. <em>NEW WORLDS.</em></h2>
            <p>SOFT TECH is a creative game technology studio focused on building distinctive digital entertainment. We combine original art direction, interactive design and contemporary technology to make every world immersive, intuitive and unmistakably its own.</p>
            <p>From cinematic fantasy to luminous arcade experiences, every title starts with an idea worth exploring.</p>
            <button className="btn btn-outline" onClick={() => navigate("/games")}>OUR GAME PORTFOLIO <ArrowUpRight size={17}/></button>
          </Reveal>
          <Reveal delay={100}><StudioArt/></Reveal>
        </div>
        <div className="values-grid">{[
          ["01", "IMAGINATION FIRST", "We start with the feeling, the universe, the tiny unexpected detail."],
          ["02", "CRAFT IN EVERY PIXEL", "Art, audio, motion and mechanics belong to one coherent experience."],
          ["03", "MADE TO EXPLORE", "Distinctive titles crafted for engaging web-based experiences."]
        ].map((x, i) => <Reveal key={x[0]} delay={i * 65}><div className="value-box"><span>{x[0]} / MANIFESTO</span><h3>{x[1]}</h3><p>{x[2]}</p><ArrowUpRight size={19}/></div></Reveal>)}</div>
      </>}
      {section === "technology" && <>
        <div className="technology-feature">
          <Reveal><div><span className="section-tag">OUR APPROACH / 001</span><h2>THE ART OF<br/><em>INTERACTION.</em></h2><p>Expressive visuals meet fluid interactions and responsive web delivery. We care about the details that bring a world to life, from a single button press to the rhythm of an entire experience.</p></div></Reveal>
          <Reveal delay={110}><div className="tech-orb"><div className="tech-inner"><Zap size={60}/><span>ENGINEERED TO ENGAGE</span></div></div></Reveal>
        </div>
        <div className="capability-grid">{[
          [Zap, "RESPONSIVE PERFORMANCE", "Fluid, cross-device web experiences with animation tuned for the hardware."],
          [WandSparkles, "CINEMATIC ART DIRECTION", "Original visual identities and polished atmospheres for every title."],
          [Layers3, "GAME-SPECIFIC INTERFACES", "UI systems and interaction patterns shaped around each gameplay experience."],
          [ShieldCheck, "THOUGHTFUL ACCESSIBILITY", "Clear navigation, keyboard interaction and reduced-motion support."]
        ].map(([Icon, title, copy], i) => {
          const Graphic = Icon as typeof Zap;
          return <Reveal key={String(title)} delay={i as number * 60}><TiltCard className="cap-card"><Graphic size={27}/><span>0{(i as number) + 1}</span><h3>{String(title)}</h3><p>{String(copy)}</p></TiltCard></Reveal>;
        })}</div>
      </>}
      {section === "partners" && <>
        <div className="corp-two">
          <Reveal><span className="section-tag">LET'S COLLABORATE</span><h2>NEW WORLDS<br/>ARE BUILT <em>TOGETHER.</em></h2>
            <p>We're exploring collaborations with creative teams, publishing partners and organizations that believe memorable entertainment starts with a distinctive idea.</p>
            <p>Connect with us about product demos, art collaboration or future publishing opportunities. Integrations and distribution partnerships are evaluated individually.</p>
            <button className="btn btn-outline" onClick={() => navigate("/contact")}>CONTACT THE STUDIO <ArrowUpRight size={17}/></button>
          </Reveal><Reveal delay={120}><StudioArt/></Reveal>
        </div>
        <div className="values-grid">{[
          ["PUBLISHING", "Explore distribution opportunities for original Soft Tech titles."],
          ["CREATIVE", "Create worlds, narratives and visual experiences together."],
          ["PRODUCT", "Discuss demonstrations and game presentation opportunities."]
        ].map((x, i) => <Reveal key={x[0]} delay={i * 60}><div className="value-box"><span>OPPORTUNITY / 0{i + 1}</span><h3>{x[0]}</h3><p>{x[1]}</p><ArrowUpRight size={19}/></div></Reveal>)}</div>
      </>}
      {section === "contact" && <div className="corp-two">
        <Reveal><span className="section-tag">BUSINESS ENQUIRIES</span><h2>TAKE THE<br/><em>FIRST STEP.</em></h2><p>Share an idea, project or collaboration proposal. An official business inbox has not yet been configured, so this page helps you prepare an enquiry you can send using your preferred contact channel.</p><div className="contact-form">
          <label htmlFor="contact-name">YOUR NAME<input id="contact-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label>
          <label htmlFor="contact-message">YOUR IDEA<textarea id="contact-message" rows={5} value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell us what you're imagining..." /></label>
          <button className="btn btn-light" onClick={() => { setCopied(false); setShowDraft(true); }}>PREPARE ENQUIRY <ArrowUpRight size={17}/></button>
        </div></Reveal>
        <Reveal delay={100}><div className="contact-art"><Mail size={65}/><strong>YOUR NEXT<br/>BIG IDEA<br/><em>STARTS HERE.</em></strong><small>SOFT TECH / BEYOND PLAY</small></div></Reveal>
      </div>}
      {showDraft && <div className="dialog-scrim" onClick={() => setShowDraft(false)} role="presentation"><div className="dialog-panel" role="dialog" aria-modal="true" aria-label="Enquiry draft" onClick={event => event.stopPropagation()}>
        <button className="dialog-close" aria-label="Close" onClick={() => setShowDraft(false)}><X size={22}/></button>
        <span className="eyebrow">YOUR ENQUIRY</span><h2>READY TO SHARE.</h2>
        <p>Copy the message below. Send it to a confirmed Soft Tech business contact once available.</p>
        <textarea aria-label="Your enquiry draft" readOnly value={draft} rows={7}/>
        <button className="btn btn-light" onClick={async () => {
          try { await navigator.clipboard.writeText(draft); setCopied(true); }
          catch { setCopied(false); }
        }}>{copied ? "COPIED TO CLIPBOARD" : "COPY ENQUIRY"} <ArrowUpRight size={16}/></button>
      </div></div>}
    </div>
  );
}

function GameDetails({ game, lang, navigate }: {
  game: Game;
  lang: Language;
  navigate: (href: string) => void;
}) {
  const index = games.indexOf(game);
  return (
    <div className="inner-page detail-page" style={{ "--game-accent": game.accent } as CSSProperties}>
      <Reveal><button className="back-link" onClick={() => navigate("/games")}><ArrowLeft size={17}/> BACK TO COLLECTION</button></Reveal>
      <Reveal>
        <ParallaxScene className="detail-stage">
          <div className="detail-bg" style={{ backgroundImage: "url('" + game.cover + "')" }}/>
          <div className="detail-wash"/>
          <div className="detail-copy">
            <span className="eyebrow"><span className="blink-dot"/> SOFT TECH ORIGINAL / 0{index + 1}</span>
            <h1>{game.name}</h1><p>{game.slogan}</p>
            <div className="detail-actions"><a href={game.url} {...externalProps} className="btn btn-light"><Play size={16} fill="currentColor"/> PLAY DEMO <ArrowUpRight size={17}/></a><button className="btn btn-glass" onClick={() => navigate("/games")}>ALL GAMES <ArrowRight size={17}/></button></div>
          </div>
          <div className="detail-float-card"><img src={game.detailImage} alt={game.name + " original game visual"}/><span>{game.tag}</span></div>
          <span className="detail-corner">ST. / 0{index + 1} — 03</span>
        </ParallaxScene>
      </Reveal>
      <div className="detail-description">
        <Reveal><div><span className="section-tag">DISCOVER THE WORLD / 01</span><h2>THE EXPERIENCE<br/><em>BEHIND THE ART.</em></h2><p>{lang === "EN" ? game.description : game.idDescription}</p></div></Reveal>
        <Reveal delay={100}><div className="detail-facts">
          {[["THE GENRE", game.genre], ["DESIGNED BY", "SOFT TECH"], ["PLAY FORMAT", "WEB DEMO"], ["GAME MODE", "VIRTUAL CREDITS"]].map(([key, val]) => <div key={key}><span>{key}</span><strong>{val}</strong></div>)}
        </div></Reveal>
      </div>
      <Reveal><div className="demo-disclaimer"><ShieldCheck size={22}/> Game demos open on their official standalone websites. This showcase does not process deposits, payments, or withdrawals.</div></Reveal>
      <div className="detail-pager">
        <button onClick={() => navigate("/games/" + games[(index + games.length - 1) % games.length].id)}><ChevronLeft size={19}/> PREVIOUS WORLD</button>
        <button onClick={() => navigate("/games/" + games[(index + 1) % games.length].id)}>NEXT WORLD <ChevronRight size={19}/></button>
      </div>
    </div>
  );
}

export default function Portal() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [language, setLanguage] = useState<Language>("EN");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const section = pathname.split("/")[1] || "home";
  const gameId = pathname.split("/")[2];
  const game = section === "games" && gameId ? games.find(item => item.id === gameId) : undefined;
  const selected = games[active];

  const navigate = (url: string) => {
    router.push(url);
    setMobileMenu(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => setMobileMenu(false), [pathname]);
  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenu(false); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);
  const t = (en: string, id: string) => language === "EN" ? en : id;
  const filtered = useMemo(() => games.filter(item =>
    (category === "ALL" || item.genre.toUpperCase().includes(category)) &&
    (item.name + " " + item.genre + " " + item.tag + " " + item.description).toLowerCase().includes(search.toLowerCase())
  ), [category, search]);

  return (
    <div className={"site " + (section === "home" ? "v5-home" : "")} style={{ "--active-accent": selected.accent } as CSSProperties}>
      <ScrollProgress/>
      <div className="ambient-orb ambient-one" aria-hidden="true"/>
      <div className="ambient-orb ambient-two" aria-hidden="true"/>
      <div className="screen-grain" aria-hidden="true"/>
      <a className="skip-link" href="#main-content">SKIP TO CONTENT</a>
      {mobileMenu && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)}/>}
      <aside id="v52-site-navigation" className={"side-panel " + (mobileMenu ? "side-open" : "")}>
        <button className="brand-logo" onClick={() => navigate("/")} aria-label="Soft Tech homepage">
          <img src="/assets/v5/soft-tech-neon-header.webp" alt="SOFT TECH"/><span>INDEPENDENT GAME STUDIO</span>
        </button>
        <div className="side-divider"/>
        <div className="side-navigation"><span className="side-caption">NAVIGATION / 001</span>
          {links.map((link, index) => (
            <button key={link.path} onClick={() => navigate(link.path)} className={
              ((link.path === "/" && section === "home") || (link.path !== "/" && pathname.startsWith(link.path)) ? "nav-active" : "")}>
              <span className="nav-index">0{index + 1}</span><span>{language === "EN" ? link.label : link.id}</span>
              <ArrowUpRight size={15}/></button>
          ))}
        </div>
        <div className="side-card"><div className="side-card-stars"><Sparkles size={21}/><span>SOFT TECH / 2026</span></div><strong>PLAY THE<br/>UNEXPECTED.</strong><div className="side-card-bottom">CREATIVE WORLD BUILDERS <ArrowUpRight size={15}/></div></div>
        <div className="side-bottom"><span><span className="online-pulse"/> 03 WORLDS ONLINE</span><span>ST / 001</span></div>
      </aside>

      <div className="site-body">
        <header className="top-header">
          <div className="header-left">
            <button className="hamburger" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle navigation">{mobileMenu ? <X size={21}/> : <Menu size={21}/>}</button>
            <button className="top-brand" onClick={() => navigate("/")} aria-label="Soft Tech homepage"><img src={logo} alt="Soft Tech" /></button>
            <div className="header-breadcrumb"><span>STUDIO</span><ChevronRight size={13}/><strong>{game?.name || ({home:"DISCOVER",games:"OUR GAMES",company:"COMPANY",technology:"TECHNOLOGY",partners:"PARTNERSHIPS",contact:"CONTACT"} as Record<string,string>)[section] || "DISCOVER"}</strong></div>
          </div>
          <nav className="desktop-nav" aria-label="Main navigation">
            {links.map(link => <button key={link.path}
              className={pathname === link.path || (link.path !== "/" && pathname.startsWith(link.path + "/")) ? "selected" : ""}
              onClick={() => navigate(link.path)}>
              {language === "EN" ? link.label : link.id}
            </button>)}
          </nav>
          <div className="header-right">
            <span className="header-live"><span className="online-pulse"/> 03 ORIGINAL GAMES</span>
            <button className="language-switch" onClick={() => setLanguage(language === "EN" ? "ID" : "EN")} aria-label="Change language"><Globe2 size={15}/> {language}<ChevronDown size={12}/></button>
            <button className="contact-header" onClick={() => navigate("/contact")}>{t("LET'S TALK", "KONTAK")} <ArrowUpRight size={15}/></button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {section === "home" && <>
            <div className="v5-desktop-only"><V5DesktopHero navigate={navigate} lang={language}/></div>
            <div className="v52-mobile-only"><V52MobileHero navigate={navigate} lang={language}
              menuOpen={mobileMenu} toggleMenu={() => setMobileMenu(current => !current)}
              toggleLanguage={() => setLanguage(current => current === "EN" ? "ID" : "EN")}/></div>

            <div className="marquee" aria-label="Creative worlds, new experiences"><div className="marquee-track" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => <span key={i}><i>✳</i> MORE THAN GAMES <b>·</b> NEW WORLDS <b>·</b> BEYOND PLAY <b>·</b></span>)}
            </div></div>

            <section className="home-collection" id="collection">
              <Reveal><div className="section-header"><div><span className="section-index">02</span><span className="section-slash">/</span><span>THE COLLECTION</span></div><button className="section-action" onClick={() => navigate("/games")}>VIEW ALL GAMES <ArrowUpRight size={17}/></button></div></Reveal>
              <Reveal><div className="collection-heading"><div><span className="eyebrow">HANDCRAFTED ORIGINAL EXPERIENCES</span><h2>THREE WORLDS.<br/><em>ENDLESS WONDER.</em></h2><p>Every world plays by its own rules. Find one that speaks to you.</p></div><div className="collection-count"><strong>03</strong><span>SOFT TECH<br/>ORIGINALS</span></div></div></Reveal>
              <div className="game-grid">{games.map((item, index) =>
                <Reveal key={item.id} delay={index * 95}><GameCard game={item} navigate={navigate} index={index}/></Reveal>)}</div>
            </section>

            <V4WorldStory lang={language} navigate={navigate}/>

            <section className="studio-section">
              <Reveal><div className="section-header"><div><span className="section-index">03</span><span className="section-slash">/</span><span>THE STUDIO</span></div><span className="header-note">THE CREATIVE ENGINE BEHIND THE WORLDS.</span></div></Reveal>
              <div className="studio-panel"><Reveal className="studio-copy"><span className="eyebrow">OUR PHILOSOPHY / BEYOND PLAY</span><h2>WE MAKE<br/>THE <em>UNREAL</em><br/>FEEL REAL.</h2><p>Original ideas. Thoughtful mechanics. Atmospheres that stay with you. At Soft Tech, art, interaction and technology come together to make unforgettable play.</p>
                <button className="btn btn-outline" onClick={() => navigate("/company")}>ENTER THE STUDIO <ArrowUpRight size={17}/></button></Reveal>
                <Reveal delay={100}><StudioArt/></Reveal>
              </div>
            </section>

            <section className="worlds-strip" aria-label="Our approach">
              <Reveal><div><Sparkles size={24}/><strong>ORIGINAL WORLDS</strong><p>Distinctive game identities</p></div></Reveal>
              <Reveal delay={80}><div><AudioLines size={24}/><strong>IMMERSIVE MOMENTS</strong><p>Motion with meaning</p></div></Reveal>
              <Reveal delay={140}><div><Zap size={24}/><strong>BUILT FOR THE WEB</strong><p>Fluid across devices</p></div></Reveal>
            </section>
          </>}

          {section === "games" && !game && <section className="inner-page games-page">
            <Reveal className="page-head"><span className="eyebrow"><span className="blink-dot"/> OUR ORIGINAL UNIVERSE / 001</span><h1>CHOOSE YOUR<br/><em>WORLD.</em></h1><p>Three original experiences. Three very different adventures.</p></Reveal>
            <Reveal><div className="catalog-tools"><label className="catalog-search"><Search size={18}/><input aria-label="Search games" placeholder={t("Search games...", "Cari game...")} value={search} onChange={event => setSearch(event.target.value)}/></label>
              <div className="catalog-filters" aria-label="Filter games">{["ALL", "FANTASY", "ARCADE", "JADE"].map(item => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
            </div><div className="catalog-count">SHOWING {filtered.length} / {games.length} ORIGINAL TITLES</div></Reveal>
            <div className="game-grid catalog-grid">{filtered.map((item) =>
              <Reveal key={item.id} delay={games.indexOf(item) * 75}><GameCard game={item} index={games.indexOf(item)} navigate={navigate}/></Reveal>)}</div>
            {filtered.length === 0 && <div className="empty-results">NO WORLDS MATCH THAT SEARCH. TRY SOMETHING ELSE.</div>}
          </section>}
          {game && <GameDetails game={game} lang={language} navigate={navigate}/>}
          {["company", "technology", "partners", "contact"].includes(section) &&
            <Corporate section={section} lang={language} navigate={navigate}/>}
        </main>
        <SiteFooter navigate={navigate}/>
      </div>
    </div>
  );
}
