/** One heading, as the outline sees it. Derived from the SOURCE (spec D2). */
export interface OutlineEntry {
  /** `SourceNode.id` — stable within one parse, not across parses. */
  id: string;
  /** 1–6. */
  level: number;
  /** Plain text, markup and inline formatting removed. */
  text: string;
  /** Byte offsets into the source string. */
  srcFrom: number;
  srcTo: number;
  /**
   * Index of this heading among the headings inside its containing TOP-LEVEL
   * block, in document order. Zero for a heading that is itself top-level.
   *
   * This field exists because nested blocks carry no source range in either
   * live model (spec §4.2) — it is what lets `pmReveal` find the right
   * heading inside a `<section>` without one.
   */
  ordinalInBlock: number;
  /** Source range of the containing top-level block — the anchor Live views resolve against. */
  blockFrom: number;
  blockTo: number;
  /**
   * ProseMirror position of the heading node, present ONLY on entries derived
   * from a live document (`buildLiveOutline`).
   *
   * When it is here it is exact and it wins: it needs neither the block-range
   * lookup nor the ordinal, because the heading node was walked directly. When
   * it is absent the entry came from the source and the two-step resolution in
   * `pmReveal` applies as before.
   *
   * On a live-derived entry the source fields above are NOT positions — they
   * are zero. Nothing may read them for such an entry, which is why Code view
   * always derives from the source instead.
   */
  pmPos?: number;
}

/** One entry plus whatever nests under it. */
export interface OutlineNode {
  entry: OutlineEntry;
  children: OutlineNode[];
}
