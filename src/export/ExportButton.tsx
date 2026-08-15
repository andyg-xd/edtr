interface ExportButtonProps {
  onExport: (kind: 'html' | 'pdf') => void;
}

/**
 * Placeholder for Task 7 (6c-iii), which builds the real export UI — a kind
 * picker and the wiring into `exportController`. This exists only so Task 6's
 * toolbar has something to render in the document-actions zone; clicking it
 * calls straight through to whatever handler the caller supplied, and every
 * caller in this task supplies a no-op. `data-testid="export-button"` is the
 * hook Task 6's tests use to prove the zone renders in every view — do not
 * remove it when Task 7 replaces this file's contents.
 */
export function ExportButton({ onExport }: ExportButtonProps) {
  return (
    <button
      type="button"
      className="btn btn--secondary ribbon-btn"
      data-testid="export-button"
      onClick={() => onExport('html')}
    >
      Export
    </button>
  );
}
