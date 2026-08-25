"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

const showcaseModes = [
  {
    name: "Focus",
    eyebrow: "LAYER FOCUS",
    title: "Complex files. Clear head.",
    copy: "Enter any layer, group or smart object and Luma rebuilds the workspace around it—while the full composition stays one step away.",
    metric: "1 click",
    metricLabel: "from project to working context",
    accent: "#7656ef",
    image: "/desert.jpg",
    imageAlt: "Saturated orange desert dunes inside the Layer Focus workflow",
  },
  {
    name: "Blend",
    eyebrow: "MULTI-PASS COMPOSITING",
    title: "One layer. More than one mood.",
    copy: "Stack independent blend modes and opacity passes on a single layer, reorder them live, then shape the result with per-channel Blend If.",
    metric: "8×",
    metricLabel: "blend passes on every layer",
    accent: "#2385f4",
    image: "/film-sun.jpg",
    imageAlt: "Mountain lake photograph being refined with multi-pass blending",
  },
  {
    name: "Paint",
    eyebrow: "CAPTURE BRUSH",
    title: "If you can see it, you can paint with it.",
    copy: "Sample a live region from any image, tune its radius and color behavior, then paint with that image as a reusable document brush.",
    metric: "1",
    metricLabel: "sample becomes a living brush",
    accent: "#f06d3b",
    image: "/film-lake.jpg",
    imageAlt: "Turquoise alpine lake used as a source for a captured image brush",
  },
  {
    name: "Develop",
    eyebrow: "FLOATING-POINT DNG",
    title: "The sensor stays underneath.",
    copy: "Develop DNG sensor data with editable exposure, white balance, highlight recovery, lens correction and local adjustments.",
    metric: "32-bit",
    metricLabel: "floating-point tile master",
    accent: "#47a56b",
    image: "/film-mountain.jpg",
    imageAlt: "Mountain landscape preserved in a floating-point develop workflow",
  },
] as const;

const bentoFeatures = [
  {
    className: "bento-large bento-focus",
    kicker: "LAYER FOCUS",
    title: "Work on what matters. Keep the whole idea.",
    copy: "Pin a working set, move between parent groups with breadcrumbs and isolate the active layer without hiding the composition from yourself.",
  },
  {
    className: "bento-blend",
    kicker: "8 PASSES · 27 MODES",
    title: "Compositing without duplicate layers.",
    copy: "Mix Screen, Color, Soft Light and more on one layer, each with its own opacity and order.",
  },
  {
    className: "bento-brush",
    kicker: "CAPTURE BRUSH",
    title: "Paint with the world in front of you.",
    copy: "Sample texture, foliage, fabric or light from a photograph and turn it into a pressure-aware brush.",
  },
  {
    className: "bento-history",
    kicker: "BRANCHING HISTORY",
    title: "Explore without fear.",
    copy: "Undo never throws work away — step back, take a different path, and the old branch is still there.",
  },
] as const;

// The third tuple field is the actual AiEditOperation. Display labels may be
// more precise than legacy operation ids (for example, current Expand fills
// context inside the same canvas rather than resizing it).
const neuralActions = [
  ["✦", "Generative fill", "fill"],
  ["↔", "Context fill", "expand"],
  ["⌫", "Remove", "remove"],
  ["◐", "Relight", "relight"],
  ["◑", "Harmonize", "harmonize"],
  ["↑", "Detail synthesis", "upscale"],
] as const;

