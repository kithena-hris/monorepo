import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { DISPOSITION, indeedInbound } from './indeed.js';

describe('Indeed Apply (REC-132)', () => {
  const inbound = indeedInbound('shared-secret');
  const raw = JSON.stringify({
    id: 'ia-1',
    job: { jobId: 'indeed-job', jobMeta: 'acme/0192f1c2-0000-7000-8000-000000000001' },
    applicant: {
      fullName: 'Yuki Sato',
      email: 'yuki@example.com',
      phoneNumber: '+44 20 7946 0000',
      resume: {
        file: {
          fileName: 'cv.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF').toString('base64'),
        },
      },
    },
  });

  it('accepts only what Indeed signed', () => {
    const signed = createHmac('sha1', 'shared-secret').update(raw).digest('base64');
    expect(inbound.verify(raw, signed)).toBe(true);
    expect(inbound.verify(`${raw} `, signed)).toBe(false);
    expect(inbound.verify(raw, '')).toBe(false);
  });

  it('maps the application to Recruiting’s shape, the job from the meta it was posted with', () => {
    const parsed = inbound.parse(raw);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        jobId: '0192f1c2-0000-7000-8000-000000000001',
        ref: 'ia-1',
        name: 'Yuki Sato',
        email: 'yuki@example.com',
        phone: '+44 20 7946 0000',
      },
    });
    expect(parsed.ok && parsed.value.files[0]?.fileName).toBe('cv.pdf');
    expect(inbound.parse('{"id":"x"}').ok).toBe(false);
  });

  it('tells Indeed every stage in its own words', () => {
    for (const status of [
      'applied',
      'screening',
      'assessment',
      'interview',
      'works_council',
      'offer',
      'hired',
      'rejected',
      'withdrawn',
    ])
      expect(DISPOSITION[status], status).toBeDefined();
  });
});
