import React, { useEffect, useRef, useState } from "react";
import { GripVertical, PanelLeft, Settings2 } from "lucide-react";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SAVED = "softtech-studio-pane-widths-v2";
function initialWidths() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED) || "null");
    if (parsed) return { left: clamp(Number(parsed.left) || 238, 176, 360), right: clamp(Number(parsed.right) || 256, 200, 420) };
  } catch { /* Default panels are safe */ }
  return { left: 238, right: 256 };
}

/** Same left/canvas/inspector geometry in every workspace. */
export function StudioGrid({ children, className = "", testId }) {
  const [widths, setWidths] = useState(initialWidths);
  const resizing = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(SAVED, JSON.stringify(widths)); } catch { /* Browser-only settings */ }
  }, [widths]);

  const beginResize = (event, side) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = { side, pointerX: event.clientX, start: widths };
  };
  const moveResize = (event) => {
    const state = resizing.current;
    if (!state) return;
    const delta = event.clientX - state.pointerX;
    setWidths(prev => state.side === "left"
      ? { ...prev, left: clamp(state.start.left + delta, 176, 360) }
      : { ...prev, right: clamp(state.start.right - delta, 200, 420) });
  };
  const endResize = () => { resizing.current = null; };

  return <div className={"editor-grid studio-unified-grid " + className}
      data-testid={testId} style={{ "--studio-left": widths.left + "px", "--studio-right": widths.right + "px" }}>
    {children}
    {["left", "right"].map(side =>
      <div key={side} className={"studio-pane-resizer " + side}
        role="separator" tabIndex={0}
        aria-label={side === "left" ? "Resize left panel" : "Resize right panel"}
        aria-orientation="vertical"
        onPointerDown={event => beginResize(event, side)}
        onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowRight" ? 12 : -12;
          setWidths(prev => side === "left"
            ? { ...prev, left: clamp(prev.left + delta, 176, 360) }
            : { ...prev, right: clamp(prev.right - delta, 200, 420) });
        }}>
        <GripVertical size={12} />
      </div>
    )}
  </div>;
}

export function WorkspaceNavItem({ icon, title, detail, active = false, onClick, end }) {
  return <button type="button" className={"workspace-nav-item " + (active ? "is-selected" : "")} onClick={onClick}>
    {icon}<span className="workspace-nav-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{end}
  </button>;
}

export function StudioWorkspace({ title, subtitle, left, right, actions, children, mode }) {
  return <StudioGrid className="secondary-studio-grid" testId={mode + "-workspace"}>
    <aside className="editor-panel left-panel" aria-label={title + " navigator"}>
      <div className="panel-tabs studio-rail-title"><PanelLeft size={15} /><span>Navigator</span></div>
      <div className="studio-rail-content">{left}</div>
    </aside>
    <main className="editor-main">
      <div className="canvas-toolbar studio-workspace-toolbar">
        <div className="studio-workspace-title"><strong>{title}</strong><span>{subtitle}</span></div>
        <div className="studio-toolbar-actions">{actions}</div>
      </div>
      <div className="studio-workspace-scroller">
        <div className="studio-workspace-body">{children}</div>
      </div>
    </main>
    <aside className="editor-panel right-panel" aria-label={title + " inspector"}>
      <div className="panel-tabs studio-rail-title"><Settings2 size={15} /><span>Inspector</span></div>
      <div className="studio-rail-content">{right}</div>
    </aside>
  </StudioGrid>;
}
