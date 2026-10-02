import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { withArrived } = await import('./people-screens');

describe('withArrived', () => {
  it('puts a streamed part that has arrived in place, and leaves one on its way to stream', async () => {
    const arrived = Promise.resolve(null);
    const coming = new Promise(() => undefined);
    const load = await withArrived({
      status: 'ready',
      data: { canImport: true, history: arrived, later: coming },
    });
    expect(load).toEqual({
      status: 'ready',
      data: { canImport: true, history: null, later: coming },
    });
    expect((load as { data: { later: unknown } }).data.later).toBe(coming);
  });

  it('leaves anything else as it is', async () => {
    const error = { status: 'error', message: 'down' } as const;
    expect(await withArrived(error)).toBe(error);
  });
});
