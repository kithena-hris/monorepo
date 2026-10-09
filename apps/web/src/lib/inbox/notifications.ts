import * as z from 'zod';

/**
 * Where a person's tasks and updates reach them (P1, M:I1): their account
 * preference `notifications`, beside the Inbox's own state. The Inbox always
 * has everything; this is only the other channels.
 *
 * Tasks can't be switched off in the Inbox (the lock), only routed: by phone
 * or not, by email now, in the daily digest, or not. Updates are switched per
 * kind and channel. Quiet hours hold the phone's notifications, except for a
 * task due that day.
 */

const Email = z.enum(['now', 'digest', 'off']);

const TaskChannels = z.object({ phone: z.boolean(), email: Email });
const UpdateChannels = z.object({ inbox: z.boolean(), phone: z.boolean(), email: Email });

export const Notifications = z.object({
  tasks: z.object({
    asked: TaskChannels.default({ phone: true, email: 'now' }),
    reminders: TaskChannels.default({ phone: true, email: 'now' }),
    handedOver: TaskChannels.default({ phone: true, email: 'now' }),
  }),
  updates: z.object({
    decided: UpdateChannels.default({ inbox: true, phone: true, email: 'digest' }),
    documents: UpdateChannels.default({ inbox: true, phone: false, email: 'digest' }),
    team: UpdateChannels.default({ inbox: true, phone: false, email: 'off' }),
    calendars: UpdateChannels.default({ inbox: true, phone: false, email: 'off' }),
  }),
  quiet: z.object({
    on: z.boolean(),
    from: z.string().regex(/^\d{2}:\d{2}$/u),
    to: z.string().regex(/^\d{2}:\d{2}$/u),
    weekends: z.boolean(),
  }),
  digestAt: z.string().regex(/^\d{2}:\d{2}$/u),
});
export type Notifications = z.infer<typeof Notifications>;

export const DEFAULT_NOTIFICATIONS: Notifications = {
  tasks: {
    asked: { phone: true, email: 'now' },
    reminders: { phone: true, email: 'now' },
    handedOver: { phone: true, email: 'now' },
  },
  updates: {
    decided: { inbox: true, phone: true, email: 'digest' },
    documents: { inbox: true, phone: false, email: 'digest' },
    team: { inbox: true, phone: false, email: 'off' },
    calendars: { inbox: true, phone: false, email: 'off' },
  },
  quiet: { on: true, from: '19:00', to: '08:00', weekends: true },
  digestAt: '09:00',
};

export function notificationsOf(value: unknown): Notifications {
  const parsed = Notifications.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATIONS;
}

/** Which of the update rows an item's kind falls under, for its channels. */
export function updateRow(kind: string): keyof Notifications['updates'] {
  if (kind === 'timeoff.holidays' || kind === 'timeoff.expiring') return 'calendars';
  if (kind === 'people.document') return 'documents';
  if (kind === 'people.team') return 'team';
  return 'decided';
}

/** The rows as the settings page names them. */
export const TASK_ROWS = [
  {
    key: 'asked',
    label: 'Someone asks you to do something',
    detail: 'Details, documents, approvals, checklists',
  },
  { key: 'reminders', label: 'Reminders before a task is due', detail: null },
  { key: 'handedOver', label: 'Tasks handed to you while someone is away', detail: null },
] as const;

export const UPDATE_ROWS = [
  { key: 'decided', label: 'Your requests are decided', detail: 'People and Time off' },
  { key: 'documents', label: 'Documents shared with you', detail: null },
  { key: 'team', label: 'Someone joins or leaves your team', detail: null },
  { key: 'calendars', label: 'Calendars and balances', detail: 'Time off' },
] as const;
