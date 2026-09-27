/**
 * What Kithena looks like in Slack: the messages it sends and the form it
 * opens, as Block Kit. Pure — data in, JSON out — so every message can be
 * read in a test before anybody receives it.
 *
 * Written to be read on a phone between two other things: one sentence that
 * says what happened, what it is about, and the one button that finishes it.
 */

export type NoticeEvent =
  | 'approval_requested'
  | 'approval_decided'
  | 'approval_expired'
  | 'correction_requested'
  | 'details_requested'
  | 'profile_reminder';

export interface Notice {
  readonly event: NoticeEvent;
  readonly url: string;
  readonly decision?: 'approved' | 'rejected';
  readonly count?: number;
}

export interface Approval {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly effectiveFrom: string;
}

export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  readonly requested: boolean;
  readonly value: string | readonly string[] | null;
}

export interface Form {
  readonly fields: readonly FormField[];
  readonly elsewhere: readonly string[];
}

type Block = Record<string, unknown>;
export interface Message {
  /** What a notification and a screen reader say. */
  readonly text: string;
  readonly blocks: readonly Block[];
}

/** Slack's plain text, cut to what the element allows. */
const plain = (text: string, max = 150) => ({
  type: 'plain_text',
  text: text.length > max ? `${text.slice(0, max - 1)}…` : text,
  emoji: true,
});
const mrkdwn = (text: string) => ({ type: 'mrkdwn', text: text.slice(0, 3000) });
/** Words from a person, shown as words: no mentions, no links, no formatting. */
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const openButton = (url: string, text = 'Open in Kithena') => ({
  type: 'button',
  action_id: 'open',
  text: plain(text),
  url,
});

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** The most a message lists before it says "and more". */
export const MOST_APPROVALS = 5;

export function approvalBlocks(approval: Approval): readonly Block[] {
  const lines = [
    `*${escape(approval.name)}* · ${escape(approval.label)}`,
    `${escape(approval.from)} → *${escape(approval.to)}*`,
  ];
  if (approval.reason !== null) lines.push(`> ${escape(approval.reason)}`);
  return [
    { type: 'section', text: mrkdwn(lines.join('\n')) },
    {
      type: 'context',
      elements: [
        mrkdwn(`Asked by ${escape(approval.requestedBy)} · takes effect ${day(approval.effectiveFrom)}`),
      ],
    },
    {
      type: 'actions',
      block_id: `approval:${approval.id}`,
      elements: [
        {
          type: 'button',
          action_id: 'approve',
          style: 'primary',
          text: plain('Approve'),
          value: approval.id,
        },
        {
          type: 'button',
          action_id: 'reject',
          style: 'danger',
          text: plain('Reject'),
          value: approval.id,
          confirm: {
            title: plain('Reject this change?'),
            text: plain(
              `${approval.name}'s ${approval.label} stays as it is, and ${approval.requestedBy} is told.`,
              300,
            ),
            confirm: plain('Reject'),
            deny: plain('Keep it'),
            style: 'danger',
          },
        },
      ],
    },
  ];
}

/** What waits for this person's decision, each with its buttons. */
export function approvalsMessage(
  approvals: readonly Approval[],
  url: string,
  said: string | null = null,
): Message {
  const shown = approvals.slice(0, MOST_APPROVALS);
  const more = approvals.length - shown.length;
  const text =
    approvals.length === 0
      ? 'You are all caught up. Nothing is waiting for your approval.'
      : approvals.length === 1
        ? 'One change is waiting for your approval.'
        : `${String(approvals.length)} changes are waiting for your approval.`;
  const blocks: Block[] = [];
  if (said !== null) blocks.push({ type: 'context', elements: [mrkdwn(said)] });
  blocks.push({ type: 'section', text: mrkdwn(text) });
  for (const a of shown) blocks.push({ type: 'divider' }, ...approvalBlocks(a));
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [openButton(url, more > 0 ? `See all ${String(approvals.length)} in Kithena` : 'Open approvals')],
  });
  return { text: said === null ? text : `${said} ${text}`, blocks };
}

