import { useEffect, useRef } from 'react';
import { EditorState, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { htmlSchema } from './htmlSchema';
import { safeAttrs } from './htmlSanitize';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { splitCommand, softBreakCommand } from '../commands/htmlStructureCommands';
import { sinkListItemCmd, liftListItemCmd } from '../commands/htmlBlockCommands';
import { goToNextCell, arrowVertical } from '../commands/htmlTableCommands';
import {
  toggleStrong, toggleEm, toggleUnderline, insertImage, canInsertImage,
} from '../commands/htmlInlineCommands';
import { writeImageIntoAssets, resolveImageDisplaySrc } from '../files/imageAssets';
import { findDecorationsPlugin } from '../find/pmSurface';
import { focusDimPlugin } from '../writingmodes/pmFocus';
import { linkClickPlugin, LINKS_ARMED_CLASS, type LinkHandlers } from '../links/linkClickPlugin';

/**
 * Edit-only fallback so an UNSTYLED table (e.g. one the user just inserted) is
 * visible and clickable in the shadow root, whose only other CSS is the file's
 * own. Injected BEFORE the file style so any author table rules win by source
 * order (these are low-specificity tag selectors). Neutral translucent border
 * reads on any light/dark file background; min-width/padding give empty cells a
 * clickable footprint. Never written back to source (render-only).
 */
const TABLE_EDIT_AFFORDANCE_CSS =
  'table{border-collapse:collapse}' +
  'th,td{border:1px solid rgba(128,128,128,0.4);min-width:2.5em;padding:0.25em 0.5em}';

/**
 * Find highlighting for the shadow render. `findbar.css` cannot reach inside a
 * shadow root, so the same rules are injected here — appended LAST, after the
 * file's own <style>. Custom properties inherit across the shadow boundary, so
 * these still resolve to Edtr's themed tokens.
 *
 * Appending last is NOT on its own enough, and it is worth being blunt about
 * why, because this comment used to claim it was: source order only decides
 * between rules of EQUAL specificity. A real file styled its `→` bullets with
 * `ul.notice li span{position:absolute;left:14px;top:11px;font-weight:800}`,
 * which at (0,1,3) beats `.edtr-find` (0,1,0) no matter what order they arrive
 * in — so the highlighted word was absolutely positioned onto the arrow and
 * disappeared from its own sentence.
 *
 * The real defence is the element name: the highlight is an `<edtr-mark>`, not
 * a `<span>` (see pmSurface), so a file's element selectors cannot reach it.
 * The `!important` resets below are the backstop for a file that reaches it
 * anyway — `li *`, `[class] *` — and they cover exactly the properties that can
 * destroy the text flow or the highlight's legibility, not everything. They are
 * scoped to `edtr-mark`, so none of this can leak onto the file's own content.
 */
const FIND_HIGHLIGHT_CSS =
  'edtr-mark.edtr-find{'
    + 'display:inline!important;position:static!important;float:none!important;'
    + 'inset:auto!important;margin:0!important;padding:0!important;'
    + 'transform:none!important;font:inherit!important;color:inherit!important;'
    + 'background:var(--find-match-bg);border-radius:var(--radius-sm)}'
  + 'edtr-mark.edtr-find-current{'
    + 'background:var(--find-current-bg);color:var(--find-current-fg)!important}';

/**
 * Focus-mode dimming for the shadow render (6c-ii). `canvas.css` cannot reach
 * inside a shadow root, so the same two rules live here too, beside the
 * `edtr-mark` backstop above — they are the same defence against the same
 * problem: a node decoration can add a class to the file's own `<p>`/`<h2>`/
 * `<li>` but cannot change its tag, so a rendered file's own selectors can
 * still out-specify a bare class.
 *
 * 1. `color` is inherited only by descendants that do not set their own, so a
 *    dimmed paragraph containing a link would keep the link bright — hence
 *    the `*`.
 * 2. That immediately over-reaches into find's highlight, which must stay
 *    legible through the dimming (spec §5.2). More specific AND important, so
 *    it wins the fight rule 1 would otherwise pick — but restoring the SHELL's
 *    `--fg` token is not enough here, unlike the light-DOM restore rule in
 *    canvas.css: HTML Live renders the file's own background, not Edtr's, so
 *    `--fg` (calibrated against Edtr's own canvas) can land as light-on-white
 *    or dark-on-black depending on the file's palette and Edtr's theme. The
 *    plain highlight's own rule above uses `color:inherit` for exactly this
 *    reason — it takes whatever colour the surrounding file content already
 *    uses — but `inherit` is unavailable to the RESTORE rule, because the
 *    parent it would inherit from is the dimmed element itself. So the
 *    restore gets the same explicit, self-contained pair the current match
 *    already has: a solid background plus a foreground calibrated to sit on
 *    it, legible regardless of the file's own colours. One rule covers both
 *    the plain and current mark, since the current mark always carries
 *    `.edtr-find` alongside `.edtr-find-current` — and scoping to `.edtr-find`
 *    (rather than the bare `edtr-mark` tag this used to be) also makes this
 *    rule's specificity (0,2,1) unambiguously beat FIND_HIGHLIGHT_CSS's
 *    `edtr-mark.edtr-find-current` (0,1,1) outright, rather than tying at
 *    equal specificity and depending on injection order to settle it.
 *
 * Hardening, not proof: a file rule with both higher specificity and
 * `!important` still wins, and no build fails when it does. Appending this
 * stylesheet last does not change that — source order only breaks ties at
 * equal specificity.
 */
/**
 * The hand over links while ⌘ is held (see `LINKS_ARMED_CLASS`). The class
 * lands on the editor's parent, which is this shadow tree's `<body>` —
 * ProseMirror mounts its own element INSIDE the node it is given — so
 * canvas.css cannot reach it. Keyed on the class alone rather than a tag, so
 * it cannot miss again if the mount point moves. `!important` because the
 * file's own CSS may well style `a { cursor }`.
 */
const LINKS_ARMED_CSS = `.${LINKS_ARMED_CLASS} a{cursor:pointer!important}`;

export const FOCUS_DIM_CSS =
  // Rule 1 — dim the block RELATIVELY, never to a fixed colour (6c-ii-b, F3).
  //
  // `currentColor` inside the `color` property resolves to the INHERITED
  // colour, so this fades the colour the file's own content is already sitting
  // in, toward whatever is behind it, rather than replacing it with one of
  // ours. The fade is an ALPHA reduction, which is what makes it independent of
  // both Edtr's theme and the file's background.
  //
  // Be precise about the limit of this, because it is easy to overclaim: an
  // element that sets its OWN colour does not keep that hue. Our `!important`
  // wins, and `currentColor` in the `color` property is the inherited value,
  // not the element's own specified one — CSS gives no way to read back a
  // colour you are overriding. So a dimmed block flattens to one faded tone,
  // exactly as it did before this change (which forced every element to one
  // flat token). What changed is that the tone is now derived from the file's
  // own inherited colour and reduced in alpha, instead of being an Edtr colour
  // chosen against Edtr's canvas. `opacity` is the only mechanism that would
  // preserve per-element hue, and it is rejected below for a harder reason.
  //
  // That is the whole fix: 6c-ii dimmed to `var(--dim-fg)`, an
  // Edtr shell token calibrated against Edtr's own canvas — but HTML Live
  // renders the FILE's canvas (forced white, see SCAFFOLD_DEFAULT_CSS). In
  // dark theme that token is a dark grey, which on white reads as ordinary
  // body text, so nothing appeared to dim at all; in light theme it is
  // mid-grey, which correctly lightens the file's dark text and DARKENS every
  // colour lighter than itself — on the benchmark file, 4 of its 5 text
  // colours. A bidirectional symptom is the signature of an absolute colour
  // imposed on a palette we do not own.
  `.edtr-dim{color:color-mix(in srgb,currentColor,transparent var(--dim-fade))!important}`
  // Rule 2 — descendants take the block's already-dimmed colour VERBATIM.
  //
  // `inherit`, emphatically NOT the same `color-mix` as rule 1: `currentColor`
  // would re-mix against the parent's already-faded value at every level, so a
  // span inside a link inside a paragraph would land at 0.32³ ≈ 3% and vanish.
  // `inherit` copies the parent's computed value exactly, so the fade applies
  // once no matter how deep the file's markup nests.
  //
  // The `*` is still required for the original reason: `color` is inherited
  // only by descendants that do not set their own, so without this a dimmed
  // paragraph containing a link would keep the link at full strength. The cost
  // is that descendants lose their individual hues inside a dimmed block —
  // which is exactly what the previous implementation did too, since it forced
  // every descendant to one flat token. No regression, and the block itself
  // now keeps its own hue where it did not before.
  + '.edtr-dim *{color:inherit!important}'
  // Rule 3 — find's highlight stays legible through the dimming (spec §5.2).
  //
  // Specificity (0,2,1) beats both rules above, so the mark is restored rather
  // than faded — which is precisely why this dim is expressed as a colour and
  // not as `opacity` on the block. Opacity would be simpler, would preserve
  // hues perfectly and would not compound, but an ancestor's opacity CANNOT be
  // undone by a descendant: this restore rule would stop working, and with it
  // the capability 6c-i shipped and matrix items 9 and 19 exist to protect. Do
  // not "simplify" this to opacity.
  //
  // The restore needs an explicit, self-contained pair rather than the shell's
  // `--fg`: the file supplies the background here, so an Edtr token calibrated
  // against Edtr's canvas can land as light-on-white or dark-on-black. That is
  // the same mistake as rule 1's, and it was fixed once already in 6c-ii's fix
  // wave for this rule while rule 1 kept it.
  + '.edtr-dim edtr-mark.edtr-find,.edtr-dim edtr-mark.edtr-find *{'
    + 'background:var(--find-current-bg)!important;color:var(--find-current-fg)!important}'
  // Rule 4 — inside a dimmed block, tell the CURRENT match apart from the rest
  // (6c-ii-b, F8/D-D).
  //
  // Rule 3 deliberately covers both, because both must be legible against a
  // background we do not control, and the one pair we know is self-contained
  // is the current match's. That left every match inside a dimmed block
  // wearing the current match's colours, so the current one was invisible
  // among them.
  //
  // This is the split Code view and Markdown Live already have, but NOT the
  // same mechanism, and the difference is the point. `canvas.css` splits them
  // by colour — the plain match restores to `var(--fg)`, Edtr's own
  // foreground. HTML Live cannot: `--fg` is calibrated against Edtr's canvas,
  // and this surface renders the FILE's canvas, so restoring to it would
  // reintroduce exactly the light-on-white / dark-on-black mistake F3 just
  // fixed one rule above. Distinguishing by a RING instead keeps both matches
  // on the one colour pair that is safe over any background, and adds the
  // distinction in a channel that does not depend on the backdrop at all.
  + '.edtr-dim edtr-mark.edtr-find-current{'
    + 'outline:2px solid var(--find-current-fg)!important;outline-offset:1px}';

/**
 * Typewriter end padding for the shadow render (6c-ii). `canvas.css` cannot
 * reach inside a shadow root, and even if it could, `pmTypewriter.ts`'s
 * `scrollerFor` puts the `edtr-typewriter` class on the LIGHT-DOM host div
 * (the `.html-live-view` element this component renders), which sits outside
 * this shadow tree entirely — no selector in here could ever match that
 * class. The custom property IS visible though:
 * it inherits across the shadow boundary the same way the find/focus tokens
 * above do, so this rule keys off the variable directly, on the in-flow
 * content element (`.ProseMirror`, matching Markdown Live's shape in
 * canvas.css) rather than the scroller. Its `, 0` fallback keeps it inert
 * whenever the mode is off — the driver REMOVES the property rather than
 * zeroing it, so an absent variable and an explicit 0 read the same way here.
 */
const TYPEWRITER_PAD_CSS = '.ProseMirror{padding-bottom:var(--edtr-end-pad, 0)}';

/**
 * Browser-default reset for the shadow render, injected FIRST (lowest priority)
 * so the file's own CSS wins by source order. It fixes two shadow-root artifacts
 * that made HTML Live unreadable in DARK mode: (1) a synthesized html/body in a
 * shadow root gets no browser "canvas" background, and (2) inherited color /
 * color-scheme leak across the host boundary from Edtr's themed shell — so a
 * light-styled file's dark text sat on a dark inherited context.
 *
 * The white canvas goes on `:host` — the host div IS the file's page/root element
 * because parse rewrites the file's `:root` selectors to `:host` — so a file that
 * themes its page via `:root`/`:host` overrides it by source order, while a file
 * that themes via `body{}`/`html{}` paints over it inside the shadow. Crucially we
 * do NOT force an opaque background on html/body: that would clobber a dark file
 * that themes only `html`/`:root` and leave its light text on forced white. The
 * text-color reset is a low-specificity `html,body` rule so any file `body{}` /
 * `html{}` color wins. (Cascade across the host boundary verified in a browser.)
 */
const SCAFFOLD_DEFAULT_CSS =
  ':host{background-color:#fff;color-scheme:light}html,body{color:#000}';

/** Empty / fully-transparent computed background — treated as "no background". */
function isTransparentColor(c: string): boolean {
  return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
}

/** Relative luminance < 0.5 ⇒ a dark surface (so we match a dark color-scheme).
 * A fully transparent color is NOT dark — the readability canvas behind it is
 * white — so `rgba(0,0,0,0)` must not be misread as black. */
function isDarkColor(c: string): boolean {
  const m = c.match(/\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) return false;
  const [r, g, b, a] = m.map(Number);
  if (a === 0) return false;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

interface HtmlLiveViewProps {
  doc: PMNode;
  styleText: string;
  bodyAttrs?: Record<string, string>;
  rootAttrs?: Record<string, string>;
  editable?: boolean;
  docPath?: string | null;
  onEdit?: (doc: PMNode, dirtyIds: Set<string>) => void;
  onViewReady?: (view: EditorView | null) => void;
  onStateChange?: (view: EditorView) => void;
  onLinkShortcut?: () => void;
  /** ⌘-click on a link, with its address as written in the document. */
  onLinkOpen?: (href: string) => void;
  /** The link under the pointer, or null once it leaves every link. */
  onLinkHover?: (href: string | null) => void;
  /** Whether a ⌘-click would really open `href`, so the hand shows only then. */
  canOpenLink?: (href: string) => boolean;
  /** Surface a non-destructive error to the consumer (e.g. a pasted-image write failure). */
  onError?: (message: string) => void;
}

/**
 * HTML Live view. Read-only (4a) or editable (4b/4d). Mounts a ProseMirror
 * view inside a shadow root and injects the file's CSS (`:root`→`:host`) plus
 * an <html>/<body> scaffold so document-scoped CSS applies. When editable,
 * wires history + mark shortcuts + Enter→split / Shift-Enter→soft-break +
 * Tab/Shift-Tab list indent/outdent (4d-ii; falls through outside a list) +
 * block-identity tracking (structural editing, 4d) + dirty tracking; edits
 * are reported via onEdit (no write-back happens here).
 */
export function HtmlLiveView({
  doc, styleText, bodyAttrs = {}, rootAttrs = {},
  editable = false, docPath = null, onEdit, onViewReady, onStateChange, onLinkShortcut, onLinkOpen, onLinkHover, canOpenLink, onError,
}: HtmlLiveViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onEditRef = useRef(onEdit); onEditRef.current = onEdit;
  const onViewReadyRef = useRef(onViewReady); onViewReadyRef.current = onViewReady;
  const onStateChangeRef = useRef(onStateChange); onStateChangeRef.current = onStateChange;
  const onLinkShortcutRef = useRef(onLinkShortcut); onLinkShortcutRef.current = onLinkShortcut;
  const linkHandlers = useRef<LinkHandlers>({ onOpen: () => {}, onHover: () => {} });
  linkHandlers.current = { onOpen: (h) => onLinkOpen?.(h), onHover: (h) => onLinkHover?.(h), canOpen: canOpenLink };
  const docPathRef = useRef(docPath); docPathRef.current = docPath;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';
    // Browser-default reset, appended FIRST (before the affordance + file style)
    // so it's the lowest-priority stylesheet and the file's own CSS wins. Both
    // read-only and editable renders need it (the dark-mode bleed-through affects
    // both). See SCAFFOLD_DEFAULT_CSS.
    const defaults = document.createElement('style');
    defaults.setAttribute('data-edtr-defaults', '');
    defaults.textContent = SCAFFOLD_DEFAULT_CSS;
    shadow.appendChild(defaults);
    // Edit-only table affordance, appended before the file's own <style>
    // (appended next) so the file wins the cascade on equal specificity.
    if (editable) {
      const affordance = document.createElement('style');
      affordance.setAttribute('data-edtr-affordance', '');
      affordance.textContent = TABLE_EDIT_AFFORDANCE_CSS;
      shadow.appendChild(affordance);
    }
    const style = document.createElement('style');
    style.textContent = styleText.replace(/:root\b/g, ':host');
    shadow.appendChild(style);

    // Appended after the file's style so the file cannot override a highlight.
    const findStyle = document.createElement('style');
    findStyle.setAttribute('data-edtr-find', '');
    findStyle.textContent = FIND_HIGHLIGHT_CSS;
    shadow.appendChild(findStyle);

    // Focus-mode dimming. Same reasoning as findStyle above — appended after
    // the file's own <style> is not the defence (see FOCUS_DIM_CSS), but it's
    // harmless to keep the two hardened rulesets adjacent in source.
    const focusStyle = document.createElement('style');
    focusStyle.setAttribute('data-edtr-focus', '');
    focusStyle.textContent = FOCUS_DIM_CSS;
    shadow.appendChild(focusStyle);

    // Typewriter end padding. See TYPEWRITER_PAD_CSS for why this can't just
    // be canvas.css's `.live-view.edtr-typewriter .ProseMirror` rule reused —
    // the class lives outside this shadow tree entirely.
    const linkStyle = document.createElement('style');
    linkStyle.setAttribute('data-edtr-links', '');
    linkStyle.textContent = LINKS_ARMED_CSS;
    shadow.appendChild(linkStyle);

    const typewriterStyle = document.createElement('style');
    typewriterStyle.setAttribute('data-edtr-typewriter', '');
    typewriterStyle.textContent = TYPEWRITER_PAD_CSS;
    shadow.appendChild(typewriterStyle);

    const applyAttrs = (el: Element, attrs: Record<string, string>) => {
      for (const [k, v] of Object.entries(safeAttrs(attrs))) {
        try { el.setAttribute(k, v); } catch { /* invalid attr name — skip */ }
      }
    };
    const htmlEl = document.createElement('html');
    applyAttrs(htmlEl, rootAttrs);
    const bodyEl = document.createElement('body');
    applyAttrs(bodyEl, bodyAttrs);
    htmlEl.appendChild(bodyEl);
    shadow.appendChild(htmlEl);

    const linkShortcut: Command = () => { onLinkShortcutRef.current?.(); return true; };
    const plugins = editable
      ? [
          history(),
          keymap({
            Enter: splitCommand,
            'Shift-Enter': softBreakCommand,
            Tab: sinkListItemCmd,
            'Shift-Tab': liftListItemCmd,
          }),
          // Table grid nav. Ordered AFTER the list keymap so list indent still
          // works inside a cell that holds a list; goToNextCell returns false
          // outside a table, so Tab falls through to normal handling.
          keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) }),
          keymap({ ArrowUp: arrowVertical('up'), ArrowDown: arrowVertical('down') }),
          keymap({
            'Mod-b': toggleStrong, 'Mod-i': toggleEm, 'Mod-u': toggleUnderline,
            'Mod-k': linkShortcut, 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
          blockIdentityPlugin(),
          dirtyTrackingPlugin(),
          // Find highlighting. Decoration only — it cannot change the document.
          findDecorationsPlugin(),
          // Focus-mode dimming. Also decoration only (6c-ii).
          focusDimPlugin(),
          // ⌘-click follows a link. Changes nothing in the document.
          linkClickPlugin(() => linkHandlers.current),
        ]
      // Find, focus mode and links must work in a read-only view too, so
      // their plugins are present here as well: an empty list means no
      // decorations and no link following at all.
      : [findDecorationsPlugin(), focusDimPlugin(), linkClickPlugin(() => linkHandlers.current)];

    const view = new EditorView(bodyEl, {
      state: EditorState.create({ doc, schema: htmlSchema, plugins }),
      editable: () => editable,
      handlePaste: (view, event) => {
        if (!editable || !docPathRef.current) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            if (!canInsertImage(view.state)) {
              onErrorRef.current?.("Can't insert an image here. Put the cursor in regular text, not in a code block.");
              return true; // consume: handled by rejecting
            }
            const dp = docPathRef.current;
            const ext = (item.type.split('/')[1] || 'png').split('+')[0]; // image/svg+xml -> svg
            file.arrayBuffer()
              .then((buf) => writeImageIntoAssets(dp, Array.from(new Uint8Array(buf)), ext))
              .then((rel) => {
                if (view.isDestroyed) return;
                const display = resolveImageDisplaySrc(rel, dp);
                insertImage(rel, null, display)(view.state, view.dispatch);
              })
              .catch((err) => {
                onErrorRef.current?.(`Edtr couldn't paste that image. ${String(err)}`);
              });
            return true;
          }
        }
        return false;
      },
      dispatchTransaction(tr) {
        const prev = view.state;
        const next = prev.apply(tr);
        view.updateState(next);
        // `apply` can return the exact same state object for a transaction
        // that produces no real change (e.g. one rejected by a plugin's
        // filterTransaction, or a genuine no-op) — gate on state identity so
        // onEdit only fires when the state actually changed.
        if (next !== prev && onEditRef.current) onEditRef.current(next.doc, getDirtyBlockIds(next));
        onStateChangeRef.current?.(view);
      },
    });
    onViewReadyRef.current?.(view);

    // Canvas-background propagation. A browser paints the viewport with the
    // root/body background; our shadow scaffold does not, so a dark-themed page
    // rendered as a dark block on the white readability canvas (SCAFFOLD_DEFAULT_
    // CSS). Mirror the page's effective background onto the host (html bg → body
    // bg → the :host default) and match color-scheme, so the whole pane goes dark
    // for a dark page and stays white for a light one. Re-run on OS appearance
    // change — the file's own @media(prefers-color-scheme) re-evaluates live.
    // NOTE: coupled to the OS scheme (= Edtr's default System theme); an explicit
    // Edtr Light/Dark override opposite the OS does not drive the file's @media
    // variants (would require rewriting its media queries — see PLAN.md follow-up).
    const syncCanvas = () => {
      const el = host.current;
      if (!el) return;
      el.style.removeProperty('background-color'); // reset so a stale mirror can't stick
      const htmlBg = getComputedStyle(htmlEl).backgroundColor;
      const bodyBg = getComputedStyle(bodyEl).backgroundColor;
      const propagated = !isTransparentColor(htmlBg)
        ? htmlBg
        : (!isTransparentColor(bodyBg) ? bodyBg : null);
      if (propagated) el.style.setProperty('background-color', propagated);
      el.style.setProperty(
        'color-scheme',
        isDarkColor(getComputedStyle(el).backgroundColor) ? 'dark' : 'light',
      );
    };
    syncCanvas();
    // jsdom has no matchMedia — guard so unit tests still mount; the browser does.
    const schemeMql = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    schemeMql?.addEventListener('change', syncCanvas);

    return () => {
      schemeMql?.removeEventListener('change', syncCanvas);
      onViewReadyRef.current?.(null);
      view.destroy();
    };
    // Mount once per doc; the parent supplies a fresh key when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="html-live-view" />;
}
