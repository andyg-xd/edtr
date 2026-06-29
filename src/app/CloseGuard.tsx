interface CloseGuardProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Shown when the window is closed with unsaved changes. Never loses work. */
export function CloseGuard({ onSave, onDiscard, onCancel }: CloseGuardProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <div className="modal">
        <p>You have unsaved changes. Save before closing?</p>
        <div className="modal-actions">
          <button onClick={onSave}>Save</button>
          <button onClick={onDiscard}>Discard</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
