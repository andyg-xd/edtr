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
 * It exists because undo is not dependable in Live view (spec 7.1), so the
 * cheapest protection against a one-letter query matching hundreds of places is
 * to say how many and ask first.
 */
export function ReplaceAllGuard({ count, atomSpans = 0, onConfirm, onCancel }: ReplaceAllGuardProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Replace all">
      <div className="modal">
        <p>Replace all {count} matches?</p>
        <p>Undo may not fully reverse this.</p>
        {atomSpans > 0 && (
          <p>{atomSpans} of these run across pictures or embedded items.</p>
        )}
        <div className="modal-actions">
          <button className="btn btn--primary" onClick={onConfirm}>Replace All</button>
          <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
