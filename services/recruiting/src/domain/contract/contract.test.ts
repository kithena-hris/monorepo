import { CalendarDate, ResolvedTerms } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { blockers, cancelPrehire, decideCondition, openPrehire } from '../prehire/prehire.js';
import {
  generateContract,
  markSigned,
  packChanged,
  sendForSignature,
  signedByEnvelope,
} from './contract.js';

const d = (s: string) => CalendarDate.parse(s);
const terms = ResolvedTerms.parse({
  country: 'ES',
  region: 'MD',
  packVersion: 'es-2026.1',
  relationship: 'employee',
  contractType: 'indefinido',
  employmentType: 'permanent',
  fixedTermReason: null,
  contractStart: '2026-12-01',
  contractEnd: null,
  workingPattern: 'full_time',
  weeklyMinutes: 2400,
  fte: '1.0000',
  probation: { count: 6, unit: 'months' },
  probationEnd: '2027-05-31',
  noticeEmployee: { count: 15, unit: 'days' },
  noticeEmployer: { count: 15, unit: 'days' },
  workMode: 'hybrid',
  hybridDaysOnsite: 2,
  remoteCountry: null,
  collectiveAgreement: { key: 'consultoria', group: 'grupo_1' },
  nonCompeteMonths: null,
  mobilityClause: false,
  paymentsPerYear: 14,
  signature: 'electronic',
  documents: ['contrato', 'acuerdo_trabajo_a_distancia'],
  conditions: [],
});

describe('the contract (PRD §21.1, §21.2)', () => {
  it('goes through Documents when present, matched on the subject reference', () => {
    const contract = generateContract('k1', 'o1', 2, terms, true);
    expect(contract).toMatchObject({
      route: 'documents',
      subjectRef: 'recruiting:offer:o1:2',
      documents: ['contract', 'contrato', 'acuerdo_trabajo_a_distancia'],
    });
    const out = sendForSignature(contract);
    if (!out.ok) throw new Error();
    expect(signedByEnvelope(out.value, 'recruiting:offer:o1:1', d('2026-10-20'))).toMatchObject({
      ok: false,
      error: { code: 'NOT_THIS_CONTRACT' },
    });
    expect(signedByEnvelope(out.value, 'recruiting:offer:o1:2', d('2026-10-20'))).toMatchObject({
      ok: true,
      value: { state: 'signed' },
    });
  });

  it('is uploaded without Documents, and printed for a German fixed term before the start', () => {
    expect(generateContract('k1', 'o1', 1, terms, false).route).toBe('upload');
    const wet = generateContract('k1', 'o1', 1, { ...terms, signature: 'wet_ink' }, true);
    expect(wet.route).toBe('wet_ink');
    expect(markSigned(wet, 'ada', d('2026-12-02'), d('2026-12-01'))).toMatchObject({
      ok: false,
      error: { code: 'WRITTEN_FORM_LATE' },
    });
    expect(markSigned(wet, 'ada', d('2026-11-28'), d('2026-12-01'))).toMatchObject({
      ok: true,
      value: { signedOn: '2026-11-28', signedBy: 'ada' },
    });
  });

  it('notices a pack that changed between offer and contract', () => {
    expect(packChanged(generateContract('k1', 'o1', 1, terms, true), 'es-2027.1')).toBe(true);
  });
});

describe('the pre-hire (PRD §21.3)', () => {
  it('is met when every condition is met or waived, and says so once', () => {
    const prehire = openPrehire('a1', 'c1', d('2026-12-01'), ['right_to_work', 'references']);
    const one = decideCondition(prehire, 'references', 'waived', 'ada', 't1', null);
    if (!one.ok) throw new Error();
    expect(one.value.allMet).toBe(false);
    const two = decideCondition(
      one.value.prehire,
      'right_to_work',
      'met',
      'ada',
      't2',
      'Share code checked',
    );
    expect(two).toMatchObject({
      ok: true,
      value: { allMet: true, prehire: { state: 'conditions_met' } },
    });
  });

  it('never waives the right to work, and an open condition blocks the start', () => {
    const prehire = openPrehire('a1', 'c1', d('2026-12-01'), ['right_to_work']);
    expect(decideCondition(prehire, 'right_to_work', 'waived', 'ada', 't', null)).toMatchObject({
      ok: false,
      error: { code: 'NOT_WAIVABLE' },
    });
    expect(blockers(prehire, d('2026-11-30'))).toEqual([]);
    expect(blockers(prehire, d('2026-12-01'))).toEqual(['right_to_work']);
  });

  it('starts met when there is nothing to meet, and is cancelled with a reason', () => {
    expect(openPrehire('a1', 'c1', d('2026-12-01'), []).state).toBe('conditions_met');
    expect(cancelPrehire(openPrehire('a1', 'c1', d('2026-12-01'), []), 'reneged')).toMatchObject({
      ok: true,
      value: { state: 'cancelled', cancelReason: 'reneged' },
    });
  });
});
