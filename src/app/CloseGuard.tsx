import { ModalDialog } from './ModalDialog';

interface CloseGuardProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Shown when the window is closed with unsaved changes. Never loses work. */
export function CloseGuard({ onSave, onDiscard, onCancel }: CloseGuardProps) {
  return (
    <ModalDialog label="Unsaved changes">
      <p>You have unsaved changes. Save before closing?</p>
      <div className="modal-actions">
        <button className="btn btn--primary" onClick={onSave}>Save</button>
        <button className="btn btn--danger" onClick={onDiscard}>Discard</button>
        <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
      </div>
    </ModalDialog>
  );
}
