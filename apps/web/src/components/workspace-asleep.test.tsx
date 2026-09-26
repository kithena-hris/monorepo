// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { WorkspaceAsleep } = await import('./workspace-asleep');

/** Structural axe; jsdom computes no styles, so contrast is Reach's own sweep. */
async function violations(container: Element): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

let calls: string[];

beforeEach(() => {
  calls = [];
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function answer(responses: { POST: () => Promise<Response>; GET: () => Promise<Response> }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: { method: 'GET' | 'POST' }) => {
      calls.push(init.method);
      return responses[init.method]();
    }),
  );
}

describe('WorkspaceAsleep', () => {
  it('says it is starting, in a live region, and passes axe', async () => {
    answer({
      POST: () => json({ ok: true, ready: false }),
      GET: () => json({ ok: true, ready: false }),
    });
    const { container } = render(<WorkspaceAsleep pollMs={10} />);
    const status = screen.getAllByRole('status')[0];
    expect(status).toHaveProperty('ariaLive', 'polite');
    expect(status?.textContent).toContain('Your workspace is asleep');
    expect(status?.textContent).toContain('Starting… (usually about 90 s)');
    expect(await violations(container)).toEqual([]);
  });

  it('wakes once, polls, and reloads the view when the router is ready', async () => {
    let polls = 0;
    answer({
      POST: () => json({ ok: true, state: 'pending', ready: false }),
      GET: () => json({ ok: true, state: 'running', ready: ++polls >= 2 }),
    });
    render(<WorkspaceAsleep pollMs={5} />);
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(calls).toEqual(['POST', 'GET', 'GET']);
  });

  it('offers to try again when the wake is refused', async () => {
    let refused = true;
    answer({
      POST: () => (refused ? json({ ok: false }, 502) : json({ ok: true, ready: true })),
      GET: () => json({ ok: true, ready: true }),
    });
    const { container } = render(<WorkspaceAsleep pollMs={5} />);
    const again = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert').textContent).toContain('Your workspace did not start');
    expect(await violations(container)).toEqual([]);

    refused = false;
    await act(async () => {
      fireEvent.click(again);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(calls).toEqual(['POST', 'POST']);
  });
});
