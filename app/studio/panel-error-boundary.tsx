"use client";
import { Component, type ReactNode } from "react";

/** Isolate optional editors from the canvas, document sessions and Save commands. */
export class PanelErrorBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Luma panel failed", this.props.title, error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" className="dock-panel-empty">
      <strong>{this.props.title} could not load</strong>
      <span>The canvas and document remain open. Save your project before reloading or restarting Luma.</span>
      <button type="button" onClick={() => this.setState({ failed: false })}>Try panel again</button>
      <small>If an update removed an older application file, retry may require a restart after saving.</small>
    </section>;
  }
}
