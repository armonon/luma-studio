/** Portable shaped glyph outlines. Keep this contract identical in Form Studio. */
export type FormOutlineCommand = { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x: number; y: number; x1: number; y1: number }
  | { type: "C"; x: number; y: number; x1: number; y1: number; x2: number; y2: number }
  | { type: "Z" };
export type FormTextOutlines = {
  schema: "luma-form/glyph-outlines@1";
  sourceKey: string;
  paths: { commands: FormOutlineCommand[] }[];
};

export function validateFormTextOutlines(value: unknown, typography: unknown): asserts value is FormTextOutlines {
  const fail = () => { throw new Error("Invalid or stale Form glyph outlines; export the text again from Luma."); };
  if (!value || typeof value !== "object") return fail();
  const shape = value as FormTextOutlines;
  if (shape.schema !== "luma-form/glyph-outlines@1" || shape.sourceKey !== JSON.stringify(typography)
    || !Array.isArray(shape.paths) || !shape.paths.length || shape.paths.length > 1280) return fail();
  let count = 0;
  for (const path of shape.paths) {
    if (!path || !Array.isArray(path.commands)) return fail();
    let open = false;
    for (const command of path.commands) {
      if (++count > 12000 || !command || !["M", "L", "Q", "C", "Z"].includes(command.type)) return fail();
      if (command.type === "M") { if (open) return fail(); open = true; }
      else if (!open) return fail();
      if (command.type === "Z") open = false;
      const fields = command.type === "Z" ? [] : command.type === "C" ? ["x", "y", "x1", "y1", "x2", "y2"] : command.type === "Q" ? ["x", "y", "x1", "y1"] : ["x", "y"];
      for (const field of fields) {
        const n = (command as unknown as Record<string, number>)[field];
        if (!Number.isFinite(n) || Math.abs(n) > 1_000_000) return fail();
      }
    }
    if (open) return fail();
  }
  if (!count) return fail();
}
