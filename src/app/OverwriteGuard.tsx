import { ModalDialog } from './ModalDialog';
import { basename } from '../files/fileTypes';

interface OverwriteGuardProps {
  path: string;
  onOverwrite: () => void;
  onCancel: () => void;
}

/** Shown when a save would replace changes another app or window made to the
 * file. Cancel comes first so that it, not Overwrite, takes the initial focus. */
export function OverwriteGuard({ path, onOverwrite, onCancel }: OverwriteGuardProps) {
  return (
    <ModalDialog label="File changed elsewhere">
      <p>
        "{basename(path)}" was changed by another app or window since Edtr opened or last saved it.
        Saving now replaces those changes with yours.
      </p>
      <div className="modal-actions">
        <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn--danger" onClick={onOverwrite}>Overwrite</button>
      </div>
    </ModalDialog>
  );
}
