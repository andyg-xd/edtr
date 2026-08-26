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
}
