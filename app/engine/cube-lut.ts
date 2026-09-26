/** Bounded, serializable RGB 3D LUT. Red is the fastest changing axis. */
export type CubeLut = { title: string; size: number; domainMin: [number, number, number]; domainMax: [number, number, number]; values: number[] };
export const MAX_CUBE_BYTES = 4 * 1024 * 1024;
export const MAX_CUBE_SIZE = 33;

export function cloneCubeLut(lut: CubeLut): CubeLut {
  if (!lut || !Number.isInteger(lut.size) || lut.size < 2 || lut.size > MAX_CUBE_SIZE ||
      !Array.isArray(lut.values) || lut.values.length !== lut.size ** 3 * 3 ||
      !lut.values.every((v) => Number.isFinite(v) && Math.abs(v) <= 16) ||
      !Array.isArray(lut.domainMin) || !Array.isArray(lut.domainMax) ||
      lut.domainMin.length !== 3 || lut.domainMax.length !== 3 ||
      !lut.domainMin.every((v, i) => Number.isFinite(v) && Number.isFinite(lut.domainMax[i]) && v < lut.domainMax[i])) {
    throw new Error("Invalid 3D LUT: expected a finite 2–33 point RGB cube with an increasing domain");
  }
  return { title: String(lut.title ?? "Imported LUT").slice(0, 120), size: lut.size,
    domainMin: [...lut.domainMin], domainMax: [...lut.domainMax], values: [...lut.values] };
}

export function parseCubeLut(text: string): CubeLut {
  if (text.length > MAX_CUBE_BYTES || new TextEncoder().encode(text).byteLength > MAX_CUBE_BYTES) throw new Error("LUT exceeds the 4 MiB input limit");
  const lut: CubeLut = { title: "Imported LUT", size: 0, domainMin: [0, 0, 0], domainMax: [1, 1, 1], values: [] };
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...args] = line.split(/\s+/);
    if (["TITLE", "LUT_3D_SIZE", "DOMAIN_MIN", "DOMAIN_MAX"].includes(key)) {
      if (seen.has(key) || lut.values.length) throw new Error(`Duplicate or misplaced LUT directive: ${key}`);
      seen.add(key);
      if (key === "TITLE") lut.title = args.join(" ").replace(/^"|"$/g, "").slice(0, 120);
      else if (key === "LUT_3D_SIZE") {
        lut.size = Number(args[0]);
        if (args.length !== 1 || !Number.isInteger(lut.size) || lut.size < 2 || lut.size > MAX_CUBE_SIZE) throw new Error("3D LUT size must be 2–33");
      } else {
        if (args.length !== 3 || !args.every((v) => Number.isFinite(Number(v)))) throw new Error("Invalid LUT domain");
        lut[key === "DOMAIN_MIN" ? "domainMin" : "domainMax"] = args.map(Number) as [number, number, number];
      }
    } else {
      const values = [key, ...args].map(Number);
      if (!lut.size || values.length !== 3 || values.some((v) => !Number.isFinite(v) || Math.abs(v) > 16)) throw new Error("Unsupported or malformed LUT data (only RGB 3D .cube files are supported)");
      if (lut.values.length + 3 > lut.size ** 3 * 3) throw new Error("Too many LUT samples");
      lut.values.push(...values);
    }
  }
  return cloneCubeLut(lut);
}

/** Trilinear interpolation; output clipping belongs to the destination format. */
export function sampleCubeLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const p = [r, g, b].map((v, i) => Math.max(0, Math.min(1, (v - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i]))) * (lut.size - 1));
  const base = p.map(Math.floor);
  const out: [number, number, number] = [0, 0, 0];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const weight = (x ? p[0] - base[0] : 1 - p[0] + base[0]) * (y ? p[1] - base[1] : 1 - p[1] + base[1]) * (z ? p[2] - base[2] : 1 - p[2] + base[2]);
    const index = (Math.min(base[2] + z, lut.size - 1) * lut.size ** 2 + Math.min(base[1] + y, lut.size - 1) * lut.size + Math.min(base[0] + x, lut.size - 1)) * 3;
    for (let c = 0; c < 3; c++) out[c] += lut.values[index + c] * weight;
  }
  return out;
}
