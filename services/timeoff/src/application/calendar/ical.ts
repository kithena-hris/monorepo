import { createHmac, timingSafeEqual } from 'node:crypto';

import { ok, type Result } from '@kithena/domain-kit';
import { PersonId, TenantId, type CalendarDate, type Instant } from '@kithena/contracts';

import { addDays } from '../../domain/days.js';
import type { Caller, Deps } from '../ports.js';
import { forbidden, notFound, refuse, transact } from '../shared.js';
import { calendarIn, type Scope } from './calendar.js';

/**
 * "Subscribe" (PRD §10.1): an iCalendar feed URL per scope, signed and
 * revocable. The token names the tenant, the person, the account and the
 * scope, and carries the person's feed version; revoking bumps the version,
 * so every token issued before stops working at once. The feed reads as that
 * person, with the same visibility as their calendar.
 */

interface Claims {
  readonly t: string;
  readonly p: string;
  readonly a: string;
  readonly s: Scope;
  readonly v: number;
}

const sign = (secret: string, body: string): string =>
  createHmac('sha256', secret).update(body).digest('base64url');

function verify(secret: string, token: string): Claims | null {
  const [body, signature] = token.split('.');
  if (body === undefined || signature === undefined) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
  } catch {
    return null;
  }
}

/** A feed token for the caller and a scope. */
export const issueFeedToken =
  (deps: Pick<Deps, 'uow' | 'feedSecret'>) =>
  (caller: Caller, scope: Scope): Promise<Result<{ token: string }>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId === null) return forbidden();
      const claims: Claims = {
        t: caller.tenantId,
        p: caller.personId,
        a: caller.accountId,
        s: scope,
        v: await tx.feeds.version(caller.personId),
      };
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return ok({ token: `${body}.${sign(deps.feedSecret, body)}` });
    });

/** Every feed the caller has issued stops working. */
export const revokeFeeds =
  (deps: Pick<Deps, 'uow'>) =>
  (caller: Caller): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (caller.personId === null) return forbidden();
      await tx.feeds.bump(caller.personId);
      return ok(undefined);
    });

const PAST_DAYS = 30;
const AHEAD_DAYS = 365;

/** The feed itself, for a calendar app polling the URL: a month back, a year ahead. */
export const calendarFeed =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId' | 'feedSecret'>) =>
  async (token: string): Promise<Result<string>> => {
    const claims = verify(deps.feedSecret, token);
    const tenant = TenantId.safeParse(claims?.t);
    const person = PersonId.safeParse(claims?.p);
    if (claims === null || !tenant.success || !person.success) {
      return refuse('INVALID_TOKEN', 'This calendar link is not valid');
    }
    const caller: Caller = {
      tenantId: tenant.data,
      accountId: claims.a,
      personId: person.data,
      correlationId: deps.newId(),
    };
    return transact(deps, tenant.data, async (tx) => {
      if ((await tx.feeds.version(person.data)) !== claims.v) {
        return refuse('INVALID_TOKEN', 'This calendar link was revoked');
      }
      const member = await tx.members.get(person.data);
      if (member === null || member.status === 'left') return notFound('Member');
      const today = deps.clock.date(member.timeZone);
      const view = await calendarIn(tx, deps, caller, {
        scope: claims.s,
        from: addDays(today, -PAST_DAYS),
        to: addDays(today, AHEAD_DAYS),
      });
      if (!view.ok) return view;
      const names = new Map(view.value.people.map((p) => [p.personId, p.displayName]));
      const types = new Map(
        (await tx.leaveTypes.list()).map((t) => [t.definition.key, t.definition.name.default]),
      );
      return ok(
        renderICal({
          name: claims.s === 'me' ? 'My time off' : 'Time off',
          stamp: deps.clock.instant(),
          events: view.value.entries.map((e) => ({
            uid: `${e.requestId}-${e.span.from}`,
            summary: `${names.get(e.personId) ?? ''} · ${
              e.shows === 'type' ? (types.get(e.leaveTypeKey) ?? e.leaveTypeKey) : 'Off'
            }${e.status === 'pending' ? ' (pending)' : ''}`,
            from: e.span.from,
            to: e.span.to,
          })),
        }),
      );
    });
  };

/** RFC 5545 text: backslash, semicolon, comma and newline escaped. */
const text = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');

const compact = (date: CalendarDate): string => date.replaceAll('-', '');

/** All-day events, CRLF line ends; `to` is the last day, inclusive. */
export function renderICal(feed: {
  readonly name: string;
  readonly stamp: Instant;
  readonly events: readonly {
    readonly uid: string;
    readonly summary: string;
    readonly from: CalendarDate;
    readonly to: CalendarDate;
  }[];
}): string {
  const stamp = `${feed.stamp.replaceAll(/[-:]/gu, '').slice(0, 15)}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kithena//Time Off//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${text(feed.name)}`,
    ...feed.events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.from)}`,
      // DTEND is exclusive for all-day events.
      `DTEND;VALUE=DATE:${compact(addDays(e.to, 1))}`,
      `SUMMARY:${text(e.summary)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
