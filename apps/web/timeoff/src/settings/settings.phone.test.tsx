import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';

import type { Frame } from '../frame';
import {
  ApprovalSettings,
  AttendanceSettings,
  DescribePolicy,
  HolidaySettings,
  LeaveType,
  LeaveTypes,
  NegativeBalance,
} from '../index';
import { underFloor } from '../test/floor';
import {
  approvals,
  attendance,
  berlinRead,
  holidays,
  leaveTypes,
  negativeBalance,
  vacationWithDraft,
} from './acme.fixture';

/**
 * Time Off's settings at 390×844 with a coarse pointer and the real
 * stylesheet, under the host's frame (Settings › Time off › page): axe over
 * the rendered page, contrast included, every tap target against the 44px
 * floor, and nothing wider than the phone.
 */

const frame = (section: string, href: string): Frame => ({
  section,
  trail: [
    { href: '/settings', label: 'Settings' },
    { href: '/settings', label: 'Time off' },
  ],
  siblings: [
    {
      label: 'Time off',
      items: [
        { href: '/settings/time-off/leave-types', label: 'Leave types', icon: 'leave' },
        { href: '/settings/time-off/holidays', label: 'Holidays', icon: 'calendar' },
        { href: '/settings/time-off/negative-balance', label: 'Negative balance', icon: 'adjust' },
        { href: '/settings/time-off/attendance', label: 'Attendance', icon: 'scheduled' },
        { href: '/settings/time-off/approvals', label: 'Approvals', icon: 'approve' },
      ].map((item) => ({ ...item, current: item.href === href })),
    },
  ],
});

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const noop = (): Promise<{ ok: true }> => Promise.resolve({ ok: true });

const screens: readonly (readonly [string, () => JSX.Element])[] = [
  [
    'leave types',
    () => (
      <LeaveTypes
        load={ready(leaveTypes())}
        frame={frame('Leave types', '/settings/time-off/leave-types')}
      />
    ),
  ],
  [
    'a policy, with its preview',
    () => (
      <LeaveType
        load={ready(vacationWithDraft())}
        onSaveDraft={noop}
        onPublish={noop}
        onPreviewAs={() => undefined}
        frame={frame('Leave types', '/settings/time-off/leave-types')}
      />
    ),
  ],
  [
    'a policy in plain words',
    () => (
      <DescribePolicy
        load={ready(berlinRead())}
        frame={frame('Leave types', '/settings/time-off/leave-types')}
      />
    ),
  ],
  [
    'negative balance',
    () => (
      <NegativeBalance
        load={ready(negativeBalance())}
        onSave={noop}
        frame={frame('Negative balance', '/settings/time-off/negative-balance')}
      />
    ),
  ],
  [
    'attendance',
    () => (
      <AttendanceSettings
        load={ready(attendance())}
        onSave={noop}
        frame={frame('Attendance', '/settings/time-off/attendance')}
      />
    ),
  ],
  [
    'approvals',
    () => (
      <ApprovalSettings
        load={ready(approvals())}
        onSave={noop}
        frame={frame('Approvals', '/settings/time-off/approvals')}
      />
    ),
  ],
  [
    'holidays, a year drafted from a list',
    () => (
      <HolidaySettings
        load={ready({
          ...holidays(),
          year: 2027,
          location: 'madrid',
          draft: {
            layerKey: 'madrid',
            layerName: 'Madrid city',
            year: 2027,
            days: [
              { date: '2027-05-15', name: 'San Isidro', confirmed: true, known: false },
              { date: '2027-11-09', name: 'La Almudena', confirmed: false, known: false },
            ],
            skipped: [],
            summary: { text: 'Read 2 days for Madrid city in 2027.', ai: true },
            ai: true,
          },
        })}
        onYear={() => undefined}
        onSaveLayer={noop}
        frame={frame('Holidays', '/settings/time-off/holidays')}
      />
    ),
  ],
  [
    'holidays',
    () => (
      <HolidaySettings
        load={ready({ ...holidays(), location: 'madrid' })}
        onYear={() => undefined}
        frame={frame('Holidays', '/settings/time-off/holidays')}
      />
    ),
  ],
];

describe('Time Off’s settings on a phone', () => {
  it.each(screens)('draws %s in one column, every target reachable', async (_name, draw) => {
    render(draw());
    const result = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    expect(underFloor(document.body)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});
