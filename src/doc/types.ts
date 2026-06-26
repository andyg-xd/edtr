export type DocFormat = 'markdown' | 'html';

/** A node in the position-annotated parse tree. `range` is [start, end) in JS-string indices. */
export interface SourceNode {
  id: string;
  type: string;
  range: [number, number];
  children: SourceNode[];
  raw: string;
  data?: Record<string, unknown>;
}

/** The stylistic conventions a document uses, so serialization mirrors them. */
export interface FlavorProfile {
  bullet: '-' | '*' | '+';
  emphasis: '_' | '*';
  strong: '__' | '**';
  headingStyle: 'atx' | 'setext';
  fence: '`' | '~';
  orderedDelimiter: '.' | ')';
  gfm: boolean;
}

/** Minimal semantic node set the Phase-1 serializer can emit. Expanded in later phases. */
export type SemanticNode =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; depth: number; text: string }
  | { type: 'strong'; text: string }
  | { type: 'emphasis'; text: string };

/** A non-overlapping replacement of source[start, end) with `text`. */
export interface SpliceEdit {
  start: number;
  end: number;
  text: string;
}

/** A node-relative edit, resolved to a SpliceEdit against a SourceDocument. */
export type Patch =
  | { kind: 'replace'; nodeId: string; text: string }
  | { kind: 'insertAfter'; nodeId: string; text: string }
  | { kind: 'insertBefore'; nodeId: string; text: string }
  | { kind: 'delete'; nodeId: string };
