import { resolveImageDisplaySrc } from '../files/imageAssets';

/**
 * Adapts the app's display-src resolver to `inlineAssets`' resolver contract
 * (6c-iii, Task 7).
 *
 * The two disagree about one case, which is the whole reason this exists.
 * `resolveImageDisplaySrc` returns its INPUT UNCHANGED when it can't localise
 * a path — a remote URL, or a document with no folder to resolve against —
 * because a render can simply use the original `src`. `inlineAssets` instead
 * wants `null` there, meaning "not a local file, leave it alone"; handed a
 * string it would try to `fetch` and embed a remote image, and record a
 * failure for every one it couldn't reach.
 *
 * Identity is the test rather than a second copy of the remote-URL regex, so
 * there is no pattern here to drift out of step with `imageAssets`.
 */
export function resolveExportAsset(src: string, docPath: string | null): string | null {
  const url = resolveImageDisplaySrc(src, docPath);
  return url === src ? null : url;
}
