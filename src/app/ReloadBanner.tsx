import type { ReloadState } from '../files/reloadDecision';

const MESSAGE: Record<ReloadState, string> = {
  changed: 'This file changed on disk.',
  conflict: 'This file changed on disk, and you have unsaved changes.',
  deleted: 'This file was moved or deleted on disk — your changes are still here.',
};

export function ReloadBanner({
  state, onReload, onKeepMine, onDismiss,
}: {
  state: ReloadState;
  onReload: () => void;
  onKeepMine: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="reload-banner" role="alert">
      <span className="reload-banner__msg">{MESSAGE[state]}</span>
      <span className="reload-banner__actions">
        {state === 'changed' && <button className="btn btn--primary" onClick={onReload}>Reload</button>}
        {state === 'conflict' && <button className="btn btn--danger" onClick={onReload}>Reload (discard mine)</button>}
        {state === 'conflict' && <button className="btn btn--secondary" onClick={onKeepMine}>Keep mine</button>}
        {(state === 'changed' || state === 'deleted') && (
          <button className="reload-banner__dismiss" aria-label="Dismiss" onClick={onDismiss}>×</button>
        )}
      </span>
    </div>
  );
}
