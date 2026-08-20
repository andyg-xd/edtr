import { describe, it, expect, vi } from 'vitest';
import { MENU_COMMANDS, dispatchMenuCommand, type MenuCommand, type MenuHandlers } from './menuCommands';

function tracked(): MenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpen: () => calls.push('open'),
    onOpenFolder: () => calls.push('open-folder'),
    onSave: () => calls.push('save'),
    onSaveAs: () => calls.push('save-as'),
    onCloseRequest: () => calls.push('close'),
    onPrint: () => calls.push('print'),
    onQuitPoll: () => calls.push('quit-poll'),
    onQuitAbort: () => calls.push('quit-abort'),
    onOpenPayload: () => {},
    onFind: () => calls.push('find'),
    onFindNext: () => calls.push('find-next'),
    onFindPrev: () => calls.push('find-prev'),
    onReplace: () => calls.push('replace'),
    onToggleTypewriter: () => calls.push('toggle-typewriter'),
    onToggleFocus: () => calls.push('toggle-focus'),
  };
}

/** Every MenuHandlers key as its own vi.fn() spy, for the exclusivity check below. */
function makeHandlers(): MenuHandlers {
  return {
    onOpen: vi.fn(),
    onOpenFolder: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onCloseRequest: vi.fn(),
    onPrint: vi.fn(),
    onQuitPoll: vi.fn(),
    onQuitAbort: vi.fn(),
    onOpenPayload: vi.fn(),
    onFind: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrev: vi.fn(),
    onReplace: vi.fn(),
    onToggleTypewriter: vi.fn(),
    onToggleFocus: vi.fn(),
  };
}

describe('dispatchMenuCommand', () => {
  it('routes each command to exactly its own handler', () => {
    const all = [
      'open', 'open-folder', 'save', 'save-as', 'close', 'print', 'quit-poll', 'quit-abort',
      'find', 'find-next', 'find-prev', 'replace',
    ] as const satisfies readonly MenuCommand[];
    for (const cmd of all) {
      const h = tracked();
      dispatchMenuCommand(cmd, h);
      expect(h.calls).toEqual([cmd]);
    }
  });

  it.each([
    ['find', 'onFind'],
    ['find-next', 'onFindNext'],
    ['find-prev', 'onFindPrev'],
  ] as const)('routes %s to %s and nothing else', (command, handler) => {
    const handlers = makeHandlers();
    dispatchMenuCommand(command, handlers);
    expect(handlers[handler]).toHaveBeenCalledTimes(1);
    for (const [name, fn] of Object.entries(handlers)) {
      if (name !== handler) expect(fn, name).not.toHaveBeenCalled();
    }
  });

  it('routes print to its handler and nothing else', () => {
    // ⌘P is the newest command and the one whose Rust half landed FIRST, so
    // the contract test caught it as an orphan before this existed. Named
    // explicitly rather than left to the data-driven sweep below because a
    // mis-routed print would silently print from the wrong handler.
    const handlers = makeHandlers();
    dispatchMenuCommand('print', handlers);
    expect(handlers.onPrint).toHaveBeenCalledTimes(1);
    for (const [name, fn] of Object.entries(handlers)) {
      if (name !== 'onPrint') expect(fn, name).not.toHaveBeenCalled();
    }
  });

  it('routes replace to its handler', () => {
    const handlers = makeHandlers();
    dispatchMenuCommand('replace', handlers);
    expect(handlers.onReplace).toHaveBeenCalledTimes(1);
  });

  it('every command in MENU_COMMANDS reaches exactly one handler', () => {
    // The real safety net, and deliberately DATA-DRIVEN rather than a literal
    // list. The test this replaced asserted MENU_COMMANDS equalled a hardcoded
    // array, which forced you to notice a new command but never forced it to
    // WORK: `dispatchMenuCommand` returns void, so TypeScript does not require
    // the switch to be exhaustive, and a command with no `case` is a silent
    // no-op at runtime — the ⌥⌘F failure shape.
    //
    // The Proxy means no command→handler mapping is maintained here either;
    // any handler the dispatcher calls is recorded by name, so this cannot
    // drift out of step with MenuHandlers.
    for (const cmd of MENU_COMMANDS) {
      const called: string[] = [];
      const handlers = new Proxy({} as MenuHandlers, {
        get: (_target, prop: string) => () => { called.push(prop); },
      });
      dispatchMenuCommand(cmd, handlers);
      expect(
        called,
        `"${cmd}" dispatched to no handler — add a case to dispatchMenuCommand`,
      ).toHaveLength(1);
    }
  });

  it('fails for a command that has no dispatch case (probe for the test above)', () => {
    // Proves the assertion above is not vacuous: a command name that is NOT in
    // the switch must record zero handler calls. If dispatchMenuCommand ever
    // grew a catch-all `default`, the test above would stop detecting missing
    // cases and this would fail, which is the warning we want.
    const called: string[] = [];
    const handlers = new Proxy({} as MenuHandlers, {
      get: (_target, prop: string) => () => { called.push(prop); },
    });
    dispatchMenuCommand('not-a-real-command' as MenuCommand, handlers);
    expect(called).toHaveLength(0);
  });
});
