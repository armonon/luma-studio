import { normalizePlacement, type MockupPlacement, type MockupSceneId } from './mockup';
import { MOCKUP_SCENES } from './mockup-scenes';
export type MockupSceneState = { placement: MockupPlacement; color: string; ink: number };
export type MockupStates = Record<MockupSceneId, MockupSceneState>;
export function initialMockupStates(): MockupStates {
  return Object.fromEntries(MOCKUP_SCENES.map(s => [s.id, {placement: {...s.defaultPlacement}, color:s.defaultColor, ink:.94}])) as MockupStates;
}
export function readMockupProject(value: unknown): {scene: MockupSceneId; states: MockupStates; artwork: string} {
  if (!value || typeof value !== 'object') throw new Error('Choose a Mockups project.');
  const p = value as Record<string, unknown>;
  if (p.format !== 'luma-mockups' || p.version !== 1 || typeof p.artwork !== 'string' || !p.artwork.startsWith('data:image/png;base64,') || p.artwork.length > 32_000_000) throw new Error('This Mockups project is invalid or unsupported.');
  if (!p.states || typeof p.states !== 'object') throw new Error('Project settings are missing.');
  const states = initialMockupStates();
  for (const info of MOCKUP_SCENES) {
    const s = (p.states as Record<string, unknown>)[info.id];
    if (!s || typeof s !== 'object') throw new Error(`Settings for ${info.name} are missing.`);
    const v = s as Record<string, unknown>;
    if (typeof v.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(v.color) || typeof v.ink !== 'number' || !Number.isFinite(v.ink) || !v.placement || typeof v.placement !== 'object') throw new Error(`Settings for ${info.name} are invalid.`);
    states[info.id] = { color:v.color, ink:Math.max(.5,Math.min(1,v.ink)), placement:normalizePlacement(v.placement as Partial<MockupPlacement>, info.defaultPlacement) };
  }
  return {scene:MOCKUP_SCENES.some(s=>s.id===p.scene)?p.scene as MockupSceneId:'tshirt',states,artwork:p.artwork};
}
