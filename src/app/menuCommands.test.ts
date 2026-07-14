import { describe, it, expect } from 'vitest';
import { dispatchMenuCommand, type MenuCommand, type MenuHandlers } from './menuCommands';

function tracked(): MenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onOpen: () => calls.push('open'),
    onOpenFolder: () => calls.push('open-folder'),
    onSave: () => calls.push('save'),
    onCloseRequest: () => calls.push('close'),
    onQuitPoll: () => calls.push('quit-poll'),
    onQuitAbort: () => calls.push('quit-abort'),
    onOpenPayload: () => {},
  };
}

describe('dispatchMenuCommand', () => {
  it('routes each command to exactly its own handler', () => {
    const all = ['open', 'open-folder', 'save', 'close', 'quit-poll', 'quit-abort'] as const satisfies readonly MenuCommand[];
    for (const cmd of all) {
      const h = tracked();
      dispatchMenuCommand(cmd, h);
      expect(h.calls).toEqual([cmd]);
    }
  });
});
