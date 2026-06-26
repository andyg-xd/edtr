import type { FlavorProfile, SemanticNode } from './types';

/** Serialize a basic semantic node to Markdown, mirroring the flavor profile. */
export function serializeNode(node: SemanticNode, flavor: FlavorProfile): string {
  switch (node.type) {
    case 'paragraph':
      return node.text;
    case 'heading':
      if (flavor.headingStyle === 'setext' && (node.depth === 1 || node.depth === 2)) {
        const underline = (node.depth === 1 ? '=' : '-').repeat(Math.max(3, node.text.length));
        return `${node.text}\n${underline}`;
      }
      return `${'#'.repeat(node.depth)} ${node.text}`;
    case 'strong':
      return `${flavor.strong}${node.text}${flavor.strong}`;
    case 'emphasis':
      return `${flavor.emphasis}${node.text}${flavor.emphasis}`;
  }
}
