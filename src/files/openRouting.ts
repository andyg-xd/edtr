import type { OpenPayload } from './openPayload';

interface OpenDeps {
  /** What is left once Rust has shown every file another window already has. */
  route: (payload: OpenPayload) => Promise<OpenPayload | null>;
  apply: (payload: OpenPayload) => Promise<void>;
  spawn: (payload: OpenPayload) => Promise<void>;
}

/**
 * The fill-or-spawn choice for ⌘O, Open Recent and the OS's open gestures.
 *
 * An empty window fills itself, so it must route first — nothing else stands
 * between it and opening a second copy. A spawn needs no routing here:
 * `open_in_new_window` routes in Rust, which also covers the callers that spawn
 * directly (drag-drop, ⌘-click links).
 */
export async function openPayload(payload: OpenPayload, windowEmpty: boolean, deps: OpenDeps): Promise<void> {
  if (!windowEmpty) {
    await deps.spawn(payload);
    return;
  }
  const rest = await deps.route(payload);
  if (rest) await deps.apply(rest);
}

/** The document `open://show` names. Rust sends the path exactly as this window
 * registered it, so plain comparison is enough. */
export function docToShow(docs: { id: string; session: { path: string } }[], path: string): string | null {
  return docs.find((d) => d.session.path === path)?.id ?? null;
}
