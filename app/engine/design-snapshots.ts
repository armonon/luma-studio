/** Immutable project archives, without nested archives or operation history. */
export type DesignSnapshot = { id: string; name: string; bytes: Uint8Array };
export const DESIGN_SNAPSHOT_LIMITS = { count: 6, bytes: 128 * 1024 * 1024 } as const;
export type DesignSnapshotAction = { kind: "capture"; name: string } | { kind: "apply" | "delete"; id: string };
export const DESIGN_SNAPSHOT_COMMANDS = { capture: "Capture full variant", apply: "Apply full variant", delete: "Delete full variant" } as const;

export function validateDesignSnapshots(values: readonly DesignSnapshot[] = []) {
  if (!Array.isArray(values) || values.length > DESIGN_SNAPSHOT_LIMITS.count) throw new Error("Full variants are limited to six snapshots");
  const ids = new Set<string>();
  let bytes = 0;
  for (const value of values) {
    if (!value || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id) || ids.has(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength < 4) throw new Error("Invalid full variant");
    ids.add(value.id); bytes += value.bytes.byteLength;
    if (bytes > DESIGN_SNAPSHOT_LIMITS.bytes) throw new Error("Full variants exceed the 128 MiB archive budget");
  }
  return values.map(value => ({ ...value })); // bytes are immutable, deliberately shared
}
