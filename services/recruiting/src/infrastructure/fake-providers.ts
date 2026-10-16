import { ok } from '@kithena/domain-kit';

import { pointing } from '../domain/careers/domain.js';
import type {
  AssessmentProvider,
  BackgroundCheckProvider,
  Connection,
  DomainHost,
} from '../application/ports.js';

/**
 * Stand-ins for the assessment and background-check providers (PRD §15.3,
 * §17.2), until a company chooses and pays for one. Never in production:
 * composition uses them only when `RECRUITING_FAKE_PROVIDERS` is set outside
 * it. An assessment finishes on the first look with a fixed score; a check
 * comes back clear.
 */
export function fakeAssessments(origin = 'https://assessments.example'): AssessmentProvider {
  return {
    name: 'fake',
    invite: ({ applicationId, packageKey }) =>
      Promise.resolve(
        ok({ externalId: `a-${applicationId}`, url: `${origin}/${packageKey}/${applicationId}` }),
      ),
    result: (externalId) =>
      Promise.resolve({ scoreBp: 7_200, reportUrl: `${origin}/reports/${externalId}` }),
  };
}

export function fakeBackgroundChecks(): BackgroundCheckProvider {
  return {
    name: 'fake',
    start: ({ applicationId }) => Promise.resolve(ok({ externalId: `b-${applicationId}` })),
    status: () => Promise.resolve('clear'),
  };
}

/** A careers domain is pending when added and verified at its first check, as if its DNS were set at once. */
export function fakeDomains(): DomainHost {
  return {
    add: (host) => Promise.resolve(ok({ verified: false, records: [pointing(host)] })),
    check: (host) => Promise.resolve(ok({ verified: true, records: [pointing(host)] })),
    remove: () => Promise.resolve(ok(undefined)),
  };
}

/**
 * A calendar and Zoom that consent at once and never fail: Google's busy is
 * empty, its events take a Meet link, and Zoom's meetings a Zoom one.
 */
export function fakeConnections(origin = 'https://consent.example'): Connection[] {
  const consent = (kind: string) => (state: string) =>
    `${origin}/${kind}?state=${encodeURIComponent(state)}`;
  return [
    {
      kind: 'google',
      consentUrl: consent('google'),
      redeem: (code) => Promise.resolve(ok(`google-${code}`)),
      open: (grant) =>
        Promise.resolve(
          ok({
            grant,
            busy: () => Promise.resolve(ok([])),
            create: () =>
              Promise.resolve(ok({ eventId: 'event-1', videoUrl: 'https://meet.example/abc' })),
            cancel: () => Promise.resolve(ok(undefined)),
          }),
        ),
    },
    {
      kind: 'zoom',
      consentUrl: consent('zoom'),
      redeem: (code) => Promise.resolve(ok(`zoom-${code}`)),
      open: (grant) =>
        Promise.resolve(
          ok({
            grant,
            meeting: () => Promise.resolve(ok({ meetingId: '1', url: 'https://zoom.example/j/1' })),
            end: () => Promise.resolve(ok(undefined)),
          }),
        ),
    },
  ];
}
