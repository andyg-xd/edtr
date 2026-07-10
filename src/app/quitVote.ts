/** A window's vote in the atomic-quit poll (mirrors the Rust `Vote`). */
export type QuitVote = 'ready' | 'cancel';

/** The button pressed on the quit `CloseGuard`. */
export type QuitGuardAction = 'save' | 'discard' | 'cancel';

/**
 * Map a quit-guard button to its vote. Save votes `ready` only if the save
 * succeeded (a failed save must NOT let the app quit and lose work). Discard is
 * a vote, not an action — nothing is destroyed — so it is always `ready`.
 * Cancel aborts the whole quit.
 */
export function quitVoteFor(action: QuitGuardAction, saveOk: boolean): QuitVote {
  switch (action) {
    case 'cancel': return 'cancel';
    case 'save': return saveOk ? 'ready' : 'cancel';
    case 'discard': return 'ready';
  }
}
