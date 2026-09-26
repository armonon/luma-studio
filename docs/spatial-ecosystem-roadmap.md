# Luma × Form spatial ecosystem

## Product principle

Luma remains the authoritative 2D compositor and typography editor. Form remains the authoritative 3D scene, geometry, material, camera, animation and simulation editor. Spatial assets are linked, versioned objects rather than flattened copies.

Every round trip should be able to return beauty, depth, normals, shadow, reflection, emission and stable object-ID passes as ordinary Luma layers and sparse masks.

## Capability map

### Move and transform

- XYZ transforms and camera-aware handles.
- Perspective matching from guides, horizons and vanishing points.
- Surface snapping, object attachment and occlusion-aware placement.
- Bend, twist, taper, inflate, fracture and lattice deformation in Form.
- Content-aware move extended into depth-aware scene rearrangement.

### Brush, pencil and sampled-image brushes

- Paint directly on linked object surfaces with seam-crossing UV strokes.
- Choose color, roughness, metalness, normal, displacement, emission or opacity as the paint target.
- Turn brush dabs into instanced geometry, particles, foliage or physical scatter.
- Use sampled-image brushes as material stamps or relief stamps.
- Project strokes through the active camera or wrap them geodesically across a surface.

### Clone, healing, remove and patch

- Clone texture and material channels together instead of color alone.
- Remove an object and reconstruct the hidden background using depth and neighboring geometry.
- Patch damaged scans with surface-aware texture synthesis.
- Heal across UV seams and mirrored geometry.
- Clone whole scene objects with perspective, lighting and contact shadows preserved.

### Dodge, burn, blur, sharpen, smudge and sponge

- Dodge and burn real scene lights or material response.
- Blur or sharpen depth, normal and roughness channels.
- Smudge paint across a 3D surface without breaking at UV seams.
- Sponge can alter material saturation independently from illumination.
- Liquify becomes mesh sculpt, inflate, pinch and drag with bounded topology edits.

### Gradient, fill and pattern

- Gradients become environment lights, volumetric falloffs or material ramps.
- Pattern fill becomes procedural surface tiling with physical scale.
- Fill a selection volume with particles, fog, liquid or repeated objects.
- Use luminance as displacement and color as albedo from the same source.
- Project patterns from a camera, triplanar projection or object coordinates.

### Selections and masks

- Extrude 2D selections into adjustable 3D volumes.
- Select by object ID, depth interval, surface normal, material or light exposure.
- Return scene occlusion as an editable sparse Luma mask.
- Refine selections with depth discontinuities and mesh silhouettes.
- Type masks become physical cutters, embossers and light gobos.

### Text

- True glyph-outline extrusion, bevel profiles and editable materials.
- Text on paths, surfaces, cylinders and arbitrary meshes.
- Text as geometry, light, shadow, particles, cloth or volume.
- Kinetic typography with per-glyph transforms and physics.
- Preserve Luma character runs while Form owns spatial presentation.

### Shapes, pen and paths

- Extrude, revolve, sweep and loft editable Luma paths.
- Shapes become cutters, windows, decals, lights and shadow gobos.
- Pen paths drive camera motion, object animation and particle emission.
- Path width can become tube radius; pressure can become profile scale.
- Compound paths preserve holes for signage, packaging and fabrication.

### Crop, perspective crop and warp

- Camera crop controls sensor framing rather than destructively trimming content.
- Perspective crop can solve a Form camera from a photographed rectangle.
- Perspective warp can attach artwork to planar or curved scene surfaces.
- Radial warp becomes spherical, cylindrical or custom-cage deformation.
- Straighten can align image horizon and 3D world horizon together.

### Tone, adjustments and professional color

- Tone controls can relight using normal and depth passes.
- Curves and Levels can target distance, surface angle or light contribution.
- HSL can isolate physical materials instead of only pixel colors.
- Adjustment layers can be exported as render-look recipes rather than geometry.
- LUTs and color management remain Luma-owned and apply consistently to Form renders.

### Eyedropper, sampler, ruler and measurement

- Sample albedo separately from illumination.
- Estimate roughness, metalness and emission from reference areas.
- Use ruler lines for camera calibration and real-world scene scale.
- Probe scene depth, object IDs, surface normals and world coordinates.
- Capture a material from a photo and create a reusable Form material node graph.

### RAW, neural and AI workflows

- Match a camera and lens from RAW metadata before adding 3D elements.
- Generate depth and normals locally as editable starting passes.
- Turn segmented subjects into cards, layered depth scenes or reconstruction references.
- Relight products and people with Form lights while Luma protects identity and texture.
- AI edits should produce reusable geometry, masks, materials and prompts rather than one flattened result.

## High-value product workflows

1. Product packaging: Luma label design → Form bottle/box wrap → multipass product render → Luma finish.
2. Spatial poster: rich Luma typography → Form extrusion/material/lighting → depth-aware Luma composition.
3. Photo compositing: RAW develop → camera match → Form objects and shadows → object-ID masks → Luma grade.
4. Surface painting: Form UV object → Luma brush/material channels → live Form preview → Luma final texture export.
5. Physical typography: Luma type → Form outline extrusion/boolean → signage, jewelry, stamp or printable mesh.
6. Fashion graphics: Luma artwork → Form garment wrap and cloth simulation → beauty/shadow passes → campaign layout.
7. Motion identity: Luma style system → Form per-glyph animation → transparent multipass sequence → Luma frame finishing.

## Delivery order

### Foundation — implemented

- Shared versioned text and spatial JSON contracts.
- Nondestructive spatial metadata on Luma layers.
- Lightweight affine XYZ/depth preview in Luma.
- Tool-aware spatial capability registry covering every registered tool.
- Form import for text, shapes, paths, image planes and pass placeholders.
- Form project persistence for linked Luma objects.

### Next engineering campaign

1. Native glyph outlines and compound-path hole preservation.
2. Signed live-link service with revision and conflict handling.
3. Multipass return package: beauty, depth, normals, shadow, reflection and IDs.
4. Camera/lens interchange and photo matching.
5. UV/material channel painting round trip.
6. Surface wrapping and camera projection.
7. Depth/object-aware selections and masks.
8. Animation and per-glyph motion exchange.
9. Render-farm/background job protocol with cancellation and recovery.
10. Compatibility corpus containing large textures, complex paths, missing links and corrupt assets.

## Honesty boundary

Luma's current preview is intentionally lightweight 2.5D. Form produces the native 3D object. Open paths, rich compound glyph outlines, live refresh and multipass return are planned contract-compatible upgrades, not completed features.
