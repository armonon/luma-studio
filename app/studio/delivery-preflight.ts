import type { PhotoshopCompatibilityReport } from "../engine/psd";
import type { PhotoshopCompatibilityIssue } from "../engine/psd-metadata";

export function deliveryStatus(report: PhotoshopCompatibilityReport) {
  if (!report.canExport || report.issues.some(issue => issue.severity === "error")) return "Export blocked";
  return report.issues.some(issue => issue.severity === "warning") ? "Partially editable copy" : "No known conversions";
}

export function deliveryGuidance(issue: PhotoshopCompatibilityIssue) {
  switch (issue.code) {
    case "IMPORTED_TEXT_PREVIEW_REGENERATED": return { category: "Text appearance needs verification", action: "Keep the original file and .luma master. Compare fonts, line breaks and effects in the receiving application; cancel if exact appearance is required without verification." };
    case "EDITABLE_VECTOR_MASK_NOT_EXPORTED": return { category: "Luma writer limitation", action: "Keep the editable .luma master. Use a flattened PNG for appearance-only delivery, or return to this layer to prepare a separate delivery copy." };
    case "OUTPUT_DEPTH_CONVERTED_TO_8_BIT": return { category: "Luma writer limitation", action: "This copy loses high-depth sample precision. Keep the .luma master; cancel if the recipient needs high-bit-depth editing." };
    case "OUTPUT_COLOR_SPACE_CONVERTED_TO_SRGB": return { category: "Color conversion", action: "This copy uses sRGB compatibility pixels. Keep the original profile and working color in the .luma master." };
    case "PSD_DIMENSION_LIMIT": return { category: "Target-format limit", action: "Choose PSB, then review its compatibility report." };
    case "VECTOR_APPEARANCE_UNSUPPORTED": return { category: "Luma writer limitation", action: "Use SVG for supported vector appearance stacks, or prepare a separate raster delivery copy. Your master stays editable." };
    case "COMPOSITE_PREVIEW_UNAVAILABLE": return { category: "Reader compatibility", action: "The recipient must open the editable layers. A reader that only uses the merged preview may show an empty image." };
    default: return { category: issue.severity === "error" ? "Unsupported delivery combination" : "Conversion / compatibility", action: "Keep the .luma master. Continue only if this limitation is acceptable for the recipient; otherwise return to editing." };
  }
}
