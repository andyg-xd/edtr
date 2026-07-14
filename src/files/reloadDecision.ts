export type ReloadState = 'changed' | 'conflict' | 'deleted';

/** Decide the reload-banner state from the on-disk text (null = re-read failed
 * / file gone) vs the doc's last-saved text and dirty flag. `null` = no banner
 * (on-disk matches saved — e.g. our own save). */
export function decideReloadState(
  onDiskText: string | null,
  savedText: string,
  isDirty: boolean,
): ReloadState | null {
  if (onDiskText === null) return 'deleted';
  if (onDiskText === savedText) return null;
  return isDirty ? 'conflict' : 'changed';
}
