import { PDFDocument, PDFOperator, PDFOperatorNames, PDFName, setGraphicsState, drawObject, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, appendBezierCurve, closePath, fill, stroke, setFillingRgbColor, setStrokingRgbColor, setLineWidth, setLineCap, setLineJoin, setFillingGrayscaleColor, rectangle } from "pdf-lib";
import { affineForLayerTransform, type Document, type Layer } from "./document";
import { requireVectorDelivery, type VectorDeliveryNode } from "./vector-delivery-plan";
import { pathContours, traceContours, vectorPaints } from "./vector-path";
import type { PDFDict, PDFRef } from "pdf-lib";

function rgb(value: string): [number, number, number] | null {
  if (value === "none" || value === "transparent") return null;
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) throw new Error("Vector PDF currently requires opaque hex colors; alpha and other CSS colors are not silently substituted");
  const hex = value.length === 4 ? value.slice(1).split("").map(c => c + c).join("") : value.slice(1);
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Basic RGB vector delivery, explicitly NOT PDF/X, CMYK or an editable Luma project. */
export async function exportVectorPdf(doc: Document, selected?: Layer[]): Promise<Uint8Array> {
  const { nodes } = requireVectorDelivery(doc, "pdf", selected);
  const sx = 72 / doc.resolution.x, sy = 72 / doc.resolution.y;
  const width = doc.width * sx, height = doc.height * sy;
  if (![width, height, sx, sy].every(v => Number.isFinite(v) && v > 0) || Math.max(width, height) > 14400) throw new Error("PDF page exceeds the supported 200-inch boundary. Increase document PPI or export SVG.");
  const pdf = await PDFDocument.create();
  pdf.setCreator("Luma Studio"); pdf.setSubject("RGB vector delivery; no embedded output profile, PDF/X certification, or CMYK conversion");
  const page = pdf.addPage([width, height]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, -sy, 0, height));
  const makeForm = (node: VectorDeliveryNode): PDFRef => {
    const { layer, path } = node;
    const m = affineForLayerTransform(layer.transform);
    const layerOps: PDFOperator[] = [pushGraphicsState()];
    const paintStates: Record<string, PDFDict> = {};
    const objects: Record<string, PDFRef> = {};
    for (const mask of [node.mask, node.clip]) {
      if (!mask || mask === node.mask && pathContours(mask).every(c => c.anchors.length < 2)) continue;
      traceContours({ moveTo: (x, y) => { layerOps.push(moveTo(x, y)); }, bezierCurveTo: (a, b, c, d, x, y) => { layerOps.push(appendBezierCurve(a, b, c, d, x, y)); }, closePath: () => { layerOps.push(closePath()); } }, pathContours(mask), true);
      layerOps.push(PDFOperator.of(mask.fillRule === "evenodd" ? PDFOperatorNames.ClipEvenOdd : PDFOperatorNames.ClipNonZero), PDFOperator.of(PDFOperatorNames.EndPath));
    }
    if (path) layerOps.push(concatTransformationMatrix(m.a, m.b, m.c, m.d, m.e, m.f));
    for (const child of node.children) {
      const name = `Child${Object.keys(objects).length}`, state = `Opacity${Object.keys(paintStates).length}`;
      objects[name] = makeForm(child);
      const opacity = child.compositeOpacity ?? child.layer.opacity * (child.path ? 1 : child.layer.fillOpacity ?? 1);
      paintStates[state] = pdf.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity });
      layerOps.push(pushGraphicsState(), setGraphicsState(PDFName.of(state)), drawObject(PDFName.of(name)), popGraphicsState());
    }
    const commands = (closedOnly: boolean) => {
      const ops: PDFOperator[] = [];
      traceContours({ moveTo: (x, y) => { ops.push(moveTo(x, y)); }, bezierCurveTo: (a, b, c, d, x, y) => { ops.push(appendBezierCurve(a, b, c, d, x, y)); }, closePath: () => { ops.push(closePath()); } }, path ? pathContours(path).filter(c => !closedOnly || c.closed) : []);
      return ops;
    };
    for (const paint of path ? vectorPaints(path).filter(p => p.enabled) : []) {
      const color = rgb(paint.color);
      if (!color) continue;
      const key = `Paint${Object.keys(paintStates).length}`;
      paintStates[key] = pdf.context.obj({ Type: "ExtGState", ca: paint.opacity, CA: paint.opacity });
      layerOps.push(setGraphicsState(PDFName.of(key)));
      if (paint.kind === "fill") layerOps.push(setFillingRgbColor(...color), ...commands(true), path!.fillRule === "evenodd" ? PDFOperator.of(PDFOperatorNames.FillEvenOdd) : fill());
      else if (paint.width > 0) layerOps.push(setStrokingRgbColor(...color), setLineWidth(paint.width), setLineCap(1), setLineJoin(1), ...commands(false), stroke());
    }
    layerOps.push(popGraphicsState());
    // Composite layer opacity ONCE after its appearance stack. Applying it to
    // each paint separately changes overlapping fills/strokes and is incorrect.
    const form = pdf.context.formXObject(layerOps, {
      BBox: [0, 0, doc.width, doc.height],
      Resources: { ExtGState: paintStates, XObject: objects },
      Group: { S: "Transparency", I: true, K: false, CS: "DeviceRGB" },
    });
    let content = pdf.context.register(form);
    if (path && (layer.fillOpacity ?? 1) !== 1) {
      const opacity = layer.fillOpacity!;
      content = pdf.context.register(pdf.context.formXObject([
        pushGraphicsState(), setGraphicsState(PDFName.of("FillOpacity")), drawObject(PDFName.of("Content")), popGraphicsState(),
      ], {
        BBox: [0, 0, doc.width, doc.height],
        Resources: { XObject: { Content: content }, ExtGState: { FillOpacity: pdf.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity }) } },
        Group: { S: "Transparency", I: true, K: false, CS: "DeviceRGB" },
      }));
    }
    const maskedForm = (content: PDFRef, mask: PDFRef, mode: "Luminosity" | "Alpha") => pdf.context.register(pdf.context.formXObject([
      pushGraphicsState(), setGraphicsState(PDFName.of("SoftMask")), drawObject(PDFName.of("Content")), popGraphicsState(),
    ], {
      BBox: [0, 0, doc.width, doc.height],
      Resources: { XObject: { Content: content }, ExtGState: { SoftMask: pdf.context.obj({ Type: "ExtGState", SMask: { S: mode, G: mask, BC: [0] } }) } },
      Group: { S: "Transparency", I: true, K: false, CS: "DeviceRGB" },
    }));
    if (node.alpha) {
    const alpha = node.alpha;
    const maskOps: PDFOperator[] = [setFillingGrayscaleColor(alpha.defaultAlpha / 255), rectangle(0, 0, doc.width, doc.height), fill()];
    const maskImages: Record<string, PDFRef> = {};
    for (const tile of alpha.tiles()) {
      if (typeof tile.alpha === "number") maskOps.push(setFillingGrayscaleColor(tile.alpha / 255), rectangle(tile.x, tile.y, tile.width, tile.height), fill());
      else {
        const name = `MaskTile${Object.keys(maskImages).length}`;
        maskImages[name] = pdf.context.register(pdf.context.flateStream(tile.alpha, {
          Type: "XObject", Subtype: "Image", Width: tile.width, Height: tile.height,
          ColorSpace: "DeviceGray", BitsPerComponent: 8, Interpolate: false,
        }));
        maskOps.push(pushGraphicsState(), concatTransformationMatrix(tile.width, 0, 0, -tile.height, tile.x, tile.y + tile.height), drawObject(PDFName.of(name)), popGraphicsState());
      }
    }
    const mask = pdf.context.register(pdf.context.formXObject(maskOps, {
      BBox: [0, 0, doc.width, doc.height], Resources: { XObject: maskImages }, Group: { S: "Transparency", I: true, K: false, CS: "DeviceGray" },
    }));
    // Apply a soft mask ONCE to the complete object/group, not independently
    // to overlapping paints or children (which would increase their opacity).
    content = maskedForm(content, mask, "Luminosity");
    }
    if (node.clipContent) content = maskedForm(content, makeForm(node.clipContent), "Alpha");
    return content;
  };
  for (const node of nodes) {
    const opacity = node.compositeOpacity ?? node.layer.opacity * (node.path ? 1 : node.layer.fillOpacity ?? 1);
    const object = page.node.newXObject("LumaLayer", makeForm(node));
    const state = page.node.newExtGState("LayerOpacity", pdf.context.obj({ Type: "ExtGState", ca: opacity, CA: opacity }));
    page.pushOperators(pushGraphicsState(), setGraphicsState(state), drawObject(object), popGraphicsState());
  }
  page.pushOperators(popGraphicsState());
  return pdf.save();
}
