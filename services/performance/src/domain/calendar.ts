/**
 * A session's calendar invitation (PRF-106, PRD §15.4): an `.ics` file
 * (RFC 5545) a learner's calendar can add, update and cancel. Pure.
 *
 * One event per session, its UID the session's, so a changed time arrives as
 * an update to the same event (a higher SEQUENCE) and a removed session as a
 * cancellation, rather than a second entry. Lines end in CRLF and fold at 75
 * octets, as calendar clients insist.
 */

export interface Invitation {
  readonly uid: string;
  /** Rises with every change, so a calendar knows which copy is newest. */
  readonly sequence: number;
  readonly method: 'REQUEST' | 'CANCEL';
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly url: string | null;
  readonly organizer: { readonly name: string; readonly email: string };
  readonly attendee: { readonly name: string; readonly email: string };
  readonly stamp: string;
}

/** `2026-10-17T09:00:00.000Z` → `20261017T090000Z`. */
const at = (iso: string): string =>
  new Date(iso).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');

/** Commas, semicolons, backslashes and new lines escaped as TEXT says. */
const escaped = (text: string): string =>
  text.replace(/[\\;,]/gu, (c) => `\\${c}`).replace(/\r?\n/gu, '\\n');

/** A parameter value in quotes, with nothing that could close them. */
const quoted = (text: string): string => `"${text.replace(/["\r\n]/gu, '')}"`;

/** One content line, folded at 75 octets with a leading space on each continuation. */
function folded(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let part = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(part);
      part = '';
      size = 0;
    }
    part += ch;
    size += n;
  }
  parts.push(part);
  return parts.join('\r\n ');
}

export function invitation(i: Invitation): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kithena//Performance//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${i.method}`,
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `SEQUENCE:${String(i.sequence)}`,
    `DTSTAMP:${at(i.stamp)}`,
    `DTSTART:${at(i.start)}`,
    `DTEND:${at(i.end)}`,
    `SUMMARY:${escaped(i.title)}`,
    `DESCRIPTION:${escaped(i.description)}`,
    ...(i.location === null ? [] : [`LOCATION:${escaped(i.location)}`]),
    ...(i.url === null ? [] : [`URL:${i.url}`]),
    `ORGANIZER;CN=${quoted(i.organizer.name)}:mailto:${i.organizer.email}`,
    `ATTENDEE;CN=${quoted(i.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${i.attendee.email}`,
    `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(folded).join('\r\n')}\r\n`;
}
