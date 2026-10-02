import { TooltipProvider } from '@reach/ui';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { onScreen, scrollOver, scrollUntilOnScreen } from '../test/scroll';
import { ImportModal } from './import-flow';
import { EXPORT_MAPPING } from './import.fixture';

/**
 * A file exported from here, mapped back in the import’s modal: 23 columns, so the mapping is
 * taller than the screen. Run twice, by the `phone` project (390 wide, a
 * finger) and the `desk` project (a mouse, at 1280 and at 1440).
 *
 * The scroll starts on top of the table, where a person's pointer is, and
 * goes through Chromium’s own input, so the modal’s body has to actually move: a
 * table that swallowed the wheel left the last columns out of reach while
 * every DOM query still found them.
 */
const coarse = matchMedia('(pointer: coarse)').matches;
const sizes = coarse
  ? [{ width: 390, height: 844 }]
  : [
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ];
const ok = () => Promise.resolve({ ok: true as const });

afterEach(async () => {
  window.scrollTo(0, 0);
  await page.viewport(sizes[0]?.width ?? 390, sizes[0]?.height ?? 844);
});

describe(`mapping a 23-column file ${coarse ? 'with a finger' : 'with a mouse'}`, () => {
  it.each(sizes)('reaches the last column and its picker at $width wide', async (size) => {
    await page.viewport(size.width, size.height);
    render(
      <TooltipProvider>
        <ImportModal
          flow={{
            load: { status: 'ready', data: EXPORT_MAPPING },
            onUpload: ok,
            propose: () => new Promise(() => undefined),
            plan: () => new Promise(() => undefined),
            run: ok,
            onDownloadBlocked: vi.fn(),
            onBack: vi.fn(),
          }}
          onClose={vi.fn()}
        />
      </TooltipProvider>,
    );
    const table = screen.getByRole('region', { name: 'Columns' });
    const last = screen.getByRole('combobox', { name: '__missing_required goes to' });
    expect(screen.getAllByRole('combobox')).toHaveLength(23);
    expect(onScreen(last)).toBe(false);

    // The file's last column, its row in the mapping whole on screen.
    const row = within(table).getByRole('row', { name: /__missing_required/ });
    // The modal in place first: it slides up from the bottom as it opens.
    // (The skeleton's shimmer never ends, so only what does.)
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    );
    // From wherever the hand is on the modal: over the plan, then the table.
    expect(await scrollUntilOnScreen(screen.getByRole('dialog'), row)).toBe(true);
    expect(onScreen(last)).toBe(true);
    // Nothing pushes the page sideways to get there.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await userEvent.click(last);
    const list = await screen.findByRole('listbox');
    // Portalled: on screen whole, clipped by no scroll container on the way.
    expect(onScreen(list)).toBe(true);
    // And the list scrolls itself, from on top of it, by wheel or by finger.
    const box = [list, ...list.querySelectorAll('*')].find(
      (el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible',
    );
    expect(box).toBeDefined();
    await Promise.all(list.getAnimations({ subtree: true }).map((a) => a.finished));
    await scrollOver(list, 200);
    expect(box?.scrollTop).toBeGreaterThan(0);
    await userEvent.click(within(list).getByRole('option', { name: 'Hometown' }));
    await expect.poll(() => screen.queryByRole('listbox')).toBeNull();
    expect(last).toHaveTextContent('Hometown');
  });
});
