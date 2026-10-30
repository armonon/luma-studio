/** Local opt-in browser profiling. No telemetry; timings are not physical input latency. */
type Phase = { name: string; ms: number };
const noPhase = () => {};
let phaseSink: ((phase: Phase) => void) | null = null;
export function beginDrawingPhase(name: string) {
  const sink = phaseSink;
  if (!sink) return noPhase;
  const start = performance.now();
  return () => { if (phaseSink === sink) sink({ name, ms: performance.now() - start }); };
}
export function timingDistribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => Number((sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0).toFixed(2));
  return { count: values.length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: q(1), over17ms: values.filter(n => n > 17).length, over50ms: values.filter(n => n > 50).length };
}
export function mountDrawingDiagnostics(doc: Document, selector: string) {
  const win = doc.defaultView!;
  const panel = doc.createElement('section');
  panel.setAttribute('aria-label', 'Local drawing profiler');
  panel.style.cssText = 'position:fixed;left:8px;bottom:36px;z-index:99999;max-width:94vw;background:#111;color:#fff;padding:6px;font:11px monospace';
  const startButton = doc.createElement('button'); startButton.textContent = 'Start performance capture';
  const stopButton = doc.createElement('button'); stopButton.textContent = 'Stop performance capture';
  const label = doc.createElement('input'); label.setAttribute('aria-label', 'Performance scene label'); label.placeholder = 'Scene / operation';
  const output = doc.createElement('output'); output.setAttribute('aria-label', 'Drawing frame diagnostics');
  output.style.cssText = 'display:block;max-width:94vw;max-height:100px;overflow:auto;white-space:pre-wrap;pointer-events:auto';
  panel.appendChild(label); panel.appendChild(startButton); panel.appendChild(stopButton); panel.appendChild(output); doc.body.appendChild(panel);
  let frames: number[] = [], phases: Phase[] = [], longTasks: number[] = [], last = 0, frame = 0, events = 0, samples = 0, active: number | null = null, gestures = 0;
  let longFrames: Record<string, unknown>[] = [];
  let recording = false, manual = false, started = 0, elapsed = 0, hidden = 0, truncated = false;
  const limit = 100000;
  const append = <T,>(list: T[], item: T) => { if (list.length < limit) list.push(item); else truncated = true; };
  const report = () => {
    const byPhase: Record<string, ReturnType<typeof timingDistribution>> = {};
    for (const name of new Set(phases.map(v => v.name))) byPhase[name] = timingDistribution(phases.filter(v => v.name === name).map(v => v.ms));
    output.textContent = JSON.stringify({ scene: label.value, recording, manual, elapsedMs: Math.round(elapsed), gestures, events, samples, frames: timingDistribution(frames), phases: byPhase, longTasks: timingDistribution(longTasks), longFrames, hidden, truncated, width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio, visibility: doc.visibilityState, browser: win.navigator.userAgent, logicalCpus: win.navigator.hardwareConcurrency });
  };
  const tick = (time: number) => { if (!recording) return; if (last) append(frames, time - last); last = time; frame = win.requestAnimationFrame(tick); };
  const begin = (isManual: boolean) => { win.cancelAnimationFrame(frame); frames = []; phases = []; longTasks = []; longFrames = []; events = 0; samples = 0; gestures = 0; hidden = 0; truncated = false; elapsed = 0; manual = isManual; recording = true; started = win.performance.now(); last = 0; phaseSink = phase => { if (recording) append(phases, phase); }; frame = win.requestAnimationFrame(tick); report(); };
  const end = () => { if (!recording) return; elapsed = win.performance.now() - started; recording = false; win.cancelAnimationFrame(frame); phaseSink = null; report(); };
  const eventStarts = new WeakMap<Event, number>();
  const down = (e: PointerEvent) => { if (!(e.target instanceof win.Element) || !e.target.matches(selector) || active !== null) return; if (!manual) begin(false); active = e.pointerId; gestures++; eventStarts.set(e, win.performance.now()); };
  const move = (e: PointerEvent) => { if (!recording || !(e.target instanceof win.Element) || !e.target.matches(selector)) return; eventStarts.set(e, win.performance.now()); events++; let count = 1; try { count = Math.max(1, e.getCoalescedEvents?.().length ?? 1); } catch { /* Ordinary event is still measured. */ } samples += count; };
  const up = (e: PointerEvent) => { if (active !== e.pointerId) return; eventStarts.set(e, win.performance.now()); active = null; };
  const bubble = (e: Event) => { const start = eventStarts.get(e); if (recording && start !== undefined) append(phases, { name: e.type, ms: win.performance.now() - start }); if (!manual && active === null && (e.type === 'pointerup' || e.type === 'pointercancel')) end(); };
  const wheel = (e: WheelEvent) => { if (recording && e.target instanceof win.Element && e.target.matches(selector)) eventStarts.set(e, win.performance.now()); };
  const visibility = () => { if (recording && doc.visibilityState !== 'visible') hidden++; };
  let observer: PerformanceObserver | undefined;
  try { observer = new win.PerformanceObserver(entries => { if (recording) for (const entry of entries.getEntries()) if (entry.startTime >= started) append(longTasks, entry.duration); }); observer.observe({ type: 'longtask' }); } catch { /* Unsupported long-task API; frame and phase timings remain available. */ }
  let loafObserver: PerformanceObserver | undefined;
  try {
    loafObserver = new win.PerformanceObserver(entries => {
      if (!recording) return;
      for (const entry of entries.getEntries()) {
        if (entry.startTime < started) continue;
        const value = entry as PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; blockingDuration: number; scripts: { duration: number; invoker: string; sourceURL: string; sourceFunctionName: string; forcedStyleAndLayoutDuration: number }[] };
        longFrames.push({ duration: value.duration, blockingDuration: value.blockingDuration, renderMs: value.renderStart ? value.startTime + value.duration - value.renderStart : 0, styleLayoutMs: value.styleAndLayoutStart ? value.startTime + value.duration - value.styleAndLayoutStart : 0, scripts: value.scripts.map(script => ({ ms: script.duration, invoker: script.invoker, source: script.sourceURL, function: script.sourceFunctionName, forcedLayoutMs: script.forcedStyleAndLayoutDuration })) });
      }
      longFrames.sort((a, b) => Number(b.duration) - Number(a.duration)); longFrames = longFrames.slice(0, 8);
    });
    loafObserver.observe({ type: 'long-animation-frame' });
  } catch { /* Browser-specific attribution is supplementary. */ }
  startButton.onclick = () => begin(true); stopButton.onclick = end;
  doc.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('pointercancel', up, true); doc.addEventListener('wheel', wheel, true);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) doc.addEventListener(type, bubble);
  doc.addEventListener('visibilitychange', visibility); report();
  return () => { win.cancelAnimationFrame(frame); observer?.disconnect(); loafObserver?.disconnect(); phaseSink = null; panel.remove(); doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', up, true); doc.removeEventListener('wheel', wheel, true); for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) doc.removeEventListener(type, bubble); doc.removeEventListener('visibilitychange', visibility); };
}
