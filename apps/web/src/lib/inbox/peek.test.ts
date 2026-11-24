import { describe, expect, it } from 'vitest';

import type { Shown } from './model';
import { peekOf } from './peek';

const task = {
  id: 'people:setup:a',
  lane: 'task',
  counted: true,
  due: null,
  at: '2026-11-24T10:00:00.000Z',
  detail: { queues: [] },
  message: 'A note',
} as unknown as Shown;
const read = {
  items: [task],
  counts: { todo: 1, updates: 0, requests: 0 },
  now: '2026-11-24T12:00:00.000Z',
  zone: 'UTC',
};

describe('peekOf', () => {
  it('leaves what a row opens to out of the chrome’s rows', () => {
    expect(peekOf(read).todo[0]).toMatchObject({ id: task.id, detail: null, message: null });
  });

  it('keeps Home’s rows whole, so a task opens from what Home holds', () => {
    expect(peekOf(read, 200, true).todo[0]).toBe(task);
  });
});
