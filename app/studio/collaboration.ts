import type { SharedField } from '@momentium/live-review';
import type { Studio } from '../engine/studio';

export function lumaSharedFields(studio: Studio): SharedField[] {
  return studio.doc.layers.flatMap(layer => {
    const group = layer.name.slice(0, 120);
    const fields: SharedField[] = [
      { id: `${layer.id}:name`, group, label: 'Name', type: 'text', value: layer.name },
      { id: `${layer.id}:visible`, group, label: 'Visible', type: 'boolean', value: layer.visible },
    ];
    if (!studio.isLayerLocked(layer.id)) fields.push({ id: `${layer.id}:opacity`, group, label: 'Opacity', type: 'number', min: 0, max: 1, value: layer.opacity });
    return fields;
  });
}

export function applyLumaSharedFields(studio: Studio, values: Record<string, string | number | boolean>) {
  for (const layer of studio.doc.layers) {
    for (const key of ['name', 'visible', 'opacity'] as const) {
      const value = values[`${layer.id}:${key}`];
      if (value === undefined || value === layer[key]) continue;
      if (key === 'name' && typeof value === 'string') studio.setLayerProp(layer.id, key, value, 'Shared layer name');
      if (key === 'visible' && typeof value === 'boolean') studio.setLayerProp(layer.id, key, value, 'Shared visibility');
      if (key === 'opacity' && typeof value === 'number') studio.setLayerProp(layer.id, key, value, 'Shared opacity');
    }
  }
}
