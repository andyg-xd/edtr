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
    onQuitRequest: () => calls.push('quit'),
  };
}

describe('dispatchMenuCommand', () => {
  it('routes each command to exactly its own handler', () => {
    for (const cmd of ['open', 'open-folder', 'save', 'close', 'quit'] as const satisfies readonly MenuCommand[]) {
      const h = tracked();
      dispatchMenuCommand(cmd, h);
      expect(h.calls).toEqual([cmd]);
    }
  });
});
