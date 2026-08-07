// Selection commit helper. Every selection edit on Studio follows the same
// shape: snapshot the current selection, run the mutation, snapshot the new
// selection, commit as a history entry. Studio's own methods stay thin
// wrappers around this so history behavior stays uniform.

import { Document, Selection } from "./document";
import { cloneSelection } from "./history-payload";
import type { HistoryEntry } from "./studio";

/** Run a selection mutation and produce the paired history entry. */
export function withSelectionCommit(
  doc: Document,
  label: string,
  mutate: () => void,
): HistoryEntry {
  const before: Selection | null = cloneSelection(doc.selection);
  mutate();
  const after: Selection | null = cloneSelection(doc.selection);
  return {
    label,
    before: [],
    after: [],
    selectionBefore: before,
    selectionAfter: after,
  };
}
