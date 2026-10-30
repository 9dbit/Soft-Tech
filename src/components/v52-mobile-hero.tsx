"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Gamepad2, Globe2, Menu, X } from "lucide-react";
import { games } from "@/data/games";

type Props = {navigate:(path:string)=>void;lang:"EN"|"ID";menuOpen:boolean;toggleMenu:()=>void;toggleLanguage:()=>void};
const LAYERS = [
 {id:"cable",left:160,top:784,width:525,height:683,depth:.38},
 {id:"monitor",left:120,top:40,width:860,height:800,depth:.26},
 {id:"keyboard",left:20,top:774,width:716,height:516,depth:.56},
 {id:"printer",left:556,top:902,width:468,height:473,depth:.83},
 {id:"cartridge",left:30,top:691,width:185,height:239,depth:1},
 {id:"cursor",left:847,top:771,width:169,height:175,depth:1.12}
] as const;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
function layerStyle(part:typeof LAYERS[number]):CSSProperties {
 return {left:(part.left/1024*100)+"%",top:(part.top/1536*100)+"%",width:(part.width/1024*100)+"%",height:(part.height/1536*100)+"%", "--v52-depth":part.depth} as CSSProperties;
}

export default function V52MobileHero({navigate,lang,menuOpen,toggleMenu,toggleLanguage}:Props) {
 const sceneRef=useRef<HTMLDivElement>(null);
 const sectionRef=useRef<HTMLElement>(null);
 const railRef=useRef<HTMLDivElement>(null);
 const rafRef=useRef(0);
 const [ready,setReady]=useState(false);
 const [hasFullAsset,setHasFullAsset]=useState(true);
 const t=(en:string,id:string)=>lang==="ID"?id:en;

 useEffect(()=>{
   const scene=sceneRef.current;if(!scene)return;
   const imgs=Array.from(scene.querySelectorAll<HTMLImageElement>(".v52-depth-part img"));
   const update=()=>setReady(imgs.length===6&&imgs.every(img=>img.complete&&img.naturalWidth>0));
   for(const img of imgs){img.addEventListener("load",update);img.addEventListener("error",update);}
   update();
   return ()=>{for(const img of imgs){img.removeEventListener("load",update);img.removeEventListener("error",update);}};
 },[]);

 useEffect(()=>{
  const scene=sceneRef.current;if(!scene)return;
  const motion=window.matchMedia("(prefers-reduced-motion: reduce)");
  const update=()=>{
   cancelAnimationFrame(rafRef.current);
   rafRef.current=requestAnimationFrame(()=>{
    const r=scene.getBoundingClientRect();
    const section=sectionRef.current?.getBoundingClientRect();
    const timeline=section?clamp((window.innerHeight*.45-section.top)/Math.max(section.height-window.innerHeight*.3,1),0,1):0;
    const progress=motion.matches?0:clamp((timeline-.44)*1.8,-1,1);
    scene.style.setProperty("--v52-sequence",String(timeline));
    scene.style.setProperty("--v52-reveal",String(ready?1:0));
    scene.style.setProperty("--v52-scroll",(progress*148).toFixed(2)+"px");
    scene.style.setProperty("--v52-soft-shift",(progress*-22).toFixed(2)+"px");
    scene.style.setProperty("--v52-tech-shift",(progress*24).toFixed(2)+"px");
    scene.style.setProperty("--v52-tilt",(progress*.7).toFixed(2)+"deg");
    scene.querySelectorAll<HTMLElement>(".v52-depth-part").forEach(el=>{
      const depth=Number(el.dataset.depth||0);
      el.style.setProperty("--v52-shift",(progress*42*(depth-.58)).toFixed(2)+"px");
      el.style.setProperty("--v52-xshift",(progress*16*(depth-.58)).toFixed(2)+"px");
    });
   });
  };
  update();window.addEventListener("scroll",update,{passive:true});window.addEventListener("resize",update,{passive:true});motion.addEventListener("change",update);
  return ()=>{cancelAnimationFrame(rafRef.current);window.removeEventListener("scroll",update);window.removeEventListener("resize",update);motion.removeEventListener("change",update);};
 },[ready]);

 const slide=(direction:1|-1)=>{
   const rail=railRef.current;if(!rail)return;
   const card=rail.querySelector<HTMLElement>(".v52-game-card");
   const distance=(card?.getBoundingClientRect().width||246)+14;
   rail.scrollBy({left:distance*direction,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
 };

 return <div className="v52-mobile-home">
   <section ref={sectionRef} className="v52-hero-surface" aria-label="Soft Tech mobile game studio">
     <header className="v52-header">
       <button className="v52-logo-button" onClick={()=>navigate("/")} aria-label="Soft Tech homepage">
         <img src="/assets/v5/soft-tech-header-cropped.png" alt="Soft Tech" width={440} height={232}/>
       </button>
       <div className="v52-header-controls">
         <button className="v52-language-button" onClick={toggleLanguage} aria-label={t("Switch language","Ganti bahasa")}><Globe2 size={16}/>{lang}</button>
         <button className="v52-menu-button" onClick={toggleMenu} aria-expanded={menuOpen} aria-controls="v52-site-navigation" aria-label={menuOpen?"Close menu":"Open menu"}>
           {menuOpen?<X size={23}/>:<Menu size={23}/>}
         </button>
       </div>
     </header>

     <div className="v52-editorial">
       <div className="v52-kicker"><span className="v52-live-dot" aria-hidden="true"/> [ 01 / 08 ] <span>INDEPENDENT GAME STUDIO</span></div>
       <h1><span>BUILDING</span><span>DIGITAL</span><span>GAME WORLDS</span><span>THAT STICK</span></h1>
       <p>{t("Original game experiences, immersive worlds and digital entertainment designed to stay with you.",
         "Game orisinal, dunia imersif, dan hiburan digital yang meninggalkan kesan.")}</p>
     </div>

     <div className="v52-art-scene" ref={sceneRef} aria-label="Orange retro computer with keyboard, printer and floating accessories">
       <div className="v52-art-glow" aria-hidden="true"/>
       <span className="v52-pixel-word v52-soft-word" aria-hidden="true">SOFT</span>
       <span className="v52-pixel-word v52-tech-word" aria-hidden="true">TECH</span>
       <div className="v52-model" aria-hidden="true">
         {hasFullAsset&&!ready&&<img src="/assets/v5/orange-computer-cutout.webp" alt="" className="v52-full-art" onError={()=>setHasFullAsset(false)}/>}
         <div className={"v52-layered-art"+(ready?" v52-art-ready":"")}>
           {LAYERS.map(part=><div key={part.id} className={"v52-depth-part v52-part-"+part.id} data-depth={part.depth} style={layerStyle(part)}>
             <img src={"/assets/v5/png/"+part.id+"-layer.png"} alt="" loading="eager"/>
           </div>)}
         </div>
       </div>
       <span className="v52-floating-sticker" aria-hidden="true">☺</span>
       <span className="v52-floating-smile" aria-hidden="true">☺</span>
       <span className="v52-floating-ring v52-ring-left" aria-hidden="true"/>
       <span className="v52-floating-ring v52-ring-right" aria-hidden="true"/>
       <span className="v52-floating-star" aria-hidden="true">✳</span>
     </div>

     <div className="v52-end">
       <div className="v52-count-row">
         <div className="v52-count-label"><Gamepad2 size={30}/><strong>03</strong><span>FLAGSHIP<br/>GAMES</span></div>
         <div className="v52-thumbnails">
           {games.map((game,index)=><button key={game.id} onClick={()=>navigate("/games/"+game.id)} aria-label={"Explore "+game.name}>
             <img src={game.cover} alt="" loading="lazy"/><span>0{index+1}</span>
           </button>)}
         </div>
       </div>
       <div className="v52-ctas">
         <button className="v52-primary-cta" onClick={()=>navigate("/games")}>{t("EXPLORE GAMES","JELAJAH GAME")} <ArrowUpRight size={17}/></button>
         <button className="v52-secondary-cta" onClick={()=>navigate("/contact")}>{t("CONTACT US","HUBUNGI KAMI")}</button>
       </div>
       <a className="v52-scroll-cue" href="#v52-featured"><span className="v52-scroll-glyph" aria-hidden="true">◉</span>{t("SCROLL TO EXPLORE","GESER UNTUK JELAJAH")} <ArrowDown size={15}/></a>
     </div>
   </section>

   <section className="v52-featured" id="v52-featured" aria-label="Featured games">
     <div className="v52-featured-header">
       <div><i aria-hidden="true"/><strong>OUR FLAGSHIP GAMES</strong><small>01 / 03</small></div>
       <div className="v52-rail-arrows"><span>SWIPE</span><button onClick={()=>slide(-1)} aria-label="Previous game"><ArrowLeft size={18}/></button><button onClick={()=>slide(1)} aria-label="Next game"><ArrowRight size={18}/></button></div>
     </div>
     <div className="v52-games-rail" ref={railRef}>
       {games.map((game,index)=><article className="v52-game-card" key={game.id}>
         <button className="v52-card-cover" onClick={()=>navigate("/games/"+game.id)} aria-label={"View "+game.name+" details"}>
           <img src={game.cover} alt={game.name+" original game artwork"} loading="lazy"/><span>0{index+1} / ORIGINAL</span>
         </button>
         <div className="v52-card-info"><span>{game.tag}</span><h2>{game.name}</h2><p>{game.slogan}</p>
           <a href={game.url} target="_blank" rel="noopener noreferrer" aria-label={"Play "+game.name+" demo"}>PLAY DEMO <ArrowUpRight size={16}/></a>
         </div>
       </article>)}
     </div>
   </section>

   <section className="v52-studio-summary">
     <span className="v52-studio-label">[ SOFT TECH / INDEPENDENT STUDIO ]</span>
     <h2>TURN IDEAS<br/>INTO <em>PLAYABLE</em><br/>WORLDS.</h2>
     <p>{t("From concept to interactive worlds, we create experiences that inspire, entertain and last.",
       "Dari ide menjadi dunia interaktif. Kami membuat pengalaman yang inspiratif, menyenangkan, dan berkesan.")}</p>
     <button onClick={()=>navigate("/company")}>{t("ABOUT OUR STUDIO","TENTANG STUDIO")} <ArrowUpRight size={18}/></button>
     <span className="v52-studio-decoration" aria-hidden="true">✳</span>
   </section>
 </div>;
}
