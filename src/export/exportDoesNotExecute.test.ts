/**
 * An export never executes — proven by RUNNING it, not by reading it (6c-iii).
 *
 * `htmlSourceToBody.test.ts` already asserts that the transform removes script
 * elements. This asks the question one level up and end-to-end: take a real
 * document that genuinely executes, put it through the production
 * `buildExport`, and load the artifact into a DOM **with scripting enabled**.
 * If anything still runs, the flags below are set and this fails.
 *
 * The first test is the probe, and it is the load-bearing half: it asserts the
 * fixture DOES execute before the export. Without it, a fixture that quietly
 * stopped executing — a typo in an id, a moved element — would make the second
 * test pass for the wrong reason and report safety we had not measured. This
 * is the same failure the phase has hit twice before (6c-i-b's vacuous
 * no-beautify test, 6c-ii's `toSource` spy).
 *
 * Walk item E3 was counted as passed without being run on 2026-08-25, because
 * no fixture with a body script existed. The manual fixture now lives at
 * `project-docs/testing files/body-script.html`; this test is its automated
 * twin, self-contained so the repo never depends on that folder.
 */
import { describe, it, expect } from 'vitest';
import { buildExport } from './buildExport';

/** Executes on load: sets two flags and rewrites the verdict element. */
const EXECUTING_DOCUMENT = [
  '<!DOCTYPE html>',
  '<html lang="en"><head>',
  '<title>Executes</title>',
  '<link rel="stylesheet" href="missing-stylesheet.css">',
  '<style>.styled-proof { border-left: 4px solid #2b6cb0; }</style>',
  '<scr' + 'ipt>window.headRan = true;</scr' + 'ipt>',
  '</head><body>',
  '<h1>Body script fixture</h1>',
  '<div id="verdict">The body script did NOT run.</div>',
  '<p class="styled-proof">Styling is not execution.</p>',
  // Inline handlers survive by design — a recorded scope limit, asserted below
  // so the boundary is stated by a test rather than only by a comment.
  '<p><button onclick="window.inlineRan = true">Inline</button></p>',
  '<scr' + 'ipt>window.bodyRan = true;',
  "document.getElementById('verdict').textContent = 'THE BODY SCRIPT RAN.';",
  '</scr' + 'ipt>',
  '</body></html>',
].join('\n');

interface Ran {
  headRan: boolean;
  bodyRan: boolean;
  verdict: string;
  scripts: number;
  styles: number;
  sheetLinks: number;
  onclicks: number;
}

/**
 * Load `html` in a real document that WILL run scripts, and report what
 * happened. An iframe in the suite's own jsdom environment rather than a
 * `new JSDOM(...)`: vitest already runs scripts here, so this needs no
 * dependency (and `jsdom` ships no types of its own).
 */
function run(html: string): Ran {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const w = frame.contentWindow as unknown as { headRan?: boolean; bodyRan?: boolean };
  const result: Ran = {
    headRan: !!w.headRan,
    bodyRan: !!w.bodyRan,
    verdict: doc.getElementById('verdict')?.textContent ?? '(no verdict element)',
    scripts: doc.querySelectorAll('script').length,
    styles: doc.querySelectorAll('style').length,
    sheetLinks: doc.querySelectorAll('link[rel="stylesheet"]').length,
    onclicks: doc.querySelectorAll('[onclick]').length,
  };
  frame.remove();
  return result;
}

const exportIt = async () =>
  (await buildExport({
    format: 'html',
    doc: null,
    source: EXECUTING_DOCUMENT,
    title: 'body-script',
    resolve: () => null,
  })).html;

describe('an export never executes', () => {
  it('PROBE: the fixture really does execute before it is exported', () => {
    // If this ever fails, the fixture stopped being a test of anything and the
    // assertion below is worthless — fix the fixture, do not delete this.
    const r = run(EXECUTING_DOCUMENT);
    expect(r.headRan).toBe(true);
    expect(r.bodyRan).toBe(true);
    expect(r.verdict).toContain('THE BODY SCRIPT RAN');
  });

  it('the exported artifact runs nothing, in the head or the body', async () => {
    const r = run(await exportIt());
    expect(r.headRan).toBe(false);
    expect(r.bodyRan).toBe(false);
    expect(r.verdict).toContain('did NOT run');
    expect(r.scripts).toBe(0);
  });

  it('strips the stylesheet link but keeps every style block — styling is not execution', async () => {
    const r = run(await exportIt());
    expect(r.sheetLinks).toBe(0);
    // The file's own block plus the export's stylesheet.
    expect(r.styles).toBeGreaterThan(0);
    expect(await exportIt()).toContain('.styled-proof');
  });

  it('leaves inline handlers alone — the recorded scope limit, not a defect', async () => {
    // Script ELEMENTS only. Inline `on*` attributes and `javascript:` URLs
    // survive, which is why an export is not a security boundary. Asserted so
    // that if the scope ever widens, this test is what says so.
    expect(run(await exportIt()).onclicks).toBeGreaterThan(0);
  });
});
