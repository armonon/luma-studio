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
      if (event.target instanceof Node && !menu.current?.contains(event.target)) menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div className="creatingco-space-navigation" aria-label="Creative workspaces">
      <div className="creatingco-space-switcher" role="group" aria-label="Choose a workspace">
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
        if (!menu.current?.open) return;
        // Keep editor shortcuts from firing while navigating these actions.
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          menu.current.removeAttribute("open");
          menu.current.querySelector("summary")?.focus();
        }
      }} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.removeAttribute("open");
        }
      }}>
        <summary aria-label={`${active.label} shortcuts`} title={`${active.label} shortcuts`}><ChevronDown size={14} aria-hidden="true" /></summary>
        <div className="creatingco-space-menu-content">
          <div className="creatingco-menu-heading"><strong>{active.label}</strong><small>{active.subtitle}</small></div>
          {active.actions.map(action => (
            <button key={action} type="button" onClick={() => {
              menu.current?.removeAttribute("open");
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
