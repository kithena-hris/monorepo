import { describe, expect, it } from 'vitest';

import { approvalsMessage, fillView, noticeMessage, savedView, valuesOf, type Approval } from './blocks.js';

const approval = (id: string): Approval => ({
  id,
  name: 'Pam <!channel>',
  label: 'Phone',
  from: 'nothing',
  to: '555',
  requestedBy: 'Jim',
  reason: 'New number',
  effectiveFrom: '2026-10-01',
});

const json = (v: unknown) => JSON.stringify(v);

describe('approvalsMessage', () => {
  it('gives each change its own Approve and Reject, and never lets a name ping a channel', () => {
    const m = approvalsMessage([approval('a'), approval('b')], 'https://acme/approvals');
    expect(m.text).toBe('2 changes are waiting for your approval.');
    expect(json(m.blocks)).toContain('"action_id":"approve","style":"primary","text":{"type":"plain_text","text":"Approve"');
    expect(json(m.blocks)).toContain('"value":"b"');
    // Plain text never pings; mrkdwn would, so a name there is escaped.
    const marked = m.blocks.filter((b) => b['type'] === 'section').map((b) => json(b['text']));
    expect(marked.join('')).not.toContain('<!channel>');
    expect(json(m.blocks)).toContain('1 October 2026');
  });

  it('lists five and sends the rest to the inbox', () => {
    const many = Array.from({ length: 7 }, (_, i) => approval(String(i)));
    const m = approvalsMessage(many, 'https://acme/approvals');
    expect(m.blocks.filter((b) => b['type'] === 'actions').length).toBe(6);
    expect(json(m.blocks)).toContain('See all 7 in Kithena');
  });

  it('says so when nothing is left', () => {
    expect(approvalsMessage([], 'u', 'Approved.').text).toBe(
      'Approved. You are all caught up. Nothing is waiting for your approval.',
    );
  });
});

describe('noticeMessage', () => {
  it('asks for details with a button that opens the form here', () => {
    const m = noticeMessage({ event: 'details_requested', url: 'https://acme/people', count: 3 });
    expect(m.text).toMatch(/asked you for 3 details/);
    expect(json(m.blocks)).toContain('"action_id":"fill"');
  });

  it('says a rejection kindly and points at why', () => {
    const m = noticeMessage({ event: 'approval_decided', decision: 'rejected', url: 'u' });
    expect(m.text).toMatch(/not approved/);
  });
});

describe('fillView', () => {
  it('draws each type as its own control, the asked-for ones first as given', () => {
    const view = fillView(
      {
        fields: [
          { key: 'start', label: 'Start', description: null, dataType: 'date', options: [], required: true, requested: true, value: null },
          { key: 'remote', label: 'Remote', description: 'Most days', dataType: 'boolean', options: [], required: false, requested: false, value: null },
          { key: 'team', label: 'Team', description: null, dataType: 'select', options: [{ value: 's', label: 'Sales' }], required: false, requested: false, value: 's' },
        ],
        elsewhere: ['Passport'],
      },
      'u',
    );
    const text = json(view);
    expect(text).toContain('"block_id":"start","optional":false,"label":{"type":"plain_text","text":"Start (asked for)"');
    expect(text).toContain('"type":"datepicker"');
    expect(text).toContain('"initial_option":{"text":{"type":"plain_text","text":"Sales","emoji":true},"value":"s"}');
    expect(text).toContain('added in Kithena: Passport');
    expect(view['submit']).toBeDefined();
  });

  it('thanks somebody with nothing left to give, and has no Save', () => {
    const view = fillView({ fields: [], elsewhere: [] }, 'u');
    expect(view['submit']).toBeUndefined();
    expect(json(view)).toContain('You are all set');
    expect(json(savedView(2))).toContain('All 2 details are saved');
  });
});

describe('valuesOf', () => {
  it('reads every control back by field', () => {
    expect(
      valuesOf({
        a: { value: { type: 'plain_text_input', value: 'x' } },
        b: { value: { type: 'datepicker', selected_date: '2026-01-02' } },
        c: { value: { type: 'static_select', selected_option: { value: 'true' } } },
        d: { value: { type: 'multi_static_select', selected_options: [{ value: 'en' }] } },
        e: { value: { type: 'static_select', selected_option: null } },
      }),
    ).toEqual({ a: 'x', b: '2026-01-02', c: 'true', d: ['en'], e: null });
  });

  it('reads nothing but field keys, so a crafted block id reaches no prototype', () => {
    const values = valuesOf(
      JSON.parse('{"__proto__":{"value":{"value":"x"}},"constructor":{"value":{"value":"y"}},"Bad-Key":{"value":{"value":"z"}},"ok":{"value":{"value":"1"}}}') as never,
    );
    expect(values).toEqual({ ok: '1' });
    expect(({} as Record<string, unknown>)['value']).toBeUndefined();
  });
});
