import { describe, expect, it } from 'vitest';

import {
  agencyMay,
  jobPermissions,
  maySeeApplication,
  maySeeOffer,
  worksCouncilMay,
  type JobFacts,
  type Viewer,
} from './access.js';

const viewer = (personId: string, admin = false): Viewer => ({
  personId,
  accountId: `acc-${personId}`,
  admin,
  fairness: false,
});
const job: JobFacts = {
  id: 'j1',
  confidential: false,
  team: [
    { personId: 'ada', role: 'recruiter' },
    { personId: 'marco', role: 'hiring_manager' },
    { personId: 'adam', role: 'interviewer' },
    { personId: 'cora', role: 'coordinator' },
  ],
};
const rules = {
  revealInternalAt: 'offer' as const,
  managerOf: (id: string) => (id === 'liam' ? 'marco' : null),
};
const external = {
  candidatePersonId: null,
  reached: 'interview' as const,
  interviewerIds: ['adam'],
};

describe('access (PRD §25, §33)', () => {
  it('gives each role on the job its permissions', () => {
    expect(jobPermissions(viewer('cora'), job).has('interview.schedule')).toBe(true);
    expect(jobPermissions(viewer('cora'), job).has('offer.view')).toBe(false);
    expect(jobPermissions(viewer('adam'), job).has('pipeline.view')).toBe(false);
    expect(jobPermissions(viewer('stranger'), job).size).toBe(0);
    expect(jobPermissions(viewer('root', true), job).has('decide')).toBe(true);
  });

  it('shows an interviewer only the applications they interview', () => {
    expect(maySeeApplication(viewer('adam'), job, external, rules)).toBe(true);
    expect(
      maySeeApplication(viewer('adam'), job, { ...external, interviewerIds: ['mei'] }, rules),
    ).toBe(false);
    expect(maySeeApplication(viewer('stranger'), job, external, rules)).toBe(false);
  });

  it('hides an internal applicant from their own manager until the offer', () => {
    const internal = {
      candidatePersonId: 'liam',
      reached: 'interview' as const,
      interviewerIds: [],
    };
    expect(maySeeApplication(viewer('marco'), job, internal, rules)).toBe(false);
    expect(maySeeApplication(viewer('marco'), job, { ...internal, reached: 'offer' }, rules)).toBe(
      true,
    );
    expect(maySeeApplication(viewer('ada'), job, internal, rules)).toBe(true);
  });

  it('shows offers to the recruiter, hiring manager and approvers only', () => {
    expect(maySeeOffer(viewer('marco'), job, [])).toBe(true);
    expect(maySeeOffer(viewer('adam'), job, [])).toBe(false);
    expect(maySeeOffer(viewer('sofia'), job, ['sofia'])).toBe(true);
  });

  it('lets the works council see only a presented candidate, and an agency only its own', () => {
    expect(worksCouncilMay('wc1', ['wc1'], true)).toBe(true);
    expect(worksCouncilMay('wc1', ['wc1'], false)).toBe(false);
    expect(agencyMay('ag1', 'ag2')).toBe(false);
  });
});
