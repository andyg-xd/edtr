import type { OutlineEntry, OutlineNode } from './types';

/**
 * Turn the flat list into the tree the panel renders.
 *
 * Nesting is by RELATIVE level, not absolute: a document that skips from h1
 * to h3, or starts at h3, still nests sensibly and never invents a level
 * that is not in the document.
 */
export function nestOutline(entries: OutlineEntry[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const entry of entries) {
    const node: OutlineNode = { entry, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}
