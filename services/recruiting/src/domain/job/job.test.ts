import { describe, expect, it } from 'vitest';

import {
  hireInto,
  moveJob,
  moveTarget,
  requestPublication,
  slugFor,
  unpublishAll,
  type Job,
  type Target,
} from './job.js';

const job: Job = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  internalTitle: 'Backend engineer, Payments',
  title: 'Senior Backend Engineer (m/w/d)',
  requisitionIds: ['r1'],
  department: 'Engineering',
  countries: ['DE'],
  workMode: 'hybrid',
  salaryShown: true,
  languages: ['en', 'de'],
  internalOnly: false,
  confidential: false,
  openings: 2,
  hired: 0,
  targetHireDate: null,
  state: 'open',
};

const live = (target: Target['target']): Target => ({
  target,
  state: 'live',
  url: `https://x/${target}`,
  error: null,
  liveSince: '2026-10-01T00:00:00Z',
  expiresOn: null,
});

describe('a job (PRD §8.1)', () => {
  it('opens, holds and reopens, but a draft cannot be held', () => {
    expect(moveJob({ ...job, state: 'draft' }, 'on_hold')).toMatchObject({
      ok: false,
      error: { code: 'JOB_STATE' },
    });
    expect(moveJob(job, 'on_hold')).toMatchObject({ ok: true, value: { state: 'on_hold' } });
  });

  it('is filled by its last hire', () => {
    const one = hireInto(job);
    expect(one).toMatchObject({ ok: true, value: { hired: 1, state: 'open' } });
    if (!one.ok) return;
    expect(hireInto(one.value)).toMatchObject({ ok: true, value: { hired: 2, state: 'filled' } });
  });
});

describe('publication targets (PRD §9.1)', () => {
  it('needs the careers page before Google for Jobs and Indeed before Glassdoor', () => {
    expect(requestPublication(job, [], 'google_for_jobs', true)).toMatchObject({
      ok: false,
      error: { code: 'NEEDS_CAREERS_PAGE' },
    });
    expect(requestPublication(job, [live('careers_page')], 'glassdoor', true)).toMatchObject({
      ok: false,
      error: { code: 'THROUGH_INDEED' },
    });
    expect(
      requestPublication(job, [live('careers_page'), live('indeed')], 'glassdoor', true),
    ).toMatchObject({ ok: true, value: { state: 'pending' } });
  });

  it('keeps an internal-only job off public targets and refuses an ad with open checks', () => {
    expect(
      requestPublication({ ...job, internalOnly: true }, [], 'careers_page', true),
    ).toMatchObject({ ok: false, error: { code: 'INTERNAL_ONLY' } });
    expect(requestPublication({ ...job, internalOnly: true }, [], 'internal_board', false).ok).toBe(
      true,
    );
    expect(requestPublication(job, [], 'careers_page', false)).toMatchObject({
      ok: false,
      error: { code: 'AD_CHECKS' },
    });
  });

  it('moves a listing through its states and records a board’s refusal', () => {
    const pending: Target = {
      target: 'indeed',
      state: 'pending',
      url: null,
      error: null,
      liveSince: null,
      expiresOn: null,
    };
    expect(moveTarget(pending, 'failed', 'now', { error: 'Salary missing' })).toMatchObject({
      ok: true,
      value: { state: 'failed', error: 'Salary missing' },
    });
    expect(moveTarget(pending, 'paused', 'now')).toMatchObject({ ok: false });
  });

  it('takes everything down at once', () => {
    expect(unpublishAll([live('careers_page'), live('kithena_jobs')]).map((t) => t.state)).toEqual([
      'expired',
      'expired',
    ]);
  });

  it('builds a readable slug', () => {
    expect(slugFor('Senior Backend Engineer (m/w/d)', job.id)).toBe(
      'senior-backend-engineer-0190a1b2',
    );
    expect(slugFor('Diseñadora de Producto', job.id)).toBe('disenadora-de-producto-0190a1b2');
  });
});
