/**
 * Embed local images so the exported file stands alone (6c-iii, D10).
 *
 * The byte source is the asset-protocol URL images already carry as
 * `displaySrc` — no new Rust command is needed to read a local file, which is
 * the route this originally looked like it required.
 *
 * A failure is reported, never thrown and never hidden: the original `src`
 * stays, so the file degrades to "an image that needs its folder" rather than
 * to a broken export or an invisible hole.
 */
export async function inlineAssets(
  html: string,
  resolve: (src: string) => string | null,
): Promise<{ html: string; failures: string[] }> {
  const host = document.createElement('div');
  host.innerHTML = html;
  const failures: string[] = [];

  for (const img of Array.from(host.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src')!;
    // Already self-contained. Guarded here rather than trusted to `resolve`
    // (a caller-supplied hook from a later task) — a data: src was never a
    // document-relative path, so it is never "ours" to re-embed.
    if (src.startsWith('data:')) continue;
    const url = resolve(src);
    if (!url) continue; // remote — not a local file, leave it alone
    try {
      const res = await fetch(url);
      if (!('blob' in res)) throw new Error('no blob');
      // A real failed HTTP response (404 etc.) resolves rather than throws.
      // Treated as a failure so a broken fetch never turns into a data URI
      // that encodes an error body instead of the image.
      if ('ok' in res && res.ok === false) throw new Error('fetch failed');
      const blob = await res.blob();
      img.setAttribute('src', await blobToDataUri(blob));
    } catch {
      failures.push(src);
    }
  }
  return { html: host.innerHTML, failures };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
