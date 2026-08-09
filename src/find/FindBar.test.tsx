import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { FindBar } from './FindBar';
import { emptyQuery, type FindQuery } from './findQuery';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

function props(over: Partial<Parameters<typeof FindBar>[0]> = {}) {
  return {
    query: emptyQuery,
    count: '',
    focusToken: 0,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    showReplace: false,
    replaceText: '',
    canReplace: true,
    onReplaceTextChange: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    ...over,
  };
}

const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('.find-input')!;
const toggle = (c: HTMLElement, key: string) =>
  c.querySelector<HTMLButtonElement>(`.find-toggle[data-toggle="${key}"]`)!;

describe('FindBar', () => {
  it('renders a find field with a plain-language placeholder', async () => {
    const c = await render(<FindBar {...props()} />);
    expect(input(c).placeholder).toBe('Find');
    expect(input(c).getAttribute('aria-label')).toBe('Find');
  });

  it('turns off autocorrect, autocapitalisation and spellcheck on the field', async () => {
    // A search term is not prose. macOS text substitution capitalises the first
    // letter and "corrects" words the user typed deliberately, silently
    // changing what is being searched for.
    const c = await render(<FindBar {...props()} />);
    expect(input(c).getAttribute('autocorrect')).toBe('off');
    expect(input(c).getAttribute('autocapitalize')).toBe('off');
    // The attribute, not the `spellcheck` IDL property: jsdom does not reflect
    // that one, and the attribute is what the WebView actually reads.
    expect(input(c).getAttribute('spellcheck')).toBe('false');
    expect(input(c).getAttribute('autocomplete')).toBe('off');
  });

  it('shows the count it is given', async () => {
    const c = await render(<FindBar {...props({ count: '3/7' })} />);
    expect(c.querySelector('.find-count')?.textContent).toBe('3/7');
  });

  it('reports typing as a query change without owning the value', async () => {
    const onQueryChange = vi.fn();
    const c = await render(<FindBar {...props({ onQueryChange })} />);
    const el = input(c);
    // React controlled inputs need the native value setter, not a bare
    // assignment -- React's per-node value tracker absorbs a direct `.value =`
    // write and then sees no change on the 'input' event, so the synthetic
    // onChange never fires. Same bypass as RibbonView.test.tsx / InsertPopover.test.tsx.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(el, 'cat');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onQueryChange).toHaveBeenCalledWith({ ...emptyQuery, text: 'cat' });
  });

  it('renders all three toggles, reflecting their state', async () => {
    const query: FindQuery = { text: 'a', matchCase: true, wholeWord: false, regex: false };
    const c = await render(<FindBar {...props({ query })} />);
    expect(toggle(c, 'matchCase').getAttribute('aria-pressed')).toBe('true');
    expect(toggle(c, 'wholeWord').getAttribute('aria-pressed')).toBe('false');
    expect(toggle(c, 'regex').getAttribute('aria-pressed')).toBe('false');
  });

  it('flips a toggle without disturbing the others', async () => {
    const onQueryChange = vi.fn();
    const query: FindQuery = { text: 'a', matchCase: false, wholeWord: true, regex: false };
    const c = await render(<FindBar {...props({ query, onQueryChange })} />);
    await act(async () => { toggle(c, 'regex').click(); });
    expect(onQueryChange).toHaveBeenCalledWith({ ...query, regex: true });
  });

  it('gives every toggle a plain-language accessible name', async () => {
    const c = await render(<FindBar {...props()} />);
    expect(toggle(c, 'matchCase').getAttribute('aria-label')).toBe('Match case');
    expect(toggle(c, 'wholeWord').getAttribute('aria-label')).toBe('Whole word');
    expect(toggle(c, 'regex').getAttribute('aria-label')).toBe('Regular expression');
  });

  it('navigates with the arrows', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const c = await render(<FindBar {...props({ onNext, onPrev })} />);
    await act(async () => { c.querySelector<HTMLButtonElement>('.find-next')!.click(); });
    await act(async () => { c.querySelector<HTMLButtonElement>('.find-prev')!.click(); });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('navigates with Enter and Shift-Enter', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const c = await render(<FindBar {...props({ onNext, onPrev })} />);
    await act(async () => {
      input(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      input(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('closes on the × and on Escape', async () => {
    const onClose = vi.fn();
    const c = await render(<FindBar {...props({ onClose })} />);
    await act(async () => { c.querySelector<HTMLButtonElement>('.find-close')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      input(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape from a BUTTON inside the bar, not just the field', async () => {
    // Losing focus with no way back is part of what made CodeMirror's panel
    // feel unclosable, so Escape must work from anywhere in the bar.
    const onClose = vi.fn();
    const c = await render(<FindBar {...props({ onClose })} />);
    await act(async () => {
      toggle(c, 'regex').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the field on mount and selects its contents', async () => {
    // Opening focuses the field and selects it, so typing replaces the old
    // term instead of appending to it.
    const c = await render(<FindBar {...props({ query: { ...emptyQuery, text: 'cat' } })} />);
    expect(document.activeElement).toBe(input(c));
    expect(input(c).selectionStart).toBe(0);
    expect(input(c).selectionEnd).toBe(3);
  });

  it('gives every control a className — no bare browser buttons', async () => {
    // The regression that produced the .btn primitive, and the exact defect
    // CodeMirror's own panel shipped.
    const c = await render(<FindBar {...props()} />);
    for (const b of c.querySelectorAll('button')) {
      expect(b.className, b.outerHTML).not.toBe('');
    }
  });

  it('hides the replace row unless asked for it', async () => {
    // Verify the prop actually drives the markup, not just the default state.
    const withoutReplace = await render(<FindBar {...props({ showReplace: false })} />);
    expect(withoutReplace.querySelector('.find-replace-row')).toBeNull();

    const withReplace = await render(<FindBar {...props({ showReplace: true })} />);
    expect(withReplace.querySelector('.find-replace-row')).not.toBeNull();
  });

  it('shows the replace row with a plain-language placeholder', async () => {
    const c = await render(<FindBar {...props({ showReplace: true })} />);
    const field = c.querySelector<HTMLInputElement>('.find-replace-input')!;
    expect(field.placeholder).toBe('Replace with');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
  });

  it('disables replace when the surface cannot be written to', async () => {
    // Find works in a read-only preview; replace must not.
    const c = await render(<FindBar {...props({ showReplace: true, canReplace: false })} />);
    expect(c.querySelector<HTMLInputElement>('.find-replace-input')!.disabled).toBe(true);
    expect(c.querySelector<HTMLButtonElement>('.find-replace')!.disabled).toBe(true);
    expect(c.querySelector<HTMLButtonElement>('.find-replace-all')!.disabled).toBe(true);
  });

  it('calls onReplace and onReplaceAll from the buttons', async () => {
    const onReplace = vi.fn();
    const onReplaceAll = vi.fn();
    const c = await render(<FindBar {...props({ showReplace: true, onReplace, onReplaceAll })} />);
    await act(async () => c.querySelector<HTMLButtonElement>('.find-replace')!.click());
    await act(async () => c.querySelector<HTMLButtonElement>('.find-replace-all')!.click());
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplaceAll).toHaveBeenCalledTimes(1);
  });

  it('replaces on Enter in the replace field, and does not step matches', async () => {
    const onReplace = vi.fn();
    const onNext = vi.fn();
    const c = await render(<FindBar {...props({ showReplace: true, onReplace, onNext })} />);
    const field = c.querySelector<HTMLInputElement>('.find-replace-input')!;
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  /**
   * Regression: Tab to "Replace all", press Enter -- the container's own
   * Enter handling used to call preventDefault() and, since the target
   * wasn't the replace text field, treat it as "step to the next match".
   * The button's own click never ran, so the visible effect was "nothing was
   * replaced, and the match cursor silently moved on".
   *
   * jsdom has no native "Enter activates a focused button" behaviour to
   * assert directly here (verified by probe: a bare dispatched keydown never
   * produces a click even with zero handlers in the way -- that default
   * action is real-browser UA behaviour, not something a script-dispatched
   * event triggers under jsdom). So the assertion is on the mechanism the fix
   * actually changes, which IS observable: the container handler must back
   * off entirely for a button target, calling neither its own step function
   * NOR preventDefault -- leaving a real browser's own activation free to run
   * (which is exactly what a production WKWebView does; this is standard,
   * well-established browser behaviour, just one jsdom doesn't implement).
   */
  it('backs off entirely for Enter on the Replace button, instead of stepping to the next match', async () => {
    const onNext = vi.fn();
    const onReplace = vi.fn();
    const c = await render(<FindBar {...props({ showReplace: true, onNext, onReplace })} />);
    const btn = c.querySelector<HTMLButtonElement>('.find-replace')!;
    const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { btn.dispatchEvent(evt); });
    expect(onNext).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it('backs off entirely for Enter on the Replace all button, instead of stepping to the next match', async () => {
    const onNext = vi.fn();
    const onReplaceAll = vi.fn();
    const c = await render(<FindBar {...props({ showReplace: true, onNext, onReplaceAll })} />);
    const btn = c.querySelector<HTMLButtonElement>('.find-replace-all')!;
    const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { btn.dispatchEvent(evt); });
    expect(onNext).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it('backs off for Enter on ANY button in the bar, not just Replace/Replace all', async () => {
    // The fix is a tag-name check (BUTTON), not a hardcoded list of the two
    // replace buttons -- the toggles, Prev/Next and Close are buttons too,
    // and every one of them already has its own Enter-activates-button
    // behaviour to preserve. The regex toggle stands in for all of them.
    const onNext = vi.fn();
    const c = await render(<FindBar {...props({ onNext })} />);
    const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { toggle(c, 'regex').dispatchEvent(evt); });
    expect(onNext).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });
});
