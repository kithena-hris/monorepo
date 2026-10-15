import { ok } from '@kithena/domain-kit';

import type { AssessmentProvider, BackgroundCheckProvider } from '../application/ports.js';

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