/** Ask for details, with the button that opens the form right here. */
function detailsMessage(text: string, url: string): Message {
  return {
    text,
    blocks: [
      { type: 'section', text: mrkdwn(text) },
      {
        type: 'actions',
        elements: [
          { type: 'button', action_id: 'fill', style: 'primary', text: plain('Fill them in') },
          openButton(url),
        ],
      },
    ],
  };
}

function simple(text: string, url: string, button = 'Open in Kithena'): Message {
  return {
    text,
    blocks: [
      { type: 'section', text: mrkdwn(text) },
      { type: 'actions', elements: [openButton(url, button)] },
    ],
  };
}

/** A notice as its message. An approval request is drawn from what waits, separately. */
export function noticeMessage(notice: Notice): Message {
  const n = notice.count ?? 0;
  switch (notice.event) {
    case 'approval_requested':
      return simple('A change is waiting for your approval.', notice.url, 'Open approvals');
    case 'approval_decided':
      return notice.decision === 'rejected'
        ? simple(
            'Your change was not approved, so the record stays as it was. Kithena has the note on why, if one was left.',
            notice.url,
            'See why',
          )
        : simple('Good news: your change was approved and is now on the record.', notice.url);
    case 'approval_expired':
      return simple(
        'A change you asked for expired before anyone decided on it. You can ask for it again whenever you are ready.',
        notice.url,
      );
    case 'correction_requested':
      return simple(
        'HR took a look at a detail you gave and asked you to correct it. It only takes a minute on your profile.',
        notice.url,
        'Correct it',
      );
    case 'details_requested':
      return detailsMessage(
        n > 1
          ? `Hi! Your HR team asked you for ${String(n)} details. You can fill them in right here.`
          : 'Hi! Your HR team asked you for a detail. You can fill it in right here.',
        notice.url,
      );
    case 'profile_reminder':
      return detailsMessage(
        n > 1
          ? `A friendly nudge: ${String(n)} details are still missing from your profile. You can add them right here.`
          : 'A friendly nudge: one detail is still missing from your profile. You can add it right here.',
        notice.url,
      );
  }
}

/* --------------------------------------------------------------- form -- */

const option = (value: string, label: string) => ({ text: plain(label, 75), value: value.slice(0, 150) });

function element(field: FormField): Block {
  const text = typeof field.value === 'string' ? field.value : null;
  const list = Array.isArray(field.value) ? (field.value as readonly string[]) : [];
  const base = { action_id: 'value' };
  switch (field.dataType) {
    case 'long_text':
      return { ...base, type: 'plain_text_input', multiline: true, max_length: 2000, ...(text ? { initial_value: text } : {}) };
    case 'number':
    case 'decimal':
    case 'percentage':
      return {
        ...base,
        type: 'number_input',
        is_decimal_allowed: field.dataType !== 'number',
        ...(text ? { initial_value: text } : {}),
      };
    case 'email':
      return { ...base, type: 'email_text_input', ...(text ? { initial_value: text } : {}) };
    case 'url':
      return { ...base, type: 'url_text_input', ...(text ? { initial_value: text } : {}) };
    case 'date':
      return {
        ...base,
        type: 'datepicker',
        ...(text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? { initial_date: text } : {}),
      };
    case 'boolean':
      return {
        ...base,
        type: 'static_select',
        placeholder: plain('Choose'),
        options: [option('true', 'Yes'), option('false', 'No')],
      };
    case 'select': {
      const options = field.options.slice(0, 100).map((o) => option(o.value, o.label));
      const initial = options.find((o) => o.value === text);
      return {
        ...base,
        type: 'static_select',
        placeholder: plain('Choose'),
        options,
        ...(initial ? { initial_option: initial } : {}),
      };
    }
    case 'multi_select': {
      const options = field.options.slice(0, 100).map((o) => option(o.value, o.label));
      const initial = options.filter((o) => list.includes(o.value));
      return {
        ...base,
        type: 'multi_static_select',
        placeholder: plain('Choose any'),
        options,
        ...(initial.length > 0 ? { initial_options: initial } : {}),
      };
    }
    default:
      return { ...base, type: 'plain_text_input', max_length: 500, ...(text ? { initial_value: text } : {}) };
  }
}

