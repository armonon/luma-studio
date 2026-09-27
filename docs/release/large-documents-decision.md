# `large-documents`: why it stays "planned"

The capability is permitted to the pro edition and its status is `"planned"`,
which means `isAvailable` reports false and nothing advertises it. A test
asserts that status so it cannot be flipped without a deliberate decision.
This is that decision, written down so it is not re-litigated from memory.

## The old reason is no longer the reason

The comment in `edition.ts` used to say selections and masks were not sparse
yet. They are now: `SparseAlphaSurface` backs both, and the sparse-selection
and sparse-mask regression gates pass. Anyone reading that comment today would
conclude the capability is one workflow away from shipping.

## What actually works past the ceiling

The ceiling is a property of the 2D canvas — roughly 16384px per side and 64
megapixels of area — not of the document. Past it:

- layers are sparse tiles (`PrecisionTileSurface`), with no bitmap at all;
- the viewport is tiled and composites band by band;
- selections and masks are sparse;
- PNG export streams, because PNG's scanline IDAT can be produced band by band;
- artboard export streams its own region.

## What does not, and why it is not one push away

**JPEG and WebP export.** `exportImageSnapshot` refuses both past the ceiling.
This is not an oversight waiting on effort: PNG streams because its compressed
stream is scanline-structured, and the encoders available here for JPEG and
WebP want a whole frame. There is no tile-streaming path to write.

**Operations that need a real canvas.** Past the ceiling a raster layer holds a
tile surface and `layer.bitmap` is undefined, so these cannot run:

| Operation | Behaviour past the ceiling |
| --- | --- |
| Gradient fill, pattern fill | refuses, and names the reason |
| Perspective crop, perspective warp | refuses, and names the reason |
| Distort | refuses, and names the reason |
| Add frame | refuses, and names the reason |
| Clear layer style, layers from style | refuses, and names the reason |
| Bitmap merge / group | refuses, and names the reason |
| CMYK print export | refuses above 4 MP, a separate and stricter limit |

Every one of those used to refuse silently — a click that did nothing and said
nothing, or worse, a success message. They now explain themselves, which makes
the incompleteness visible to whoever hits it instead of looking like a bug.

## The decision

Keep `"planned"`.

A capability called `large-documents` reasonably implies you can open a large
document and work with it the way you work with any other. You can open it,
paint it, select, mask, and export a PNG — and you cannot export a JPEG or
reach for a third of the tool palette. Calling that `"shipped"` would be
exactly the class of overclaim `CAPABILITY_STATUS` exists to prevent, and the
edition comment is explicit that a partial workflow must not be sold as a
complete one.

Flipping it would require either a tile-streaming JPEG/WebP encoder or an
honest narrowing of the capability's name and description to what is true — for
example splitting "open and edit large documents" from "export large documents
in any format". Either is a real piece of work and a product decision; neither
is a status change.
