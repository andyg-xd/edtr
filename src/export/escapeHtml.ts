/**
 * Escape text for insertion into HTML markup.
 *
 * Extracted from `documentShell` when the plaintext export path became a
 * second consumer (6c-iii). A `.txt` file is the case that makes this
 * load-bearing rather than incidental: its ENTIRE content is untrusted text
 * heading into markup, so a missed `<` turns a line of prose into an element.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}
