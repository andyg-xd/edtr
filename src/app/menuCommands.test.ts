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
    onQuitPoll: () => calls.push('quit-poll'),
    onQuitAbort: () => calls.push('quit-abort'),
    onOpenPayload: () => {},
    onFind: () => calls.push('find'),
    onFindNext: () => calls.push('find-next'),
    onFindPrev: () => calls.push('find-prev'),
    onReplace: () => calls.push('replace'),
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
    onQuitPoll: vi.fn(),
    onQuitAbort: vi.fn(),
    onOpenPayload: vi.fn(),
    onFind: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrev: vi.fn(),
    onReplace: vi.fn(),
  };
}

describe('dispatchMenuCommand', () => {
  it('routes each command to exactly its own handler', () => {
    const all = [
      'open', 'open-folder', 'save', 'save-as', 'close', 'quit-poll', 'quit-abort',
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

  it('routes replace to its handler', () => {
    const handlers = makeHandlers();
    dispatchMenuCommand('replace', handlers);
    expect(handlers.onReplace).toHaveBeenCalledTimes(1);
  });

  it('MENU_COMMANDS contains every command that dispatchMenuCommand handles', () => {
    const all = [
      'open', 'open-folder', 'save', 'save-as', 'close', 'quit-poll', 'quit-abort',
      'find', 'find-next', 'find-prev', 'replace',
    ] as const satisfies readonly MenuCommand[];
    expect(MENU_COMMANDS as readonly string[]).toEqual(all);
  });
});
