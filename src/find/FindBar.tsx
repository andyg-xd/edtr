import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Tooltip } from '../ui/Tooltip';
import type { FindQuery } from './findQuery';

/**
 * The three toggles. `label` is both the accessible name and the tooltip text,
 * and each is already plain language — "Regular expression" spelled out is the
 * layman form of the developer's "regex".
 */
const TOGGLES = [
  { key: 'matchCase', glyph: 'Aa', label: 'Match case' },
  { key: 'wholeWord', glyph: 'ab|', label: 'Whole word' },
  { key: 'regex', glyph: '.*', label: 'Regular expression' },
] as const;

interface FindBarProps {
  query: FindQuery;
  /** Pre-rendered count, e.g. '3/7' | 'No results' | 'Invalid pattern' | ''. */
  count: string;
  /** Bumped by the owner to focus and select the field — including when ⌘F is pressed while the bar is already open. */
  focusToken: number;
  onQueryChange: (query: FindQuery) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  showReplace: boolean;
  replaceText: string;
  canReplace: boolean;
  onReplaceTextChange: (text: string) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
}

/**
 * The find bar. Presentational: it owns no find state, runs no matching, and
 * knows nothing about either editor — DocumentView holds all of that, which is
 * what lets one bar serve all three surfaces.
 *
 * Enter / Shift-Enter move between matches and Escape closes, handled on the
 * CONTAINER so they work from any control in the bar and not just the field —
 * except a focused BUTTON, which keeps its own native Enter activation (see
 * `onKeyDown` below).
 */
export function FindBar({
  query, count, focusToken, onQueryChange, onNext, onPrev, onClose,
  showReplace, replaceText, canReplace, onReplaceTextChange, onReplace, onReplaceAll,
}: FindBarProps) {
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [focusToken]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      // A focused BUTTON already has its own Enter behaviour — the browser
      // activates it (a native click) the moment this handler returns
      // without cancelling the event. Tab to "Replace all" and press Enter
      // must run Replace all, not "step to the next match": the old code
      // called preventDefault() and fell through to onNext()/onPrev() for
      // ANY target that wasn't the replace text field, which silently
      // swallowed the click every button in the bar (Prev/Next/the three
      // toggles/Close/Replace/Replace all) would otherwise have received.
      // Backing off entirely for a button target — no preventDefault, no
      // step call — is what lets that native activation through.
      if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
      e.preventDefault();
      // Enter means "replace" in the replace field and "next match" everywhere
      // else — the convention every editor with a replace row uses.
      const inReplace = (e.target as HTMLElement)?.classList?.contains('find-replace-input');
      if (inReplace) onReplace();
      else if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="find-bar" role="search" onKeyDown={onKeyDown}>
      <div className="find-row">
        <input
          ref={fieldRef}
          className="find-input"
          type="text"
          placeholder="Find"
          aria-label="Find"
          // A search term is not prose. macOS text substitution capitalises the
          // first letter and "corrects" words that were typed deliberately, which
          // silently changes what is being searched for.
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          value={query.text}
          onChange={(e) => onQueryChange({ ...query, text: e.target.value })}
        />
        <span className="find-count" role="status">{count}</span>
        <Tooltip label="Previous match" shortcut="⇧⌘G" id="tip-find-prev">
          <button type="button" className="btn btn--secondary find-prev" aria-label="Previous match" onClick={onPrev}>‹</button>
        </Tooltip>
        <Tooltip label="Next match" shortcut="⌘G" id="tip-find-next">
          <button type="button" className="btn btn--secondary find-next" aria-label="Next match" onClick={onNext}>›</button>
        </Tooltip>
        {TOGGLES.map((t) => (
          <Tooltip key={t.key} label={t.label} id={`tip-find-${t.key}`}>
            <button
              type="button"
              data-toggle={t.key}
              className={`btn btn--secondary find-toggle${query[t.key] ? ' is-active' : ''}`}
              aria-label={t.label}
              aria-pressed={query[t.key]}
              onClick={() => onQueryChange({ ...query, [t.key]: !query[t.key] })}
            >
              {t.glyph}
            </button>
          </Tooltip>
        ))}
        <Tooltip label="Close find" shortcut="esc" id="tip-find-close">
          <button type="button" className="btn btn--secondary find-close" aria-label="Close find" onClick={onClose}>×</button>
        </Tooltip>
      </div>
      {showReplace && (
        <div className="find-replace-row">
          <input
            className="find-replace-input"
            type="text"
            placeholder="Replace with"
            aria-label="Replace with"
            disabled={!canReplace}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            value={replaceText}
            onChange={(e) => onReplaceTextChange(e.target.value)}
          />
          <button type="button" className="btn btn--secondary find-replace" disabled={!canReplace} onClick={onReplace}>Replace</button>
          <button type="button" className="btn btn--secondary find-replace-all" disabled={!canReplace} onClick={onReplaceAll}>Replace all</button>
        </div>
      )}
    </div>
  );
}
