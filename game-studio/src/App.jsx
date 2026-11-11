import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers3, Image as ImageIcon, SlidersHorizontal, Music2, ChartNoAxesCombined,
  Share2, Download, Undo2, Redo2, Play, Square, Eye, EyeOff,
  Plus, Trash2, Lock, Unlock, Monitor, Smartphone, Grid2X2,
  Grip, MousePointer2, Upload, RotateCcw, Save, Check, AlertTriangle,
  FileCode2, ChevronDown, Info, Volume2, VolumeX, Folder,
} from "lucide-react";
import { DEFAULT_BRAND, previewBrand, generateBrandZip, buildMetaTags, validateBrand } from "./brandAssets.js";
import { clampDraftLayout, SLOT_LIMITS } from "./slot/slotCore.js";
import { validateFactoryImport } from "./factoryImport.js";

const STORAGE_KEY = "softtech-universal-game-studio-v1";
const INITIAL = {
  name: "Cyber Punk",
  canvas: { device: "desktop", grid: "dots", background: "#23252a", gridSize: 24, gridOpacity: 28, zoom: 75, snap: false },
  layers: [
    { id: "background", name: "Backdrop", type: "background", x: 0, y: 0, width: 960, height: 540, opacity: 100, visible: true, locked: true, fill: "#101324" },
    { id: "heading", name: "Game Title", type: "text", x: 305, y: 38, width: 350, height: 72, mobile: { x: 22, y: 100, width: 346, height: 70 }, opacity: 100, visible: true, locked: false, fill: "#e9d5ff", text: "CYBER PUNK" },
    { id: "reels", name: "Slot Reels", type: "reels", x: 170, y: 129, width: 620, height: 290, mobile: { x: 15, y: 245, width: 360, height: 300 }, opacity: 100, visible: true, locked: false, fill: "#262146" },
    { id: "spin", name: "Spin Button", type: "button", x: 410, y: 442, width: 140, height: 62, mobile: { x: 112, y: 598, width: 166, height: 68 }, opacity: 100, visible: true, locked: false, fill: "#8258f2", text: "SPIN" },
    { id: "balance", name: "Balance Label", type: "text", x: 28, y: 460, width: 260, height: 42, mobile: { x: 30, y: 717, width: 330, height: 42 }, opacity: 100, visible: true, locked: false, fill: "#a8b9d8", text: "DEMO BALANCE 10,000" },
  ],
  audio: [
    { id: "music", name: "Background Music", volume: 65, muted: false },
    { id: "spin", name: "Spin / Reel", volume: 80, muted: false },
    { id: "win", name: "Big Win", volume: 90, muted: false },
    { id: "bonus", name: "Free Spin", volume: 75, muted: false },
  ],
  economy: { minBet: 100, maxBet: 10000, paylines: 20, reels: 5, rows: 3, targetRtp: 96 },
  brand: { ...DEFAULT_BRAND },
};
const swatches = ["#111111", "#23252a", "#42454d", "#bfc3ca", "#f5f5f5", "#ffffff"];
const reelSymbols = ["⚡", "💎", "🤖", "✦", "🔷", "🟣"];
const safeLoad = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(INITIAL);
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.layers) || !p.canvas || !p.audio || !p.economy || !p.brand) throw Error("invalid");
    p.economy = { ...p.economy, ...clampDraftLayout(p.economy) };
    return p;
  } catch { return structuredClone(INITIAL); }
};
const int = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const rgba = (hex, alpha) => {
  const clean = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return "transparent";
  return "rgba(" + [0, 2, 4].map(n => parseInt(clean.slice(n, n + 2), 16)).join(",") + "," + alpha + ")";
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
};
function Button({ children, onClick, active = false, title, disabled = false, className = "" }) {
  return <button type="button" title={title} className={"tool-button " + (active ? "active " : "") + className} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Field({ label, value, onChange, type = "text", min, max, step = 1, placeholder, disabled = false }) {
  return <label className="field"><span>{label}</span><input type={type} value={value ?? ""} min={min} max={max} step={step} placeholder={placeholder} disabled={disabled} onChange={e => onChange(type === "number" || type === "range" ? int(e.target.value) : e.target.value)} /></label>;
}
function GroupTitle({ children, accessory }) {
  return <div className="group-title"><b>{children}</b>{accessory}</div>;
}
function getRect(layer, device) {
  if (device === "desktop") return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  if (layer.mobile) return layer.mobile;
  return { x: Math.round(layer.x * .40625), y: Math.round(layer.y * 1.56), width: Math.round(layer.width * .40625), height: Math.round(layer.height * 1.56) };
}
function GameLayer({ layer, selected, preview, device, spinIteration, layout, factory, onSelect, onPointerDown, onPointerMove, onPointerUp }) {
  const rect = getRect(layer, device);
  if (!layer.visible) return null;
  const style = {
    position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: layer.opacity / 100,
    zIndex: layer.type === "background" ? 0 : undefined,
    outline: selected && !preview ? "2px solid #0d99ff" : "none",
    outlineOffset: 1,
    cursor: preview || layer.locked ? "default" : "move",
    touchAction: "none",
  };
  let view;
  if (layer.type === "background") {
    view = <div style={{ width: "100%", height: "100%", background: "radial-gradient(ellipse at 68% 42%, " + rgba("#925aff", .3) + ", transparent 55%)," + layer.fill }} />;
  } else if (layer.type === "reels") {
    view = <div className="reel-wrap" data-reels={layout.reels} data-rows={layout.rows} style={{
      background: layer.fill,
      gridTemplateColumns: "repeat(" + layout.reels + ", minmax(0,1fr))",
      gridTemplateRows: "repeat(" + layout.rows + ", minmax(0,1fr))",
      padding: layout.reels >= 7 || layout.rows >= 6 ? 5 : 11,
      gap: layout.reels >= 7 || layout.rows >= 6 ? 3 : 6,
    }}>
      {Array.from({ length: layout.reels * layout.rows }, (_, i) => {
        const reel = i % layout.reels;
        const row = Math.floor(i / layout.reels);
        const strip = factory?.configuration?.reelStrips?.[reel];
        const symbolId = strip?.[(row + reel * 3 + spinIteration) % strip.length];
        return <div key={i} className="reel-cell" style={{ fontSize: Math.max(15, Math.min(42, Math.floor(42 * Math.min(5 / layout.reels, 3 / layout.rows)))) }}>
          {factory?.symbolAssets?.[symbolId] ?
            <img alt={symbolId} draggable={false} className="factory-reel-symbol" src={factory.symbolAssets[symbolId]}/> :
            reelSymbols[(i * 7 + (spinIteration ? (spinIteration + i * 3) : 0)) % reelSymbols.length]}
        </div>;
      })}
    </div>;
  } else if (layer.type === "button") {
    view = <div className="game-button" style={{ background: layer.fill }}>{layer.text || "BUTTON"}</div>;
  } else if (layer.type === "image") {
    view = <img alt={layer.name} draggable={false} className="stage-image" src={layer.src} />;
  } else {
    view = <div className={"game-text " + (layer.id === "heading" ? "game-heading" : "")} style={{ color: layer.fill }}>{layer.text || layer.name}</div>;
  }
  return <div className={"scene-layer " + (selected && !preview ? "selected" : "")} style={style} onPointerDown={e => { onSelect(layer.id); if (!preview && !layer.locked) { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onPointerDown(e, layer); } }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>{view}</div>;
}
function BrandPage({ brand, updateBrand }) {
  const [preview, setPreview] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    try { setPreview(previewBrand(brand)); } catch { setPreview(null); }
  }, [brand]);
  const problems = validateBrand(brand);
  const exportZip = async () => {
    setExporting(true);
    setMessage("");
    try {
      const file = await generateBrandZip(brand);
      downloadBlob(file.blob, file.filename);
      setMessage("Asset pack downloaded. Upload and publish still require a separate deployment.");
    } catch (e) { setMessage("Gagal export: " + e.message); }
    finally { setExporting(false); }
  };
  return <div className="brand-workspace">
    <div className="workspace-intro"><div><h2>Brand & Share Assets</h2><p>Generate independent icons, metadata, and link-preview artwork. Everything remains a draft until published.</p></div>
      <button className="primary-button" onClick={exportZip} disabled={exporting}><Download size={15} />{exporting ? "Generating…" : "Export asset pack"}</button>
    </div>
    <div className="brand-columns">
      <section className="brand-editor soft-panel">
        <GroupTitle>IDENTITY</GroupTitle>
        <Field label="Game name" value={brand.name} onChange={v => updateBrand("name", v)} />
        <Field label="Short app name" value={brand.shortName} onChange={v => updateBrand("shortName", v)} />
        <label className="field"><span>SEO description</span><textarea rows={4} maxLength={200} value={brand.description} onChange={e => updateBrand("description", e.target.value)} /></label>
        <div className="char-counter">{String(brand.description || "").length}/160 recommended characters</div>
        <Field label="Public HTTPS URL" placeholder="https://games.example.com/cyber-punk" value={brand.publicUrl} onChange={v => updateBrand("publicUrl", v)} />
        <div className="field-line"><label className="field"><span>Accent</span><input type="color" value={brand.color} onChange={e => updateBrand("color", e.target.value)} /></label>
          <label className="field"><span>Background</span><input type="color" value={brand.background} onChange={e => updateBrand("background", e.target.value)} /></label></div>
        <div className="info-note"><Info size={16} />Sandbox metadata automatically uses noindex. Production requires a separate release gate.</div>
      </section>
      <section className="brand-previews">
        <div className="preview-row">
          <div className="preview-card soft-panel"><GroupTitle>FAVICON / BROWSER TAB</GroupTitle><div className="browser-sample"><div className="browser-dot"/>{preview && <img src={preview.icon} alt="Favicon preview" />} <span>{brand.name || "New Game"} | Soft Tech</span></div><p>SVG, ICO, PNG 16 × 16 and 32 × 32</p></div>
          <div className="preview-card soft-panel"><GroupTitle>APPLE TOUCH / APP ICON</GroupTitle><div className="touch-sample">{preview && <img src={preview.icon} alt="Apple touch icon preview" />}</div><p>180 × 180, Android 192 / 512 and maskable</p></div>
        </div>
        <div className="preview-card soft-panel"><GroupTitle>TELEGRAM / SOCIAL OPEN GRAPH</GroupTitle><div className="og-card">{preview && <img src={preview.og} alt="Telegram Open Graph preview" />}</div><p>1200 × 630 PNG. Telegram may crop or cache the published image.</p></div>
        <div className="soft-panel metadata"><GroupTitle>META TAGS PREVIEW <button className="mini-button" onClick={() => navigator.clipboard?.writeText(buildMetaTags(brand))}>Copy tags</button></GroupTitle><pre>{buildMetaTags(brand)}</pre></div>
      </section>
    </div>
    {problems.length > 0 && <div className="warning"><AlertTriangle size={15} />{problems.join(" ") } Export is allowed for a draft, but the link cannot be verified yet.</div>}
    {message && <div className="toast">{message}</div>}
  </div>;
}
function App() {
  const [project, setProject] = useState(safeLoad);
  const [tab, setTab] = useState("visual");
  const [sidebar, setSidebar] = useState("layers");
  const [selection, setSelection] = useState("spin");
  const [preview, setPreview] = useState(false);
  const [spinIteration, setSpinIteration] = useState(0);
  const [assetInfo, setAssetInfo] = useState("");
  const [factoryMessage, setFactoryMessage] = useState("");
  const [audioFiles, setAudioFiles] = useState({});
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [fitToView, setFitToView] = useState(true);
  const [historyState, forceHistory] = useState(0);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const drag = useRef(null);
  const imagePicker = useRef(null);
  const factoryPicker = useRef(null);
  const audioRefs = useRef({});
  const viewportRef = useRef(null);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { /* local draft may exceed storage limit */ } }, [project]);
  const commit = (makeNext) => setProject(prev => {
    const next = typeof makeNext === "function" ? makeNext(prev) : makeNext;
    if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
    undoStack.current.push(JSON.stringify(prev));
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    forceHistory(n => n + 1);
    return next;
  });
  const undo = () => {
    if (!undoStack.current.length) return;
    const previous = undoStack.current.pop();
    redoStack.current.push(JSON.stringify(project));
    setProject(JSON.parse(previous)); forceHistory(n => n + 1);
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    undoStack.current.push(JSON.stringify(project));
    setProject(JSON.parse(next)); forceHistory(n => n + 1);
  };
  useEffect(() => {
    const handler = e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      e.preventDefault(); if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const patch = (section, changes) => commit(prev => ({ ...prev, [section]: { ...prev[section], ...changes } }));
  const patchLayer = (id, changes) => commit(prev => ({ ...prev, layers: prev.layers.map(l => l.id === id ? { ...l, ...changes } : l) }));
  const patchAudio = (id, changes) => commit(prev => ({ ...prev, audio: prev.audio.map(t => t.id === id ? { ...t, ...changes } : t) }));
  const importFactoryProject = async file => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Factory project JSON must be smaller than 1 MB");
      const incoming = validateFactoryImport(await file.text());
      if (!window.confirm("Import " + incoming.name + "? Existing local draft will be backed up and replaced. Undo is available.")) return;
      // Save the prior draft locally before replacement, without mutating other games.
      const backupKey = STORAGE_KEY + ":backup:" + Date.now();
      localStorage.setItem(backupKey, JSON.stringify(project));
      const backups = Object.keys(localStorage).filter(key => key.startsWith(STORAGE_KEY + ":backup:")).sort();
      for (const key of backups.slice(0, -3)) localStorage.removeItem(key);
      commit(incoming);
      setSelection("reels");
      setPreview(false);
      setSpinIteration(0);
      setTab("visual");
      setSidebar("layers");
      setFactoryMessage("Imported " + incoming.name + " as an editable demo draft. Mathematical release remains BLOCKED.");
    } catch (error) { setFactoryMessage("Import rejected: " + error.message); }
  };
  const layer = project.layers.find(l => l.id === selection);
  const canvas = project.canvas;
  const layout = clampDraftLayout(project.economy);
  const device = canvas.device;
  const gridColor = rgba(canvas.background === "#ffffff" || canvas.background === "#f5f5f5" ? "#394151" : "#e2e8f0", canvas.gridOpacity / 100);
  const gridStyle = {
    backgroundColor: canvas.background,
    backgroundSize: canvas.gridSize + "px " + canvas.gridSize + "px",
    backgroundImage: canvas.grid === "dots" ? "radial-gradient(circle, " + gridColor + " 1px, transparent 1.5px)"
      : canvas.grid === "squares" ? "linear-gradient(" + gridColor + " 1px, transparent 1px), linear-gradient(90deg, " + gridColor + " 1px, transparent 1px)" : "none",
  };
  const stageSize = device === "desktop" ? { width: 960, height: 540 } : { width: 390, height: 844 };
  const stageStyle = { width: stageSize.width, height: stageSize.height, transform: "scale(" + (canvas.zoom / 100) + ")", transformOrigin: "top left" };
  const fitZoomFor = (el, mode) => {
    if (!el) return null;
    const dimensions = mode === "desktop" ? { width: 960, height: 540 } : { width: 390, height: 844 };
    const ratio = Math.min(
      Math.max(1, el.clientWidth - 70) / dimensions.width,
      Math.max(1, el.clientHeight - 72) / dimensions.height
    );
    return Math.max(25, Math.min(125, Math.floor(ratio * 100)));
  };
  useEffect(() => {
    if (tab !== "visual" || !fitToView || !viewportRef.current) return;
    const el = viewportRef.current;
    const update = () => {
      const zoom = fitZoomFor(el, project.canvas.device);
      if (zoom !== null) setProject(prev => prev.canvas.zoom === zoom ? prev : {
        ...prev, canvas: { ...prev.canvas, zoom }
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, fitToView, project.canvas.device, timelineOpen]);
  const switchDevice = nextDevice => {
    setFitToView(true);
    patch("canvas", { device: nextDevice });
  };
  const fitCanvas = () => {
    setFitToView(true);
    const zoom = fitZoomFor(viewportRef.current, device);
    if (zoom !== null) patch("canvas", { zoom });
  };
  const manualZoom = nextZoom => {
    setFitToView(false);
    patch("canvas", { zoom: Math.max(25, Math.min(160, nextZoom)) });
  };
  const addLayer = (type) => {
    const id = "layer-" + Math.random().toString(36).slice(2, 10);
    const fresh = { id, type, name: type === "button" ? "New Button" : type === "image" ? "New Image" : "New Text", x: 315, y: 220, width: type === "text" ? 240 : 180, height: 60,
      mobile: { x: 70, y: 320, width: 220, height: 60 }, opacity: 100, fill: type === "button" ? "#0d99ff" : "#ffffff", text: type === "button" ? "BUTTON" : "Edit text", visible: true, locked: false };
    commit(prev => ({ ...prev, layers: [...prev.layers, fresh] })); setSelection(id);
  };
  const importImage = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1024 * 1024) {
      setAssetInfo("Only images up to 1 MB can be added to this browser-local draft."); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const id = "image-" + Date.now();
      const fresh = { id, name: file.name, type: "image", x: 350, y: 200, width: 180, height: 160, mobile: { x: 105, y: 350, width: 180, height: 160 }, opacity: 100, visible: true, locked: false, src: reader.result };
      commit(prev => ({ ...prev, layers: [...prev.layers, fresh] })); setSelection(id); setAssetInfo("Image added to the local draft.");
    };
    reader.readAsDataURL(file);
  };
  const onDragStart = (e, item) => {
    const rect = getRect(item, device);
    undoStack.current.push(JSON.stringify(project)); redoStack.current = []; forceHistory(n => n + 1);
    drag.current = { id: item.id, x: e.clientX, y: e.clientY, start: rect, device };
  };
  const onDragMove = e => {
    if (!drag.current || preview) return;
    const d = drag.current;
    const dx = (e.clientX - d.x) / (canvas.zoom / 100);
    const dy = (e.clientY - d.y) / (canvas.zoom / 100);
    const snap = v => canvas.snap ? Math.round(v / 8) * 8 : Math.round(v);
    const changes = { x: snap(d.start.x + dx), y: snap(d.start.y + dy), width: d.start.width, height: d.start.height };
    setProject(prev => ({ ...prev, layers: prev.layers.map(l => {
      if (l.id !== d.id) return l;
      return d.device === "mobile" ? { ...l, mobile: changes } : { ...l, x: changes.x, y: changes.y };
    }) }));
  };
  const onDragEnd = () => { drag.current = null; };
  const changeRect = (key, value) => {
    if (!layer) return;
    if (device === "desktop") patchLayer(layer.id, { [key]: value });
    else patchLayer(layer.id, { mobile: { ...getRect(layer, "mobile"), [key]: value } });
  };
  const removeLayer = () => {
    if (!layer || layer.locked) return;
    commit(prev => ({ ...prev, layers: prev.layers.filter(l => l.id !== layer.id) }));
    setSelection("spin");
  };
  const exportProject = () => downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), "softtech-cyber-punk-studio-draft.json");
  const triggerAudio = (id, file) => {
    if (!file || !file.type.startsWith("audio/")) return;
    if (audioFiles[id]) URL.revokeObjectURL(audioFiles[id]);
    const url = URL.createObjectURL(file);
    setAudioFiles(prev => ({ ...prev, [id]: url }));
  };
  useEffect(() => {
    project.audio.forEach(t => {
      const el = audioRefs.current[t.id];
      if (el) { el.volume = t.muted ? 0 : t.volume / 100; }
    });
  }, [project.audio, audioFiles]);
  const names = { visual: "Visual Editor", audio: "Audio Studio", economy: "Economy Lab", brand: "Brand & Share" };
  return <div className="app-shell">
    <header className="app-top">
      <div className="brand-mark"><span className="brand-squares">▦</span><strong>SOFT TECH</strong><span className="brand-separator">/</span><span>GAME STUDIO</span></div>
      <div className="project-chip"><span className="status-dot" />{project.name}<ChevronDown size={13} /></div>
      <div className="top-right"><span className="draft-pill"><Check size={13} />Local draft</span>
        <Button title="Undo" disabled={!undoStack.current.length} onClick={undo}><Undo2 size={17}/></Button>
        <Button title="Redo" disabled={!redoStack.current.length} onClick={redo}><Redo2 size={17}/></Button>
        <input ref={factoryPicker} type="file" accept=".json,application/json" hidden aria-label="Factory project JSON" onChange={e => { importFactoryProject(e.target.files?.[0]); e.target.value = ""; }}/>
        <button className="factory-import-button" onClick={() => factoryPicker.current?.click()} title="Import a versioned, demo-only Game Factory project"><Upload size={14}/> Import Game Factory</button>
        <Button title="Export project JSON" onClick={exportProject}><Save size={17}/></Button>
        <button className={"preview-toggle " + (preview ? "playing" : "")} onClick={() => setPreview(v => !v)}>{preview ? <Square size={14}/> : <Play size={14}/>} {preview ? "Edit" : "Preview"}</button>
      </div>
    </header>
    {factoryMessage && <div role="status" className="factory-import-message">{factoryMessage}<button title="Dismiss import notice" onClick={() => setFactoryMessage("")}>×</button></div>}
    <nav className="workspace-tabs" aria-label="Studio sections">
      {[["visual", Layers3], ["audio", Music2], ["economy", ChartNoAxesCombined], ["brand", Share2]].map(([id, Icon]) => <button key={id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}><Icon size={16}/>{names[id]}</button>)}
      <div className="workspace-tabs-note">V1 SANDBOX · NO LIVE GAME</div>
    </nav>
    {tab === "visual" && <div className="editor-grid">
      <aside className="editor-panel left-panel">
        <div className="panel-tabs"><button className={sidebar === "layers" ? "current" : ""} onClick={() => setSidebar("layers")}><Layers3 size={15}/> Layers</button><button className={sidebar === "assets" ? "current" : ""} onClick={() => setSidebar("assets")}><ImageIcon size={15}/> Assets</button></div>
        {sidebar === "layers" ? <>
          <GroupTitle>SCENE GRAPH <button className="mini-button" onClick={() => addLayer("text")}><Plus size={13}/> Add</button></GroupTitle>
          <div className="layer-list">{[...project.layers].reverse().map(l => <div key={l.id} className={"layer-row " + (selection === l.id ? "chosen" : "")} onClick={() => setSelection(l.id)}>
            {l.type === "image" ? <ImageIcon size={15}/> : l.type === "text" ? <FileCode2 size={15}/> : <Layers3 size={15}/>}
            <span>{l.name}</span>
            <button title={l.visible ? "Hide" : "Show"} onClick={e => { e.stopPropagation(); patchLayer(l.id, { visible: !l.visible }); }}>{l.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
            <button title={l.locked ? "Unlock" : "Lock"} onClick={e => { e.stopPropagation(); patchLayer(l.id, { locked: !l.locked }); }}>{l.locked ? <Lock size={13}/> : <Unlock size={13}/>}</button>
          </div>)}</div>
          <div className="subtle-label">Every UI element is independent; edit visuals without changing game mathematics.</div>
        </> : <>
          <GroupTitle>ASSET LIBRARY</GroupTitle>
          {project.factory && <section className="factory-assets"><b>GAME FACTORY SYMBOLS</b>
            <p>{project.factory.gameId} · source v{project.factory.sourceGameVersion}</p>
            <div className="factory-symbols">{project.factory.symbolIds.map(symbol => <label key={symbol} className="factory-symbol-card" title={"Replace " + symbol + " (SVG)">
              <img alt={"Factory asset " + symbol} src={project.factory.symbolAssets[symbol]}/>
              <span>{symbol}</span>
              <input aria-label={"Replace " + symbol + " symbol SVG"} type="file" accept=".svg,image/svg+xml" hidden onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  if (file.size > 12000) throw new Error("SVG exceeds 12 KB");
                  const svg = await file.text();
                  const data = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
                  const fresh = { ...project, factory: { ...project.factory, symbolAssets: { ...project.factory.symbolAssets, [symbol]: data } } };
                  validateFactoryImport(fresh);
                  commit(fresh);
                  setAssetInfo(symbol + " replaced for the visual draft. Source math stays unchanged.");
                } catch (error) { setAssetInfo("SVG replacement blocked: " + error.message); }
              }}/>
            </label>)}</div>
            <p>Each symbol is an independently replaceable SVG. Math stays locked to the versioned manifest.</p>
          </section>}
          <div className="asset-actions"><button onClick={() => addLayer("text")}><FileCode2 size={17}/> Text</button><button onClick={() => addLayer("button")}><Plus size={17}/> Button</button><button onClick={() => imagePicker.current?.click()}><Upload size={17}/> Image</button></div>
          <input ref={imagePicker} hidden type="file" accept="image/*" onChange={e => { importImage(e.target.files?.[0]); e.target.value = ""; }}/>
          <div className="asset-placeholder"><Folder size={27} /><b>Local asset collection</b><span>Import a PNG, SVG, JPG or WebP. A server asset library will come in a later phase.</span></div>
          {assetInfo && <p className="subtle-label">{assetInfo}</p>}
        </>}
      </aside>
      <main className="editor-main">
        <div className="canvas-toolbar">
          <div className="toolbar-group"><MousePointer2 size={16}/><span>Move tool</span></div>
          <div className="toolbar-group device-toggle"><Button active={device === "desktop"} title="Desktop preview" onClick={() => switchDevice("desktop")}><Monitor size={16}/></Button><Button active={device === "mobile"} title="Mobile preview" onClick={() => switchDevice("mobile")}><Smartphone size={16}/></Button></div>
          <div className="toolbar-group"><Grid2X2 size={14}/><select aria-label="Canvas grid pattern" value={canvas.grid} onChange={e => patch("canvas", { grid: e.target.value })}><option value="dots">Dot grid</option><option value="squares">Square grid</option><option value="clean">Clean</option></select></div>
          <div className="toolbar-group zoom-control"><button title="Zoom out" aria-label="Zoom out" onClick={() => manualZoom(canvas.zoom - 10)}>−</button><span>{canvas.zoom}%</span><button title="Zoom in" aria-label="Zoom in" onClick={() => manualZoom(canvas.zoom + 10)}>+</button><button title="Fit canvas to view" aria-label="Fit canvas to view" className={fitToView ? "zoom-fit active" : "zoom-fit"} onClick={fitCanvas}>Fit</button></div>
        </div>
        <div className="canvas-viewport" ref={viewportRef} style={gridStyle}>
          <div className="stage-outer" style={{ width: stageSize.width * canvas.zoom / 100, height: stageSize.height * canvas.zoom / 100 }}>
            <div className="game-stage" style={stageStyle}>
              {project.layers.map(l => <GameLayer key={l.id} layer={l} selected={selection === l.id} preview={preview} device={device} spinIteration={spinIteration} layout={layout} factory={project.factory} onSelect={setSelection} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}/>)}
              {preview && <button title="Demonstrate reel visuals only. Not a real spin." className="preview-spin-overlay" style={{ left: getRect(project.layers.find(l => l.id === "spin") || INITIAL.layers[3], device).x, top: getRect(project.layers.find(l => l.id === "spin") || INITIAL.layers[3], device).y, width: getRect(project.layers.find(l => l.id === "spin") || INITIAL.layers[3], device).width, height: getRect(project.layers.find(l => l.id === "spin") || INITIAL.layers[3], device).height }} onClick={() => setSpinIteration(n => n + 1)} /> }
            </div>
          </div>
          <div className="canvas-corner-note">{preview ? "PLAYABLE VISUAL PREVIEW ONLY · NOT RNG / WALLET" : "DRAG AN ELEMENT TO REPOSITION"}</div>
        </div>
        {timelineOpen && <div className="timeline"><div className="timeline-head"><b>ANIMATION TIMELINE</b><span>Visual reference · No keyframes yet</span><button onClick={() => setTimelineOpen(false)}>Hide</button></div><div className="timeline-track"><div>Scene</div><div className="track-markers"><span/><span/><span/><span/><span/></div><span>0:00 / 0:05</span></div></div>}
        {!timelineOpen && <button className="timeline-reveal" onClick={() => setTimelineOpen(true)}>Show timeline</button>}
      </main>
      <aside className="editor-panel right-panel">
        <GroupTitle>CANVAS SETTINGS <SlidersHorizontal size={15}/></GroupTitle>
        <div className="inspector-section">
          <div className="field-label">Workspace color</div>
          <div className="swatches">{swatches.map(hex => <button key={hex} title={hex} aria-label={"Set canvas " + hex} className={canvas.background.toLowerCase() === hex ? "picked" : ""} style={{ background: hex }} onClick={() => patch("canvas", { background: hex })}/>)}
            <input title="Custom canvas color" aria-label="Custom canvas color" type="color" value={canvas.background} onChange={e => patch("canvas", { background: e.target.value })}/>
          </div>
          <div className="field-label">Grid</div>
          <div className="three-way">{[["clean", "Clean"], ["squares", "Square"], ["dots", "Dots"]].map(([v, t]) => <button key={v} className={canvas.grid === v ? "chosen" : ""} onClick={() => patch("canvas", { grid: v })}>{t}</button>)}</div>
          {canvas.grid !== "clean" && <><Field label="Grid spacing (px)" value={canvas.gridSize} type="number" min={8} max={100} onChange={v => patch("canvas", { gridSize: Math.max(8, Math.min(100, v)) })}/><label className="range-field"><span>Grid opacity <b>{canvas.gridOpacity}%</b></span><input type="range" min={0} max={100} value={canvas.gridOpacity} onChange={e => patch("canvas", { gridOpacity: int(e.target.value) })}/></label></>}
          <label className="toggle-line"><input type="checkbox" checked={canvas.snap} onChange={e => patch("canvas", { snap: e.target.checked })}/> Snap dragging to 8px</label>
        </div>
        <GroupTitle>OBJECT INSPECTOR</GroupTitle>
        {!layer ? <div className="empty-inspector">Select a layer to edit its position, size, text, opacity and colors.</div> : <div className="inspector-section">
          <div className="selected-name">{layer.name}<span>{layer.type}</span></div>
          <div className="inspector-grid">
            {["x", "y", "width", "height"].map(key => <Field key={key} label={key.toUpperCase()} type="number" value={getRect(layer, device)[key]} onChange={v => changeRect(key, Math.max(key === "width" || key === "height" ? 1 : -2000, v))}/>)}
          </div>
          <label className="range-field"><span>Opacity <b>{layer.opacity}%</b></span><input type="range" min={0} max={100} value={layer.opacity} onChange={e => patchLayer(layer.id, { opacity: int(e.target.value) })}/></label>
          {layer.fill && <label className="field"><span>Fill color</span><input type="color" value={layer.fill} onChange={e => patchLayer(layer.id, { fill: e.target.value })}/></label>}
          {(layer.type === "button" || layer.type === "text") && <Field label="Text content" value={layer.text || ""} onChange={v => patchLayer(layer.id, { text: v })}/>}
          <div className="inspector-actions"><button onClick={() => patchLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <Unlock size={14}/> : <Lock size={14}/>} {layer.locked ? "Unlock" : "Lock"}</button><button onClick={removeLayer} disabled={layer.locked}><Trash2 size={14}/> Remove</button></div>
          <div className="subtle-label">Editing the {device} layout. Position changes are saved independently for mobile.</div>
        </div>}
      </aside>
    </div>}
    {tab === "audio" && <div className="simple-workspace">
      <div className="workspace-intro"><div><h2>Audio Studio</h2><p>Upload local sample tracks and tune mix levels. Assets and triggers will connect to the runtime later.</p></div><span className="soft-tag">BROWSER-LOCAL PREVIEW</span></div>
      <div className="audio-list">{project.audio.map(t => <section className="audio-track soft-panel" key={t.id}><div className="audio-title"><Music2 size={18}/><strong>{t.name}</strong><span>{t.muted ? "Muted" : t.volume + "%"}</span><Button title={t.muted ? "Unmute" : "Mute"} onClick={() => patchAudio(t.id, { muted: !t.muted })}>{t.muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</Button></div>
        <label className="range-field"><span>Volume</span><input type="range" min={0} max={100} value={t.volume} onChange={e => patchAudio(t.id, { volume: int(e.target.value) })}/></label>
        <input type="file" accept="audio/*" aria-label={"Upload " + t.name} onChange={e => triggerAudio(t.id, e.target.files?.[0])}/>
        {audioFiles[t.id] ? <audio ref={el => { audioRefs.current[t.id] = el; }} controls src={audioFiles[t.id]}/> : <div className="subtle-label">No audio uploaded for preview.</div>}
      </section>)}</div>
    </div>}
    {tab === "economy" && <div className="simple-workspace economy-workspace">
      <div className="workspace-intro"><div><h2>Economy & Math Lab</h2><p>Keep draft game parameters separate from visuals. These are not certified mathematical outcomes.</p></div><span className="soft-tag danger"><AlertTriangle size={14}/> NOT VERIFIED</span></div>
      {project.factory && <section className="factory-import-banner"><b>Game Factory: {project.factory.gameId}</b><span>Version {project.factory.sourceGameVersion} · {project.factory.mathBinding} · RELEASE BLOCKED</span><p>Layout/payline math is sourced from the generated manifest and locked here. To change game math, regenerate through Game Factory; visuals and sound remain editable.</p></section>}
      <section className="economy-card soft-panel"><GroupTitle>DRAFT GAME CONFIGURATION</GroupTitle><div className="economy-fields">
        <Field label="Minimum bet" type="number" min={1} value={project.economy.minBet} onChange={v => patch("economy", { minBet: v })}/>
        <Field label="Maximum bet" type="number" min={1} value={project.economy.maxBet} onChange={v => patch("economy", { maxBet: v })}/>
        <Field label="Reels" type="number" disabled={!!project.factory} min={SLOT_LIMITS.minReels} max={SLOT_LIMITS.maxReels} value={layout.reels} onChange={v => patch("economy", { reels: clampDraftLayout({ ...project.economy, reels: v }).reels })}/>
        <Field label="Rows" type="number" disabled={!!project.factory} min={SLOT_LIMITS.minRows} max={SLOT_LIMITS.maxRows} value={layout.rows} onChange={v => patch("economy", { rows: clampDraftLayout({ ...project.economy, rows: v }).rows })}/>
        <Field label="Paylines" type="number" disabled={!!project.factory} min={1} value={project.economy.paylines} onChange={v => patch("economy", { paylines: v })}/>
        <Field label="Target RTP (%) · unverified" type="number" disabled={!!project.factory} min={0} max={100} step={.1} value={project.economy.targetRtp} onChange={v => patch("economy", { targetRtp: v })}/>
      </div>
      <div className="layout-presets" aria-label="Slot layout presets">
        <strong>Slot grid presets</strong>
        {[[5, 3], [5, 5], [6, 3], [6, 5]].map(([reels, rows]) =>
          <button type="button" disabled={!!project.factory} key={reels + "x" + rows} className={layout.reels === reels && layout.rows === rows ? "chosen" : ""} onClick={() => patch("economy", { reels, rows })}>
            {reels} × {rows}
          </button>)}
        <span>Custom grid: {layout.reels} reels × {layout.rows} rows. Preview is visual only; math and measured RTP are not yet connected.</span>
      </div></section>
      <section className="economy-notice soft-panel"><AlertTriangle size={24}/><div><strong>Simulation not connected</strong><p>Target RTP is a design target, not measured RTP. No math model, RNG audit, or simulated-spin proof exists in this V1 editor. Production approval is blocked until independent math, security, wallet and performance tests pass.</p></div></section>
      <button className="secondary-button" onClick={() => downloadBlob(new Blob([JSON.stringify(project.economy, null, 2)], { type: "application/json" }), "softtech-economy-draft.json")}><Download size={15}/> Export draft configuration</button>
    </div>}
    {tab === "brand" && <BrandPage brand={project.brand} updateBrand={(key, v) => patch("brand", { [key]: v })}/>}
    <footer className="app-status"><span><span className="status-dot"/> Studio V1 · isolated branch</span><span>{tab === "visual" ? device + " canvas · " + canvas.zoom + "% zoom" : names[tab]} </span><span>Browser-local draft · {window.location.hostname.endsWith(".up.railway.app") ? "Railway staging" : "Local preview"}</span></footer>
  </div>;
}
export default App;
