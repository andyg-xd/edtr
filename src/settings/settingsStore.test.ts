import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: () => ({ listen: vi.fn() }) }));

import { saveCodeWrap, saveTheme } from './settingsStore';

beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));

describe('settings commands', () => {
  it('saveCodeWrap invokes set_code_wrap with { enabled }', async () => {
    await saveCodeWrap(false);
    expect(invoke).toHaveBeenCalledWith('set_code_wrap', { enabled: false });
  });

  it('saveTheme invokes set_theme with { mode }', async () => {
    await saveTheme('dark');
    expect(invoke).toHaveBeenCalledWith('set_theme', { mode: 'dark' });
  });
});
