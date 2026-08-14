import { EXPORT_STYLES } from './exportStyles';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/** Wrap a body fragment in a standalone document (6c-iii, D10). */
export function documentShell(opts: { title: string; body: string; extraHead?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
${EXPORT_STYLES}
</style>${opts.extraHead ? `\n${opts.extraHead}` : ''}
</head>
<body>
${opts.body}
</body>
</html>
`;
}
