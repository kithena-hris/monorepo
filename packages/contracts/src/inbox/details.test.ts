import { describe, expect, it } from 'vitest';

import { DocumentsInboxDetail } from '../documents/inbox.js';
import { OnboardingTaskDetail } from '../onboarding/primitives.js';
import { PerformanceInboxDetail } from '../performance/primitives.js';

const ID = '0199a0f0-0000-7000-8000-000000000001';

describe('Inbox details a task is done from', () => {
  it('reads each Documents task, and a stranger shape not at all', () => {
    for (const d of [
      { kind: 'request', requestId: ID, personId: ID, typeKey: 'passport', typeName: 'Passport' },
      { kind: 'acknowledge', campaignId: ID, documentId: ID },
      { kind: 'access', requestId: ID, documentId: ID },
    ])
      expect(DocumentsInboxDetail.safeParse(d).success).toBe(true);
    expect(DocumentsInboxDetail.safeParse({ kind: 'sign', envelopeId: ID }).success).toBe(false);
  });

  it('reads an onboarding task with or without a link', () => {
    const task = { planId: ID, taskId: 'it_laptop', kind: 'todo', link: null };
    expect(OnboardingTaskDetail.safeParse(task).success).toBe(true);
    expect(OnboardingTaskDetail.safeParse({ ...task, kind: 'form', link: '/me' }).success).toBe(
      true,
    );
  });

  it('reads an unlock and a nomination', () => {
    expect(PerformanceInboxDetail.safeParse({ kind: 'unlock', reviewId: ID }).success).toBe(true);
    expect(
      PerformanceInboxDetail.safeParse({
        kind: 'nominations',
        nominationId: ID,
        nominees: [{ personId: ID, name: 'Ana Ruiz' }],
      }).success,
    ).toBe(true);
  });
});