/** The most fields one form asks for; the rest wait for the next one, or the app. */
export const MOST_FIELDS = 20;

/** The form for a person's own details: the ones asked for first. */
export function fillView(form: Form, url: string): Block {
  const fields = form.fields.slice(0, MOST_FIELDS);
  const blocks: Block[] = [];
  if (fields.length === 0) {
    blocks.push({
      type: 'section',
      text: mrkdwn(
        form.elsewhere.length === 0
          ? 'You are all set. Nothing is missing from your profile. Thank you!'
          : `Nothing more to fill in here. ${escape(form.elsewhere.join(', '))} ${plural(form.elsewhere.length, 'needs', 'need')} a file or an address, so ${plural(form.elsewhere.length, 'it is', 'they are')} added in Kithena.`,
      ),
    });
    if (form.elsewhere.length > 0) blocks.push({ type: 'actions', elements: [openButton(url)] });
    return {
      type: 'modal',
      callback_id: 'fill',
      title: plain('Your details', 24),
      close: plain('Close', 24),
      blocks,
    };
  }
  blocks.push({
    type: 'context',
    elements: [mrkdwn('Saved to your Kithena profile, exactly as if you had filled it in there.')],
  });
  for (const f of fields) {
    blocks.push({
      type: 'input',
      block_id: f.key,
      optional: !f.required,
      label: plain(f.requested ? `${f.label} (asked for)` : f.label, 2000),
      ...(f.description === null ? {} : { hint: plain(f.description, 2000) }),
      element: element(f),
    });
  }
  const later = [...form.elsewhere, ...form.fields.slice(MOST_FIELDS).map((f) => f.label)];
  if (later.length > 0) {
    blocks.push({
      type: 'context',
      elements: [mrkdwn(`Also missing, and added in Kithena: ${escape(later.join(', '))}.`)],
    });
  }
  return {
    type: 'modal',
    callback_id: 'fill',
    title: plain('Your details', 24),
    submit: plain('Save', 24),
    close: plain('Cancel', 24),
    blocks,
  };
}

/** The answer after saving: said, and closed with the next button press. */
export function savedView(saved: number): Block {
  return {
    type: 'modal',
    title: plain('Your details', 24),
    close: plain('Done', 24),
    blocks: [
      {
        type: 'section',
        text: mrkdwn(
          saved === 0
            ? 'Nothing was changed.'
            : `Thanks! ${plural(saved, 'Your detail is', `All ${String(saved)} details are`)} saved to your profile.`,
        ),
      },
    ],
  };
}

type StateValue = {
  readonly type?: string;
  readonly value?: string | null;
  readonly selected_date?: string | null;
  readonly selected_option?: { readonly value: string } | null;
  readonly selected_options?: readonly { readonly value: string }[];
};

/** A field's key, as People names them: the only block ids a form of ours has. */
const FIELD_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const NEVER = new Set(['constructor', 'prototype']);

/**
 * A submitted form's values, by field. Only block ids shaped like a field key
 * are read, and the result is built from entries rather than by assignment,
 * so a payload naming `__proto__` or `constructor` reaches nothing.
 */
export function valuesOf(
  state: Readonly<Record<string, Readonly<Record<string, StateValue>>>>,
): Record<string, string | readonly string[] | null> {
  const entries: [string, string | readonly string[] | null][] = [];
  for (const [key, actions] of Object.entries(state)) {
    if (!FIELD_KEY.test(key) || NEVER.has(key)) continue;
    const v = actions['value'];
    if (v === undefined) continue;
    entries.push([
      key,
      v.selected_options !== undefined
        ? v.selected_options.map((o) => o.value)
        : v.selected_option !== undefined
          ? (v.selected_option?.value ?? null)
          : v.selected_date !== undefined
            ? (v.selected_date ?? null)
            : (v.value ?? null),
    ]);
  }
  return Object.fromEntries(entries);
}
