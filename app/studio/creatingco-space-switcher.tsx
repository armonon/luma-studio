"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, MoonStar, SunMedium } from "lucide-react";
import {
  CREATIVE_ACTIONS, CREATIVE_SPACES,
  type CreativeSpace, type SpaceAction,
} from "./creatingco-spaces";

const ORDER: readonly CreativeSpace[] = ["photo", "design", "create"];

/** Accessible, real workspace navigation. Quick actions dispatch to native Luma features. */
export function CreativeSpaceSwitcher({
  value,
  onChange,
  onAction,
}: {
  value: CreativeSpace;
  onChange: (mode: CreativeSpace) => void;
  onAction: (action: SpaceAction) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const active = CREATIVE_SPACES[value];
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const details = menu.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        if (details.contains(document.activeElement)) details.querySelector("summary")?.focus({ preventScroll: true });
        details.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div className="creatingco-space-navigation" aria-label="Creative workspaces">
      <div className="creatingco-space-switcher" role="group" aria-label="Choose a workspace" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        {ORDER.map(space => (
          <button
            key={space}
            type="button"
            className={space === value ? "active" : ""}
            aria-pressed={space === value}
            title={CREATIVE_SPACES[space].subtitle}
            onClick={() => { menu.current?.removeAttribute("open"); onChange(space); }}
          >{CREATIVE_SPACES[space].label}</button>
        ))}
      </div>
      <details ref={menu} className="creatingco-space-menu" onKeyDown={event => {
        const details = menu.current;
        if (!details) return;
        const summary = details.querySelector("summary");
        if (event.target === summary) event.stopPropagation();
        const buttons = [...details.querySelectorAll<HTMLButtonElement>("button")];
        if (event.target === summary && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          details.open = true;
          (event.key === "ArrowDown" ? buttons[0] : buttons.at(-1))?.focus();
          return;
        }
        if (!details.open) return;
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          details.open = false;
          summary?.focus();
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.open = false;
        }
      }}>
        <summary aria-label={`${active.label} shortcuts`} aria-haspopup="menu" title={`${active.label} shortcuts`}><ChevronDown size={14} aria-hidden="true" /></summary>
        <div className="creatingco-space-menu-content" role="menu" aria-label={`${active.label} shortcuts`}>
          <div className="creatingco-menu-heading"><strong>{active.label}</strong><small>{active.subtitle}</small></div>
          {active.actions.map(action => (
            <button key={action} type="button" role="menuitem" onClick={() => {
              menu.current?.removeAttribute("open");
              menu.current?.querySelector("summary")?.focus({ preventScroll: true });
              onAction(action);
            }}>{CREATIVE_ACTIONS[action].label}</button>
          ))}
        </div>
      </details>
    </div>
  );
}

/** Appearance preference is persisted by SpatialStudio (not globally on the marketing site). */
export function CreativeAppearanceToggle({ value, onChange }: {
  value: "dark" | "light";
  onChange: (value: "dark" | "light") => void;
}) {
  return (
    <button
      type="button"
      className="studio-icon-button creatingco-appearance-toggle"
      title={value === "dark" ? "Use light appearance" : "Use dark appearance"}
      aria-label={value === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
      onClick={() => onChange(value === "dark" ? "light" : "dark")}
    >{value === "dark" ? <SunMedium size={17} aria-hidden="true" /> : <MoonStar size={17} aria-hidden="true" />}</button>
  );
}
