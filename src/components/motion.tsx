"use client";
import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

function hasReducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (bar.current) bar.current.style.transform =
          "scaleX(" + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ")";
        frame = 0;
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />;
}

export function Reveal({
  children,
  className = "",
  delay = 0
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    if (hasReducedMotion() || !("IntersectionObserver" in window)) {
      el.classList.add("is-visible");
      return;
    }
    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -36px 0px", threshold: 0.09 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={element} className={"reveal " + className} style={{ "--reveal-delay": delay + "ms" } as CSSProperties}>
      {children}
    </div>
  );
}

export function ParallaxScene({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const update = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || hasReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--scene-x", (x * 26).toFixed(2) + "px");
      el.style.setProperty("--scene-y", (y * 20).toFixed(2) + "px");
      el.style.setProperty("--scene-x-reverse", (x * -14).toFixed(2) + "px");
      el.style.setProperty("--scene-y-reverse", (y * -12).toFixed(2) + "px");
      el.style.setProperty("--light-x", ((x + .5) * 100).toFixed(1) + "%");
      el.style.setProperty("--light-y", ((y + .5) * 100).toFixed(1) + "%");
    });
  };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    for (const property of ["--scene-x", "--scene-y", "--scene-x-reverse", "--scene-y-reverse"]) {
      el.style.setProperty(property, "0px");
    }
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div ref={ref} className={"parallax-scene " + className}
      onPointerMove={update} onPointerLeave={reset}>
      {children}
    </div>
  );
}

export function TiltCard({
  children,
  className = "",
  style
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || hasReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--tilt-x", ((.5 - y) * 9).toFixed(2) + "deg");
      el.style.setProperty("--tilt-y", ((x - .5) * 9).toFixed(2) + "deg");
      el.style.setProperty("--glow-x", (x * 100).toFixed(1) + "%");
      el.style.setProperty("--glow-y", (y * 100).toFixed(1) + "%");
    });
  };
  const reset = () => {
    cancelAnimationFrame(frame.current);
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div ref={ref} onPointerMove={handlePointerMove} onPointerLeave={reset}
      className={"tilt-card " + className} style={style}>
      {children}
    </div>
  );
}
