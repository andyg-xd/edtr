import { parse } from './parse';
import { detectFlavor } from './flavor';
import type { DocFormat, FlavorProfile, SourceNode } from './types';

/** A parsed document: canonical source + position tree + detected flavor. */
export class SourceDocument {
  readonly tree: SourceNode;
  readonly flavor: FlavorProfile;

  constructor(
    readonly source: string,
    readonly format: DocFormat,
  ) {
    this.tree = parse(source, format);
    this.flavor = detectFlavor(source, format);
  }

  /** Depth-first lookup of a node by id. */
  findNode(id: string): SourceNode | undefined {
    const stack: SourceNode[] = [this.tree];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return undefined;
  }
}
