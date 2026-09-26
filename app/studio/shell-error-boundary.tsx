"use client";
import { Component, type ReactNode } from "react";

/** Keep the Studio owner and canvas mounted when optional shell chunks fail. */
export class ShellErrorBoundary extends Component<{
  title: string;
  region?: "bar" | "rail" | "dialog";
  onSave?: () => void;
  onDismiss?: () => void;
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Luma shell region failed", this.props.title, error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert" className={`shell-region-error shell-region-error-${this.props.region ?? "bar"}`}>
      <strong>{this.props.title} unavailable</strong>
      <span>Your document remains open. Save before restarting.</span>
      <div>
        {this.props.onSave && <button type="button" onClick={this.props.onSave}>Save project</button>}
        {this.props.onDismiss && <button type="button" onClick={this.props.onDismiss}>Close</button>}
      </div>
    </section>;
  }
}
