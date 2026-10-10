import { describe, expect, it } from 'vitest';

import { InboxItem, InboxItemId } from './item.js';

const item = {
  id: 'timeoff:approval:0199a0f0-0000-7000-8000-000000000001',
  lane: 'task',
  kind: 'timeoff.approval',
  module: 'timeoff',
  area: null,
  icon: 'calendar',
  tone: null,
  title: 'Adam Novak · 28–30 Dec',
  summary: '3 working days · Holiday',
  from: { name: 'Adam Novak', personId: '22222222-2222-7222-8222-222222222222' },
  at: '2026-10-02T09:20:00.000Z',
  due: '2026-10-10',
  dueVerb: 'decide',
  status: null,
  outcome: null,
  count: null,
  team: null,
  replies: 0,
  link: '/time-off/approvals/waiting/0199a0f0-0000-7000-8000-000000000001',
  openIn: 'Time off',
  message: null,
  detail: { requestId: '0199a0f0-0000-7000-8000-000000000001' },
};

describe('the Inbox contract', () => {
  it('takes an item in the shape every module answers with', () => {
    expect(InboxItem.parse(item).id).toBe(item.id);
  });

  it('says where an item comes from in its id, and links only inside the app', () => {
    expect(InboxItemId.safeParse('people:details:42').success).toBe(true);
    expect(InboxItemId.safeParse('details-42').success).toBe(false);
    expect(InboxItem.safeParse({ ...item, link: 'https://evil.example' }).success).toBe(false);
    expect(InboxItem.safeParse({ ...item, link: '//evil.example' }).success).toBe(false);
  });
});
