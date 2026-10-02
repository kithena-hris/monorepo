// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
// Stable, as Next's own router is.
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { Waking, WakingHeader } = await import('./waking');

/** Structural axe; jsdom computes no styles, so contrast is Reach's own sweep. */
async function violations(container: Element): Promise<string[]> {
  vi.useRealTimers();
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

// React schedules a transition's render on the real `setImmediate` it found
// at import, which fake timers do not reach: each step yields to it too.
const realImmediate = globalThis.setImmediate;
const advance = async (ms: number): Promise<void> => {
  for (let left = ms; left >= 0; left -= 250) {
    // oxlint-disable-next-line no-await-in-loop -- one step after another, as time passes
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(250, left));
      await new Promise((resolve) => realImmediate(resolve));
    });
  }
};

let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  hidden = false;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const frame = {
  section: 'Data health',
  trail: [{ href: '/people', label: 'People' }],
  tabs: [
    { href: '/people/data-health/completeness', label: 'Completeness', current: true },
    { href: '/people/data-health/duplicates', label: 'Duplicates', current: false },
  ],
};

describe('Waking', () => {
  it('says what is happening, in the page’s shape, and passes axe', async () => {
    const { container } = render(
      <Waking area="People" waking header={<WakingHeader frame={frame} title="People" />} />,
    );
    await advance(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Data health' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Duplicates' })).toBeTruthy();
    expect(screen.getByText('Waking up People, usually under a minute')).toBeTruthy();
    expect(screen.getByText(/The server sleeps when nobody is using it/)).toBeTruthy();
    await advance(42_000);
    expect(screen.getByText(/Waiting 0:42/)).toBeTruthy();
    // The live region says nothing yet: neither the clock nor a retry is announced.
    const live = container.querySelector('p[role="status"]');
    expect(live?.textContent).toBe('');
    expect(await violations(container)).toEqual([]);
  });

  it('asks again after 2 s, 3 s, 5 s, then every 5 s', async () => {
    render(<Waking area="People" waking />);
    const at: number[] = [];
    const began = Date.now();
    refresh.mockImplementation(() => at.push(Date.now() - began));
    await advance(25_000);
    expect(at).toEqual([2_000, 5_000, 10_000, 15_000, 20_000, 25_000]);
  });

  it('stops while the tab is hidden, and goes on when it is shown', async () => {
    render(<Waking area="People" waking />);
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await advance(20_000);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the page in place when it is ready, and says so once', async () => {
    const { container, rerender } = render(<Waking area="People" waking />);
    await advance(2_000);
    rerender(
      <Waking area="People" waking={false}>
        <p>The directory</p>
      </Waking>,
    );
    await advance(0);
    expect(screen.getByText('The directory')).toBeTruthy();
    expect(screen.queryByText(/Waking up/)).toBeNull();
    expect(container.querySelector('p[role="status"]')?.textContent).toBe('People is ready');
    refresh.mockReset();
    await advance(20_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('is nothing but the page when it was never waking', () => {
    const { container } = render(
      <Waking area="People" waking={false}>
        <p>The directory</p>
      </Waking>,
    );
    expect(container.innerHTML).toBe('<p>The directory</p>');
  });

  it('after three minutes says it is taking longer, stops, and tries again when asked', async () => {
    const { container } = render(<Waking area="People" waking />);
    await advance(180_000);
    expect(screen.getByText('This is taking longer than usual')).toBeTruthy();
    const calls = refresh.mock.calls.length;
    await advance(30_000);
    expect(refresh.mock.calls.length).toBe(calls);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });
    expect(refresh.mock.calls.length).toBe(calls + 1);
    expect(screen.queryByText('This is taking longer than usual')).toBeNull();
    expect(await violations(container)).toEqual([]);
  });
});