const creatorProfiles = [
  {
    label: "PHOTOGRAPHERS",
    copy: "Develop DNG, soft-proof color, retouch locally and preserve the original sensor data.",
    image: "/film-sun.jpg",
    alt: "A still mountain lake at first light",
    badge: "RAW · P3 · 32-BIT",
  },
  {
    label: "DESIGNERS",
    copy: "Compose with artboards, smart objects, masks, type and PSD-aware export preflight.",
    image: "/desert.jpg",
    alt: "Sculptural orange desert dunes",
    badge: "PSD · PSB · ARTBOARDS",
  },
  {
    label: "ARTISTS",
    copy: "Capture brushes from images, paint with pressure and branch history without losing an idea.",
    image: "/film-wave.jpg",
    alt: "A pastel shoreline at sunset",
    badge: "BRUSHES · MASKS · HISTORY",
  },
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
          <a href="#product" onClick={() => setMobileMenu(false)}>Why Luma</a>
          <a href="#workflow" onClick={() => setMobileMenu(false)}>Workflows</a>
          <a href="#intelligence" onClick={() => setMobileMenu(false)}>Neural Lab</a>
          <a href="#performance" onClick={() => setMobileMenu(false)}>Performance</a>
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
          <p className="hero-eyebrow"><span>✦</span> PROFESSIONAL IMAGE EDITING, REFOCUSED</p>
          <h1>Complex canvas.<br /><em>Clear workspace.</em></h1>
          <p className="hero-lede">
            Luma Studio combines precision photo editing, compositing, painting
            and editable AI with a workspace that follows your attention.
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
            Live web studio · Native macOS build
          </div>
          <div className="hero-proof-strip" aria-label="Product highlights">
            <span><b>✦</b> Layer Focus</span>
            <span><b>17</b> layer effects</span>
            <span><b>8×</b> blend passes</span>
            <span><b>32</b>-bit tiles</span>
            <span><b>↗</b> PSD + PSB</span>
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
            "PSD + PSB",
            "Display P3",
            "Layer Focus",
            "Multi-pass blending",
            "Layer styles",
            "32-bit color",
            "Branching history",
            "Editable AI layers",
            "Capture brushes",
            "DNG develop",
            "Smart Objects",
            "Display P3",
            "Live masks",
            "Layer Focus",
          ].map((item, index) => (
            <span key={`${item}-${index}`}><i />{item}</span>
          ))}
        </div>
      </div>

      <section className="product-intro" id="product">
        <div className="section-heading reveal">
          <p>THE LUMA DIFFERENCE</p>
          <h2>Less interface.<br /><span>More creative control.</span></h2>
          <p>
            The strongest tools are not hidden. They are reorganized around the
            layer, object and decision you are making right now.
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
              {feature.className.includes("focus") && (
                <div className="focus-demo" aria-hidden="true">
                  <div className="focus-demo-bar"><span>FOCUS</span><b>Campaign / Product</b><i>⌄</i></div>
                  <div className="focus-demo-canvas">
                    <Image src="/desert.jpg" alt="" width={2200} height={1467} sizes="500px" />
                    <span>Product hero</span>
                  </div>
                  <div className="focus-demo-stack">
                    <span className="active"><i>◈</i><b>Product hero</b><small>smart object</small></span>
                    <span><i>◐</i><b>Warm light</b><small>adjustment</small></span>
                    <span><i>▨</i><b>Texture</b><small>paint layer</small></span>
                  </div>
                </div>
              )}
              {feature.className.includes("blend") && (
                <div className="blend-demo" aria-hidden="true">
                  <div><span>01</span><b>Soft Light</b><small>62%</small></div>
                  <div><span>02</span><b>Color</b><small>34%</small></div>
                  <div><span>03</span><b>Screen</b><small>18%</small></div>
                  <p><i /> Blend If · Gray</p>
                </div>
              )}
              {feature.className.includes("brush") && (
                <div className="brush-demo" aria-hidden="true">
                  <Image src="/film-lake.jpg" alt="" width={1600} height={1067} sizes="360px" />
                  <span className="brush-sample-ring"><i /></span>
                  <div><b>Lake light</b><small>Sampled · 84 px</small></div>
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

      <section className="medium-section" id="workflow">
        <div className="medium-sticky">
          <div className="medium-heading reveal">
            <p>ONE STUDIO · FOUR BREAKTHROUGHS</p>
            <h2>Follow the idea,<br />not the interface.</h2>
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
                    key={currentMode.image}
                    src={currentMode.image}
                    alt={currentMode.imageAlt}
                    width={900}
                    height={600}
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
          <p>NEURAL LAB · EDITABLE BY DESIGN</p>
          <h2>Ask for the result.<br /><span>Keep control of the image.</span></h2>
          <p>
            Generate, remove, relight or harmonize. Every variation arrives on
            its own layer with provenance and mask guidance—not baked into the original.
          </p>
        </div>
        <div className="neural-product reveal">
          <div className="neural-image">
            <Image
              src="/film-wave.jpg"
              alt="Pastel shoreline separated into editable scene-aware depth regions"
              width={900}
              height={598}
              sizes="(max-width: 900px) 100vw, 70vw"
            />
            <span className="depth-tag sky-tag">Sky · 0.9</span>
            <span className="depth-tag dune-tag">Water · 0.6</span>
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
            <p>Relight the shoreline after sunset…</p>
            <button>Generate</button>
          </div>
        </div>
      </section>

      <section className="performance-section" id="performance">
        <div className="performance-orb" />
        <div className="performance-copy reveal">
          <p>PRECISION UNDERNEATH · SPEED ON TOP</p>
          <h2>A lightweight studio<br /><span>with a serious engine.</span></h2>
          <p>
            Dirty-region rendering updates only what changed. Viewport paint and
            precision layers use sparse tiles, while oversized operations fail
            safely instead of exhausting memory. Float masters preserve working
            precision, and desktop exports can flatten through a multi-threaded
            native compositor.
          </p>
          <a href="/studio">Feel it in the live studio <span>→</span></a>
        </div>
        <div className="performance-stats">
          <article className="reveal">
            <strong>27</strong>
            <p>Photoshop-class blend modes</p>
          </article>
          <article className="reveal">
            <strong>17</strong>
            <p>non-destructive layer effects</p>
          </article>
          <article className="reveal">
            <strong>8</strong><span>×</span>
            <p>passes on a single layer</p>
          </article>
          <article className="reveal">
            <strong>32</strong><span>-bit</span>
            <p>floating-point tile masters</p>
          </article>
          <article className="reveal">
            <strong>80</strong>
            <p>recoverable history nodes</p>
          </article>
        </div>
      </section>

      <section className="creator-section" id="creators">
        <div className="creator-heading reveal">
          <p>BUILT AROUND REAL WORK</p>
          <h2>From first frame<br />to final delivery.</h2>
        </div>
        <div className="creator-cards">
          {creatorProfiles.map((profile, index) => (
            <article className="reveal" key={profile.label}>
              <div className="creator-image">
                <Image
                  src={profile.image}
                  alt={profile.alt}
                  width={900}
                  height={600}
                  sizes="(max-width: 900px) 100vw, 33vw"
                />
                <span>{profile.badge}</span>
              </div>
              <div className="creator-card-copy">
                <small>0{index + 1}</small>
                <h3>{profile.label}</h3>
                <p>{profile.copy}</p>
              </div>
              <i aria-hidden="true">↗</i>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div className="final-glow" />
        <div className="reveal">
          <span className="final-mark">L</span>
          <p>LUMA STUDIO</p>
          <h2>Stay with the image.<br />Luma handles the complexity.</h2>
          <a href="/studio">Create in Luma <span>→</span></a>
          <small>Live web studio · Native macOS application</small>
        </div>
      </section>

      <footer className="marketing-footer">
        <a className="marketing-brand" href="#top">
          <span>L</span><strong>Luma Studio</strong>
        </a>
        <p>Professional imaging, focused.</p>
        <div>
          <a href="#product">Product</a>
          <a href="#intelligence">Neural Lab</a>
          <a href="/studio">Live Studio</a>
        </div>
        <small>© 2026 Luma Studio. Professional imaging, focused.</small>
      </footer>
    </main>
  );
}
