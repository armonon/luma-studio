"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

const showcaseModes = [
  {
    name: "Photo",
    eyebrow: "RAW DEVELOP",
    title: "Every photon, still yours.",
    copy: "Decode DNG straight off the sensor — Bayer demosaic, camera matrices and highlight recovery into a floating-point master.",
    metric: "32-bit",
    metricLabel: "float DNG master",
    accent: "#f06d3b",
  },
  {
    name: "Retouch",
    eyebrow: "ON-DEVICE MATTING",
    title: "Retouch meaning, not pixels.",
    copy: "Subject matting runs in your browser. Point at what you want and it becomes a mask you can paint, invert and refine.",
    metric: "0",
    metricLabel: "uploads — matting is local",
    accent: "#7c5ce7",
  },
  {
    name: "Design",
    eyebrow: "PIXEL + VECTOR",
    title: "One canvas. No boundaries.",
    copy: "Mix typography, bezier paths, shapes and high-resolution raster layers without changing applications.",
    metric: "27",
    metricLabel: "spec-exact blend modes",
    accent: "#2385f4",
  },
  {
    name: "AI",
    eyebrow: "NEURAL LAB",
    title: "Intelligence you can edit.",
    copy: "Every result arrives as an editable mask or layer — never a flattened answer you have to accept or discard.",
    metric: "2",
    metricLabel: "on-device models",
    accent: "#9a4ce1",
  },
] as const;

const bentoFeatures = [
  {
    className: "bento-large bento-tools",
    kicker: "EVERY TOOL",
    title: "Power when you reach for it.",
    copy: "Selection, masking, retouching, paint, vectors, typography, transforms and measurement—organized around how you think.",
  },
  {
    className: "bento-command",
    kicker: "⌘ K",
    title: "Thought to action.",
    copy: "Find any tool, filter or command before the menu can slow you down.",
  },
  {
    className: "bento-scene",
    kicker: "CLICK TO SELECT",
    title: "Point at what you mean.",
    copy: "Click a subject and segmentation turns it into an editable mask. Shift to add, option to subtract.",
  },
  {
    className: "bento-history",
    kicker: "BRANCHING HISTORY",
    title: "Explore without fear.",
    copy: "Undo never throws work away — step back, take a different path, and the old branch is still there.",
  },
] as const;

// Mirrors AiEditOperation in app/engine/ai-edit.ts. Keep these in sync — every
// entry here must be an operation the engine can actually dispatch.
const neuralActions = [
  ["✦", "Generative fill"],
  ["↔", "Expand"],
  ["⌫", "Remove"],
  ["◐", "Relight"],
  ["◑", "Harmonize"],
  ["↑", "Upscale"],
] as const;

