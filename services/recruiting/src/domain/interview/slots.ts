/**
 * Free slots without a calendar (PRD §16.4, REC-051): every interviewer
 * within their working hours, on a day they are not away, and not already in
 * an interview. Instants are UTC; each interviewer's hours are read in their
 * own zone.
 */

export interface Availability {
  readonly personId: string;
  readonly timeZone: string;
  /** Per ISO weekday ("1" Monday … "7" Sunday): [from, to) minutes from midnight. */
  readonly week: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  /** Days off, in the person's own calendar, from Time Off through the shell (PRD §28). */
  readonly away: readonly string[];
  /** Interviews they are in: [start, end) instants. */
  readonly busy: readonly (readonly [string, string])[];
}

const parts = (at: Date, timeZone: string) => {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => formatted.find((p) => p.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday,
  };
};

/** Inside the person's working hours, on a day they are not away. */
function working(person: Availability, start: Date, end: Date): boolean {
  const a = parts(start, person.timeZone);
  const b = parts(new Date(end.getTime() - 60_000), person.timeZone);
  if (a.date !== b.date || person.away.includes(a.date)) return false;
  const ranges = person.week[String(a.weekday)] ?? [];
  return ranges.some(([from, to]) => a.minutes >= from && b.minutes + 1 <= to);
}

/** Not already in an interview. */
function clear(person: Availability, start: Date, end: Date): boolean {
  return !person.busy.some(
    ([s, e]) => Date.parse(s) < end.getTime() && Date.parse(e) > start.getTime(),
  );
}

const free = (person: Availability, start: Date, end: Date): boolean =>
  working(person, start, end) && clear(person, start, end);

/** Slot starts in [from, to) where everyone is free for `minutes`, on a grid of `step` minutes. */
export function freeSlots(
  people: readonly Availability[],
  from: string,
  to: string,
  minutes: number,
  step = 30,
  notBefore?: string,
): string[] {
  const out: string[] = [];
  const first = Math.ceil(Date.parse(from) / (step * 60_000)) * step * 60_000;
  const floor = notBefore === undefined ? 0 : Date.parse(notBefore);
  for (let t = first; t + minutes * 60_000 <= Date.parse(to); t += step * 60_000) {
    if (t < floor) continue;
    const start = new Date(t);
    const end = new Date(t + minutes * 60_000);
    if (people.every((p) => free(p, start, end))) out.push(start.toISOString());
  }
  return out;
}

/**
 * The times a candidate chooses from, with the ones already taken left on
 * the grid and marked: a time inside everyone's working day that an
 * interview has since filled, or that the team said it cannot make, shows
 * greyed out rather than vanishing, so the candidate sees why it is gone.
 */
export function slotGrid(
  people: readonly Availability[],
  from: string,
  to: string,
  minutes: number,
  step = 30,
  notBefore?: string,
  takenAlready: readonly string[] = [],
): { at: string; taken: boolean }[] {
  const out: { at: string; taken: boolean }[] = [];
  const first = Math.ceil(Date.parse(from) / (step * 60_000)) * step * 60_000;
  const floor = notBefore === undefined ? 0 : Date.parse(notBefore);
  const marked = new Set(takenAlready.map((t) => new Date(t).toISOString()));
  for (let t = first; t + minutes * 60_000 <= Date.parse(to); t += step * 60_000) {
    if (t < floor) continue;
    const start = new Date(t);
    const end = new Date(t + minutes * 60_000);
    if (!people.every((p) => working(p, start, end))) continue;
    const at = start.toISOString();
    out.push({ at, taken: marked.has(at) || !people.every((p) => clear(p, start, end)) });
  }
  return out;
}

/** The working week a company starts with: Monday to Friday, 09:00 to 17:00. */
export const OFFICE_WEEK: Availability['week'] = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((d) => [d, [[540, 1020]] as const]),
);

const icsDate = (iso: string) => iso.replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
const icsText = (text: string) => text.replace(/[\\;,]/gu, (c) => `\\${c}`).replace(/\n/gu, '\\n');

/** An `.ics` invitation (RFC 5545) for an interview: the one thing sent without a calendar link. */
export function ics(input: {
  readonly uid: string;
  readonly start: string;
  readonly minutes: number;
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly organizerEmail: string;
  readonly stamp: string;
  readonly cancelled?: boolean;
  readonly sequence?: number;
  /** Whom it is sent to: named, so a mail client offers it as their invitation (Gmail's card). */
  readonly attendee?: { readonly email: string; readonly name: string };
}): string {
  const end = new Date(Date.parse(input.start) + input.minutes * 60_000).toISOString();
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kithena//Recruiting//EN',
    `METHOD:${input.cancelled === true ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `SEQUENCE:${String(input.sequence ?? 0)}`,
    `DTSTAMP:${icsDate(input.stamp)}`,
    `DTSTART:${icsDate(input.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(input.title)}`,
    `DESCRIPTION:${icsText(input.description)}`,
    ...(input.location === null ? [] : [`LOCATION:${icsText(input.location)}`]),
    `ORGANIZER:mailto:${input.organizerEmail}`,
    ...(input.attendee === undefined
      ? []
      : [
          `ATTENDEE;CN="${input.attendee.name.replace(/["\r\n]/gu, '')}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${input.attendee.email}`,
        ]),
    `STATUS:${input.cancelled === true ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
