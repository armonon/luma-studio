import type { DisplayViewport } from "./viewport";

export type RenderWorkload = "interactive" | "navigation";

export type AdaptiveRenderGovernorOptions = {
  interactiveTargetMs?: number;
  navigationTargetMs?: number;
  qualitySteps?: readonly number[];
  slowFramesToDownshift?: number;
  fastFramesToUpshift?: number;
};

const DEFAULT_QUALITY_STEPS = [1, 0.85, 0.7, 0.55] as const;

function positiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
  return value;
}

/**
 * Keeps pointer-driven work responsive on slower devices by temporarily
 * lowering only the viewport backing resolution. Document coordinates,
 * precision tiles, exports, and saved pixels are never changed.
 */
export class AdaptiveRenderGovernor {
  private readonly interactiveTargetMs: number;
  private readonly navigationTargetMs: number;
  private readonly qualitySteps: readonly number[];
  private readonly slowFramesToDownshift: number;
  private readonly fastFramesToUpshift: number;
  private qualityIndex = 0;
  private slowFrames = 0;
  private fastFrames = 0;
  private downshifts = 0;
  private upshifts = 0;
  private lastDurationMs = 0;
  private lastWorkload: RenderWorkload = "navigation";

  constructor(options: AdaptiveRenderGovernorOptions = {}) {
    this.interactiveTargetMs = positiveFinite(options.interactiveTargetMs ?? 16.7, "interactiveTargetMs");
    this.navigationTargetMs = positiveFinite(options.navigationTargetMs ?? 33.3, "navigationTargetMs");
    this.slowFramesToDownshift = Math.max(1, Math.round(options.slowFramesToDownshift ?? 2));
    this.fastFramesToUpshift = Math.max(1, Math.round(options.fastFramesToUpshift ?? 24));
    const steps = options.qualitySteps ?? DEFAULT_QUALITY_STEPS;
    if (!steps.length || steps[0] !== 1 || steps.some((step, index) =>
      !Number.isFinite(step) || step <= 0 || step > 1 || (index > 0 && step >= steps[index - 1]))) {
      throw new Error("qualitySteps must start at 1 and descend through positive finite values");
    }
    this.qualitySteps = [...steps];
  }

  get scale() { return this.qualitySteps[this.qualityIndex]; }

  apply(viewport: DisplayViewport): DisplayViewport {
    const scale = this.scale;
    if (scale === 1) return viewport;
    return {
      ...viewport,
      outputWidth: Math.max(1, Math.round(viewport.outputWidth * scale)),
      outputHeight: Math.max(1, Math.round(viewport.outputHeight * scale)),
      zoom: viewport.zoom * scale,
      devicePixelRatio: viewport.devicePixelRatio * scale,
    };
  }

  /** Returns true when the next frame should be redrawn at a new quality step. */
  record(durationMs: number, workload: RenderWorkload) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return false;
    const target = workload === "interactive" ? this.interactiveTargetMs : this.navigationTargetMs;
    this.lastDurationMs = durationMs;
    this.lastWorkload = workload;
    if (durationMs > target * 1.05) {
      this.slowFrames += 1;
      this.fastFrames = 0;
      if (this.slowFrames >= this.slowFramesToDownshift && this.qualityIndex < this.qualitySteps.length - 1) {
        this.qualityIndex += 1;
        this.slowFrames = 0;
        this.downshifts += 1;
        return true;
      }
      return false;
    }
    this.slowFrames = 0;
    if (durationMs < target * 0.62) this.fastFrames += 1;
    else this.fastFrames = 0;
    if (this.fastFrames >= this.fastFramesToUpshift && this.qualityIndex > 0) {
      this.qualityIndex -= 1;
      this.fastFrames = 0;
      this.upshifts += 1;
      return true;
    }
    return false;
  }

  /** Restore full-resolution preview after pointer activity becomes idle. */
  restoreFullQuality() {
    if (this.qualityIndex === 0) return false;
    this.qualityIndex = 0;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.upshifts += 1;
    return true;
  }

  stats() {
    return {
      scale: this.scale,
      qualityStep: this.qualityIndex,
      qualitySteps: [...this.qualitySteps],
      interactiveTargetMs: this.interactiveTargetMs,
      navigationTargetMs: this.navigationTargetMs,
      lastDurationMs: this.lastDurationMs,
      lastWorkload: this.lastWorkload,
      downshifts: this.downshifts,
      upshifts: this.upshifts,
    };
  }
}

