import type { ParentalCaseData } from './case';
import type { ParentalCasesData } from './cases';
import type { ParentalData } from './plan';
import type { Entitlement, Plan } from './shared';

/**
 * Adam's parental leave on Acme's demo data, as Time Off answers it: the
 * other parent, due Thursday 14 January 2027, two parents, one baby, with
 * Acme's 2 paid weeks after a year. T9's plan: the 6 mandatory weeks, 8
 * flexible straight after, 4 days of vacation, Acme's 2 weeks, and 3
 * flexible weeks in August; 2 weeks kept for later.
 */

export const entitlement: Entitlement = {
  law: 'ET art. 48.4, RDL 9/2025',
  mandatoryWeeks: 6,
  flexibleWeeks: 11,
  flexibleBefore: '2028-01-14',
  laterWeeks: 2,
  laterBefore: '2035-01-14',
  startsFrom: '2027-01-14',
  paidBy: 'social_security',
  payPercent: 100,
  companyWeeks: 2,
  companyAfterYears: 1,
  vacationAccrues: true,
  noticeDays: 15,
};

const block = (
  kind: Plan['blocks'][number]['kind'],
  from: string,
  to: string,
  workingDays: string,
): Plan['blocks'][number] => ({
  kind,
  leaveTypeKey:
    kind === 'vacation' ? 'vacation' : kind === 'company' ? 'company_parental' : 'parental',
  from,
  to,
  workingDays,
  paidBy: kind === 'vacation' || kind === 'company' ? 'employer' : 'social_security',
  payPercent: 100,
});

export const draftPlan = (over: Partial<Plan> = {}): Plan => ({
  planId: '0189aaaa-0000-7000-8000-0000000000aa',
  status: 'draft',
  role: 'other_parent',
  childDate: '2027-01-14',
  dueDate: '2027-01-14',
  birth: null,
  singleParent: false,
  children: 1,
  teamSees: 'type',
  handover: [{ work: 'Billing v2 code reviews', coveredBy: 'Leo Rossi' }],
  blocks: [
    block('mandatory', '2027-01-14', '2027-02-24', '30.000'),
    block('flexible', '2027-02-25', '2027-04-21', '40.000'),
    block('vacation', '2027-04-22', '2027-04-27', '4.000'),
    block('company', '2027-04-28', '2027-05-11', '10.000'),
    block('flexible', '2027-08-02', '2027-08-22', '15.000'),
  ],
  keptWeeks: 2,
  reminders: [
    { blockFrom: '2027-02-25', remindOn: '2027-02-10' },
    { blockFrom: '2027-08-02', remindOn: '2027-07-18' },
  ],
  problems: [],
  entitlement,
  sentAt: null,
  approvedAt: null,
  explanation: {
    text: '8 of your 11 flexible weeks follow the mandatory 6, so most of your time is at the start. 2 weeks are kept for later.',
    ai: false,
  },
  ...over,
});

const adam = {
  personId: '00000000-0000-7000-8000-000000000002',
  displayName: 'Adam Novak',
  firstName: 'Adam',
  teamName: 'Platform',
  managerPersonId: '00000000-0000-7000-8000-000000000001',
};

export const parental = (over: Partial<ParentalData> = {}): ParentalData => ({
  step: 'plan',
  member: adam,
  managerName: 'Marco Ruiz',
  supported: true,
  plan: draftPlan(),
  preview: null,
  ...over,
});

export const sentPlan = (over: Partial<Plan> = {}): Plan =>
  draftPlan({ status: 'submitted', sentAt: '2026-10-01T10:00:00.000Z', ...over });

export const adamCase = (over: Partial<ParentalCaseData> = {}): ParentalCaseData => ({
  member: adam,
  managerName: 'Marco Ruiz',
  plan: sentPlan(),
  checklist: [
    { key: 'entitlement', status: 'done', module: null, on: null },
    { key: 'manager_told', status: 'done', module: null, on: null },
    { key: 'certificate', status: 'todo', module: null, on: null },
    { key: 'payroll', status: 'elsewhere', module: 'payroll', on: null },
    { key: 'benefits', status: 'elsewhere', module: 'benefits', on: null },
    { key: 'birth_certificate', status: 'scheduled', module: null, on: '2027-01-17' },
  ],
  canApprove: true,
  ...over,
});

/** HR's list (TOF-099c): Adam's plan waiting, and Hana's from the spring, approved. */
export const adaCases = (): ParentalCasesData => ({
  cases: [
    {
      planId: '0199a000-0000-7000-8000-0000000000f1',
      personId: '0199a000-0000-7000-8000-000000000002',
      displayName: 'Adam Novak',
      teamName: 'Platform',
      status: 'submitted',
      sentAt: '2026-10-01T09:12:00.000Z',
      from: '2027-01-14',
      to: '2027-05-09',
    },
    {
      planId: '0199a000-0000-7000-8000-0000000000f2',
      personId: '0199a000-0000-7000-8000-000000000006',
      displayName: 'Hana Kim',
      teamName: 'Platform',
      status: 'approved',
      sentAt: '2026-03-02T10:00:00.000Z',
      from: '2026-06-01',
      to: '2026-10-18',
    },
  ],
});
