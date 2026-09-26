import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PanelErrorBoundary } from "../app/studio/panel-error-boundary.tsx";

test("failed optional panels offer a non-reloading fallback while healthy panels render normally", () => {
  const panel = new PanelErrorBoundary({ title: "Type & shape", children: createElement("span", null, "editor") });
  assert.equal(renderToStaticMarkup(panel.render()), "<span>editor</span>");
  panel.state = PanelErrorBoundary.getDerivedStateFromError();
  const html = renderToStaticMarkup(panel.render());
  assert.match(html, /role="alert"/);
  assert.match(html, /Save your project before reloading/);
  assert.match(html, /Try panel again/);
  assert.doesNotMatch(html, /<span>editor<\/span>/);
});

test("dock content is isolated below the document shell, not around the whole application", () => {
  const dock = readFileSync(new URL("../app/studio/dock-manager.tsx", import.meta.url), "utf8");
  assert.match(dock, /<PanelErrorBoundary[\s\S]*<Component>[\s\S]*<\/Component>[\s\S]*<\/PanelErrorBoundary>/);
  const boundary = readFileSync(new URL("../app/studio/panel-error-boundary.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(boundary, /location\.reload|resetDocument|importProject|setInterval/);
});
