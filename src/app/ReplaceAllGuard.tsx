import { ModalDialog } from './ModalDialog';

interface ReplaceAllGuardProps {
  count: number;
  /**
   * How many of the pending edits span an invisible inline atom (an image, an
   * embedded item) — D6 (spec §K5). Bulk is exactly where a match crossing an
   * atom the user cannot see is most likely, so this is disclosed BEFORE the
   * user commits, computed by `inspectEdits` without touching the document.
   * Optional and defaulted to 0 so an ordinary Replace All (no atoms
   * involved) doesn't carry an irrelevant "0 of these" line.
   */
  atomSpans?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown before a Replace All large enough to be hard to walk back (D5).
 *
 * A one-letter query can match hundreds of places, so the count is shown and
 * confirmed first. The undo line is backed by a test: a Replace All is one step
 * in either editor, and Live view un-marks the blocks it undoes, so nothing is
 * re-written on save (`DocumentView.undo.test.tsx`).
 */
export function ReplaceAllGuard({ count, atomSpans = 0, onConfirm, onCancel }: ReplaceAllGuardProps) {
  return (
    <ModalDialog label="Replace all">
      <p>Replace all {count} matches?</p>
      <p>You can undo this with ⌘Z.</p>
      {atomSpans > 0 && (
        <p>{atomSpans} of these run across pictures or embedded items.</p>
      )}
      {/* B4, owner 2026-08-29. Conditional phrasing on purpose: counting the
          affected tables would mean extending `inspectEdits`, and a flat claim
          would be false whenever the document has no tables. Note the LIMIT --
          this dialog only appears above the 10-match threshold, so a smaller
          Replace All still re-pads without saying so. */}
      <p>Any hand-aligned table holding a match will be re-spaced.</p>
      <div className="modal-actions">
        <button className="btn btn--primary" onClick={onConfirm}>Replace All</button>
        <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </ModalDialog>
  );
}