export default function MarketingHome() {
  const [activeMode, setActiveMode] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const heroProduct = useRef<HTMLDivElement>(null);
  const currentMode = showcaseModes[activeMode];

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const moveProduct = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!heroProduct.current) return;
    const rect = heroProduct.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    heroProduct.current.style.setProperty("--rx", `${-y * 3.5}deg`);
    heroProduct.current.style.setProperty("--ry", `${x * 5}deg`);
  };

  const resetProduct = () => {
    heroProduct.current?.style.setProperty("--rx", "0deg");
    heroProduct.current?.style.setProperty("--ry", "0deg");
  };

  return (
    <main className="marketing-page">
      <div
        className="scroll-progress"
        style={{ transform: `scaleX(${scrollProgress})` }}
      />

      <nav className="marketing-nav">
        <a className="marketing-brand" href="#top" aria-label="Luma Studio home">
          <span>L</span>
          <strong>Luma Studio</strong>
        </a>
        <div className={`marketing-links ${mobileMenu ? "open" : ""}`}>
          <a href="#product" onClick={() => setMobileMenu(false)}>Product</a>
          <a href="#intelligence" onClick={() => setMobileMenu(false)}>Neural Lab</a>
          <a href="#performance" onClick={() => setMobileMenu(false)}>Performance</a>
          <a href="#creators" onClick={() => setMobileMenu(false)}>For creators</a>
        </div>
        <div className="marketing-nav-actions">
          <a className="nav-studio-link" href="/studio">
            Open Studio <span>↗</span>
          </a>
          <button
            className="mobile-menu-button"
            onClick={() => setMobileMenu((value) => !value)}
            aria-label="Toggle navigation"
          >
            {mobileMenu ? "×" : "☰"}
          </button>
        </div>
      </nav>

      <section className="marketing-hero" id="top">
        <div className="hero-aurora aurora-one" />
        <div className="hero-aurora aurora-two" />
        <div className="hero-copy reveal">
          <p className="hero-eyebrow"><span>✦</span> THE CREATIVE STUDIO, REBUILT</p>
          <h1>Make anything.<br /><em>Stay in flow.</em></h1>
          <p className="hero-lede">
            The depth of a professional image editor, reimagined around speed,
            clarity and creative intelligence.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href="/studio">
              Try the live studio <span>→</span>
            </a>
            <a className="secondary-cta" href="#product">
              See what’s inside <span>↓</span>
            </a>
          </div>
          <div className="hero-note">
            <span className="pulse-dot" />
            Interactive web preview · No download
          </div>
        </div>

        <div
          className="hero-product-wrap reveal"
          onMouseMove={moveProduct}
          onMouseLeave={resetProduct}
        >
          <div className="hero-product-glow" />
          <div className="hero-product" ref={heroProduct}>
            <div className="product-window-bar">
              <div><i /><i /><i /></div>
              <span>Desert_Dreams.luma</span>
              <b>LIVE PRODUCT</b>
            </div>
            <div className="studio-embed">
              <iframe
                src="/studio"
                title="Live Luma Studio editor preview"
                tabIndex={-1}
              />
            </div>
          </div>
          <p>Move your pointer across the studio</p>
        </div>
      </section>

      <div className="capability-marquee" aria-label="Supported capabilities">
        <div>
          {[
            "RAW",
            "PSD",
            "Display P3",
            "Smart Objects",
            "Vector",
            "32-bit color",
            "Live masks",
            "CMYK",
            "AI layers",
            "RAW",
            "PSD",
            "Display P3",
            "Smart Objects",
            "Vector",
          ].map((item, index) => (
            <span key={`${item}-${index}`}><i />{item}</span>
          ))}
        </div>
      </div>

      <section className="product-intro" id="product">
        <div className="section-heading reveal">
          <p>DESIGNED FOR CREATIVE MOMENTUM</p>
          <h2>Everything you expect.<br /><span>Nothing in your way.</span></h2>
          <p>
            Luma carries the complete grammar of professional image editing, then
            removes the friction that made it feel complicated.
          </p>
        </div>

        <div className="bento-grid">
          {bentoFeatures.map((feature, index) => (
            <article
              key={feature.title}
              className={`bento-card ${feature.className} reveal`}
              style={{ transitionDelay: `${index * 70}ms` }}
            >
              <div className="bento-copy">
                <span>{feature.kicker}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
              {feature.className.includes("tools") && (
                <div className="tool-cloud" aria-hidden="true">
                  {["⌖", "╱", "T", "⌗", "✣", "◩", "⌁", "↖", "⌃"].map(
                    (tool, toolIndex) => (
                      <i key={toolIndex}>{tool}</i>
                    ),
                  )}
                </div>
              )}
              {feature.className.includes("command") && (
                <div className="mini-command" aria-hidden="true">
                  <div><span>⌕</span> Find any tool… <kbd>⌘K</kbd></div>
                  <p><i>✦</i> Generative expand <b>↵</b></p>
                  <p><i>⌘</i> Select subject <b>W</b></p>
                </div>
              )}
              {feature.className.includes("scene") && (
                <div className="scene-orbit" aria-hidden="true">
                  <span className="scene-core">IMAGE</span>
                  <i className="orbit-sky">Sky</i>
                  <i className="orbit-light">Light</i>
                  <i className="orbit-subject">Subject</i>
                </div>
              )}
              {feature.className.includes("history") && (
                <div className="history-branches" aria-hidden="true">
                  <span>Original</span><i />
                  <span>Warm grade</span><i />
                  <span>Cool grade</span>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="medium-section">
        <div className="medium-sticky">
          <div className="medium-heading reveal">
            <p>ONE MEDIUM</p>
            <h2>Pixels, vectors,<br />intelligence.</h2>
          </div>
          <div className="mode-showcase reveal">
            <div className="mode-tabs" role="tablist" aria-label="Creative modes">
              {showcaseModes.map((mode, index) => (
                <button
                  key={mode.name}
                  className={activeMode === index ? "active" : ""}
                  onClick={() => setActiveMode(index)}
                  role="tab"
                  aria-selected={activeMode === index}
                >
                  <span>0{index + 1}</span>
                  {mode.name}
                </button>
              ))}
            </div>
            <div
              className="mode-card"
              style={{ "--mode-accent": currentMode.accent } as React.CSSProperties}
            >
              <div className="mode-copy" key={currentMode.name}>
                <span>{currentMode.eyebrow}</span>
                <h3>{currentMode.title}</h3>
                <p>{currentMode.copy}</p>
                <div className="mode-metric">
                  <strong>{currentMode.metric}</strong>
                  <small>{currentMode.metricLabel}</small>
                </div>
              </div>
              <div className={`mode-visual mode-${currentMode.name.toLowerCase()}`}>
                <div className="mode-canvas">
                  <Image
                    src="/desert.jpg"
                    alt=""
                    width={2200}
                    height={1467}
                    sizes="(max-width: 900px) 100vw, 55vw"
                  />
                  <div className="mode-overlay" />
                  <span className="mode-selection" />
                </div>
                <div className="mode-panel">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="neural-showcase" id="intelligence">
        <div className="neural-aura" />
        <div className="neural-mark reveal">✦</div>
        <div className="neural-title reveal">
          <p>NEURAL LAB</p>
          <h2>Describe the result.<br /><span>Keep every decision.</span></h2>
          <p>
            Creative intelligence built around the way professionals work:
            transparent, controllable and always nondestructive.
          </p>
        </div>
        <div className="neural-product reveal">
          <div className="neural-image">
            <Image
              src="/desert.jpg"
              alt="Desert image with AI depth mapping"
              width={2200}
              height={1467}
              sizes="(max-width: 900px) 100vw, 70vw"
            />
            <span className="depth-tag sky-tag">Sky · 0.9</span>
            <span className="depth-tag dune-tag">Dunes · 0.6</span>
            <span className="depth-tag foreground-tag">Foreground · 0.2</span>
          </div>
          <div className="neural-action-grid">
            {neuralActions.map(([icon, label], index) => (
              <button key={label}>
                <span>{icon}</span>
                <strong>{label}</strong>
                <small>{index % 2 === 0 ? "Creates live layers" : "Scene-aware"}</small>
                <b>›</b>
              </button>
            ))}
          </div>
          <div className="neural-prompt">
            <span>✦</span>
            <p>Extend the sunset beyond the canvas…</p>
            <button>Generate</button>
          </div>
        </div>
      </section>

      <section className="performance-section" id="performance">
        <div className="performance-orb" />
        <div className="performance-copy reveal">
          <p>LOCAL-FIRST IMAGE ENGINE</p>
          <h2>Precision you can<br /><span>build upon.</span></h2>
          <p>
            Tiled rendering keeps viewport work bounded while 32-bit float tile
            masters preserve edit precision. Luma Pro’s native engine is being
            integrated for desktop-scale documents.
          </p>
          <a href="/studio">Feel it in the live studio <span>→</span></a>
        </div>
        <div className="performance-stats">
          <article className="reveal">
            <strong>27</strong>
            <p>verified blend modes</p>
          </article>
          <article className="reveal">
            <strong>32</strong><span>-bit</span>
            <p>float tile masters</p>
          </article>
          <article className="reveal">
            <strong>2</strong>
            <p>on-device semantic models</p>
          </article>
          <article className="reveal">
            <strong>80</strong>
            <p>bounded recovery nodes</p>
          </article>
        </div>
      </section>

      <section className="creator-section" id="creators">
        <div className="creator-heading reveal">
          <p>FOR PEOPLE WHO MAKE</p>
          <h2>One studio.<br />Every kind of imagination.</h2>
        </div>
        <div className="creator-cards">
          {[
            ["PHOTOGRAPHERS", "Develop, grade and retouch without leaving the light."],
            ["DESIGNERS", "Compose pixels, paths and type in the same visual language."],
            ["ARTISTS", "Paint, generate and experiment with every idea still editable."],
          ].map(([label, copy], index) => (
            <article className="reveal" key={label}>
              <span>0{index + 1}</span>
              <h3>{label}</h3>
              <p>{copy}</p>
              <i>↗</i>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div className="final-glow" />
        <div className="reveal">
          <span className="final-mark">L</span>
          <p>LUMA STUDIO</p>
          <h2>Your best work<br />is still ahead.</h2>
          <a href="/studio">Open the live studio <span>→</span></a>
          <small>Interactive preview · Built for the future of creative work</small>
        </div>
      </section>

      <footer className="marketing-footer">
        <a className="marketing-brand" href="#top">
          <span>L</span><strong>Luma Studio</strong>
        </a>
        <p>Creative imaging, reimagined.</p>
        <div>
          <a href="#product">Product</a>
          <a href="#intelligence">Neural Lab</a>
          <a href="/studio">Live Studio</a>
        </div>
        <small>© 2026 Luma Studio. Preview concept.</small>
      </footer>
    </main>
  );
}
