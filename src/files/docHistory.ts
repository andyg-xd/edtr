/** Whole-view steps kept per document; the oldest drop off first. */
export const DOC_HISTORY_LIMIT = 100;

/** One whole-view step: the text to restore, and the view the change was made in. */
export interface HistoryStep {
  text: string;
  label: string;
}

/**
 * Undo across the Code ↔ Live switch, one whole view session at a time.
 *
 * Each editor keeps its own history only while it is mounted, and a switch
 * builds the other editor from scratch. What survives is the document's text,
 * so that is what this stores: the text from before each view session that
 * changed it. An undo hands back those stored bytes exactly, never something
 * an editor re-derived, so no serializer is involved and nothing is reflowed.
 *
 * Pure and framework-free; `DocumentSession` owns one, so it outlives any
 * single editor and a document switch.
 */
export class DocHistory {
  private past: HistoryStep[] = [];
  private future: HistoryStep[] = [];
  private _epoch = 0;

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Advanced by `clear`. A view session records the epoch it began in, so one
   * that ends after a reload cannot bring the pre-reload text back. */
  get epoch(): number {
    return this._epoch;
  }

  /** A view session is over; record it if it changed anything. */
  endSession(start: string, end: string, label: string, epoch: number): void {
    if (start === end || epoch !== this._epoch) return;
    this.past.push({ text: start, label });
    if (this.past.length > DOC_HISTORY_LIMIT) this.past.shift();
  }

  /** A real edit. Called on the first change, not at session end, so a redo
   * can never replace text typed since the undo. */
  noteEdit(): void {
    this.future = [];
  }

  /** Step back. `current` is the text a redo should come back to. */
  undo(current: string): HistoryStep | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push({ text: current, label: step.label });
    return step;
  }

  /** Step forward. `current` is the text an undo should come back to. */
  redo(current: string): HistoryStep | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push({ text: current, label: step.label });
    return step;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this._epoch++;
  }
}
