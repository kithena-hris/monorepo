import { beforeEach, describe, expect, it, vi } from 'vitest';

const writePreference = vi.fn(
  (): Promise<'saved' | 'view_only' | 'failed'> => Promise.resolve('saved'),
);
vi.mock('../../../../lib/preferences', () => ({ writePreference }));

const { saveShortcuts } = await import('./actions');

beforeEach(() => {
  writePreference.mockClear();
});

/**
 * The server's own check: whatever the page said, a clash, a key the browser
 * owns, a fixed key or something unreadable is never stored.
 */
describe('saving shortcuts', () => {
  it('stores a set that clashes with nothing, for the signed-in person', async () => {
    const prefs = { bindings: { 'go.home': ['g', 'z'] }, characterKeys: true };
    expect(await saveShortcuts(prefs, false)).toEqual({ ok: true });
    expect(writePreference).toHaveBeenCalledWith('shortcuts', prefs);
  });

  it('refuses a clash the page did not catch, with the page’s sentence, and stores nothing', async () => {
    const refused = [
      [{ 'go.home': ['g', 'd'] }, 'G then D already opens Directory. Choose another.'],
      [{ 'page.search': ['g'] }, 'G starts G then H, which opens Home. Choose another.'],
      [{ 'go.home': ['mod+q'] }, '⌘Q belongs to your browser or computer. Choose another.'],
      [{ 'go.home': ['?'] }, '? already shows the keyboard shortcuts. Choose another.'],
      [{ sidebar: ['mod+e'] }, '⌘\\ cannot be changed.'],
    ] as const;
    for (const [bindings, message] of refused) {
      expect(await saveShortcuts({ bindings, characterKeys: true }, true)).toEqual({
        ok: false,
        message,
      });
    }
    expect(
      await saveShortcuts({ bindings: { 'go.home': ['g', 'h', 'x'] }, characterKeys: true }, false),
    ).toEqual({ ok: false, message: 'Those keys could not be read. Try again.' });
    expect(writePreference).not.toHaveBeenCalled();
  });

  it('says why when an administrator viewing as this person tries (identity refuses it)', async () => {
    writePreference.mockResolvedValueOnce('view_only');
    expect(await saveShortcuts({ bindings: {}, characterKeys: false }, false)).toEqual({
      ok: false,
      message: 'You are viewing as somebody else, so nothing can be changed.',
    });
  });

  it('says so when identity could not keep them', async () => {
    writePreference.mockResolvedValueOnce('failed');
    expect(await saveShortcuts({ bindings: {}, characterKeys: false }, false)).toEqual({
      ok: false,
      message: 'Your shortcuts could not be saved just now. Try again.',
    });
  });
});
