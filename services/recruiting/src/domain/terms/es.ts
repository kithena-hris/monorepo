import { Decimal } from 'decimal.js';
import type { TermsIssue } from '@kithena/contracts';

import { monthsCovered } from '../dates.js';
import {
  issue,
  len,
  onDate,
  type Choice,
  type ContractTypeChoice,
  type EntityFacts,
  type Limits,
  type Rule,
  type TermsAnswers,
  type TermsPack,
  noLeave,
} from './pack.js';

/**
 * Spain (Recruiting PRD §19.5). **Awaiting a country reviewer** (REC-150).
 */

const COMUNIDADES: readonly Choice[] = [
  ['AN', 'Andalucía'],
  ['AR', 'Aragón'],
  ['AS', 'Asturias'],
  ['IB', 'Illes Balears'],
  ['CN', 'Canarias'],
  ['CB', 'Cantabria'],
  ['CL', 'Castilla y León'],
  ['CM', 'Castilla-La Mancha'],
  ['CT', 'Catalunya'],
  ['VC', 'Comunitat Valenciana'],
  ['EX', 'Extremadura'],
  ['GA', 'Galicia'],
  ['MD', 'Madrid'],
  ['MC', 'Murcia'],
  ['NC', 'Navarra'],
  ['PV', 'País Vasco'],
  ['RI', 'La Rioja'],
  ['CE', 'Ceuta'],
  ['ML', 'Melilla'],
].map(([key, label]) => ({ key: key as string, label: label as string }));

/** SMI, cents a year in 14 payments at 40 hours (Real Decreto per year). */
const SMI_YEARLY: readonly (readonly [string, number])[] = [
  ['2025-01-01', 1_657_600],
  ['2026-01-01', 1_709_400],
];

const CAUSES: Record<string, readonly Choice[]> = {
  temporal_produccion: [
    {
      key: 'unforeseeable_increase',
      label: 'An unforeseeable increase in activity (art. 15.2 ET)',
    },
    {
      key: 'foreseeable_peak',
      label: 'A short, foreseeable peak: at most 90 days in a year (art. 15.2 ET)',
    },
  ],
  temporal_sustitucion: [
    { key: 'reserved_job', label: 'Covering a person whose job is reserved (art. 15.3 ET)' },
    { key: 'reduced_hours', label: 'Completing the hours of a person on reduced hours' },
    { key: 'vacancy', label: 'Covering a vacancy during selection, at most 3 months' },
  ],
};

function types(answers: TermsAnswers): ContractTypeChoice[] {
  if (answers.relationship === 'contractor') {
    return [
      {
        key: 'autonomo',
        label: 'Autónomo (self-employed)',
        employmentType: 'contractor',
        relationship: 'contractor',
        fixedTerm: false,
      },
    ];
  }
  return [
    {
      key: 'indefinido',
      label: 'Indefinido (permanent)',
      employmentType: 'permanent',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'fijo_discontinuo',
      label: 'Fijo-discontinuo (seasonal, permanent)',
      employmentType: 'seasonal',
      relationship: 'employee',
      fixedTerm: false,
    },
    {
      key: 'temporal_produccion',
      label: 'Temporal por circunstancias de la producción',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'temporal_sustitucion',
      label: 'Temporal por sustitución',
      employmentType: 'fixed_term',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'formativo_alternancia',
      label: 'Formativo en alternancia',
      employmentType: 'apprentice',
      relationship: 'employee',
      fixedTerm: true,
    },
    {
      key: 'formativo_practica',
      label: 'Formativo para la práctica profesional',
      employmentType: 'intern',
      relationship: 'employee',
      fixedTerm: true,
    },
  ];
}

const temporary = (type: string | undefined) => type?.startsWith('temporal') === true;

function limits(answers: TermsAnswers, entity: EntityFacts): Limits {
  const type = answers.contractType;
  const { contractStart: start, contractEnd: end } = answers;
  const shortTemporary =
    temporary(type) && start !== undefined && end != null && monthsCovered(start, end) <= 6;
  // art. 14 ET: 6 months for qualified technicians, 2 for others (3 under 25 staff),
  // 1 month in a temporary contract of up to 6 months; none if they did the job before.
  const max =
    answers.previouslyEmployed === true
      ? null
      : shortTemporary
        ? len(1, 'months')
        : answers.roleGroup === 'qualified'
          ? len(6, 'months')
          : len(entity.headcount < 25 ? 3 : 2, 'months');
  return {
    durationMonths:
      type === 'temporal_produccion'
        ? {
            min: 0,
            max:
              answers.fixedTermReason === 'foreseeable_peak'
                ? 3
                : answers.agreement == null
                  ? 6
                  : 12,
          }
        : type === 'temporal_sustitucion'
          ? { min: 0, max: answers.fixedTermReason === 'vacancy' ? 3 : null }
          : type === 'formativo_alternancia'
            ? { min: 3, max: 24 }
            : type === 'formativo_practica'
              ? { min: 6, max: 12 }
              : null,
    maxWeeklyMinutes: 40 * 60,
    probation:
      type === 'autonomo' || type === 'formativo_alternancia'
        ? { allowed: false, required: false, max: null, default: null }
        : { allowed: max !== null, required: false, max, default: max },
    noticeEmployee: type === 'autonomo' ? len(0, 'days') : len(15, 'days'),
    noticeEmployer: type === 'autonomo' ? len(0, 'days') : len(15, 'days'),
  };
}

/** Share of the week worked away from the workplace; hybrid counts days off site. */
const remoteShare = (answers: TermsAnswers): number =>
  answers.workMode === 'remote'
    ? 1
    : answers.workMode === 'hybrid'
      ? (5 - (answers.hybridDaysOnsite ?? 5)) / 5
      : 0;

function check(answers: TermsAnswers): TermsIssue[] {
  const out: TermsIssue[] = [];
  if (answers.roleGroup == null && answers.contractType !== 'autonomo') {
    out.push(
      issue(
        'probation',
        'role_group_required',
        'art. 14 ET',
        'Say whether the role is for a qualified technician; it decides the probation',
      ),
    );
  }
  if (answers.contractType === 'autonomo') {
    out.push(
      issue(
        'relationship',
        'false_self_employment',
        'art. 1 ET',
        'Check this is not employment: dependence and working within the company’s organisation make it one',
        'warning',
      ),
    );
  }
  if (temporary(answers.contractType)) {
    out.push(
      issue(
        'fixed_term_reason',
        'cause_in_writing',
        'art. 15.1 ET',
        'The contract must state the cause precisely, or it becomes permanent',
        'warning',
      ),
    );
  }
  return out;
}

export const spain: TermsPack = {
  country: 'ES',
  version: 'es-2026.1',
  reviewed: false,
  regions: COMUNIDADES,
  regionRequired: true,
  relationships: () => [
    { key: 'employee', label: 'Trabajador por cuenta ajena (employee)' },
    { key: 'contractor', label: 'Autónomo (self-employed)' },
  ],
  contractTypes: types,
  fixedTermReasons: (answers) => CAUSES[answers.contractType ?? ''] ?? [],
  asksPreviousEmployment: (answers) => answers.relationship === 'employee',
  agreementRequired: () => true,
  limits,
  paymentsPerYear: () => [14, 12],
  minimumAnnualPayMinor(answers, _entity, on) {
    if (answers.contractType === 'autonomo') return null;
    const minutes = answers.weeklyMinutes ?? 0;
    return new Decimal(onDate(SMI_YEARLY, on))
      .mul(minutes)
      .div(40 * 60)
      .toDecimalPlaces(0, Decimal.ROUND_CEIL)
      .toNumber();
  },
  nonCompete: (answers) =>
    answers.relationship === 'contractor'
      ? {
          allowed: false,
          reason: 'A post-contractual restraint under art. 21.2 ET binds employees',
          maxMonths: 0,
        }
      : { allowed: true, reason: '', maxMonths: answers.roleGroup === 'qualified' ? 24 : 6 },
  rules: (): Rule[] => [
    {
      step: 'contract_type',
      text: 'Permanent is the rule; a temporary contract needs a legal cause stated precisely.',
      source: 'art. 15 ET (RDL 32/2021)',
    },
    {
      step: 'duration',
      text: 'Circumstances of production: at most 6 months, 12 by sector agreement; a foreseeable peak at most 90 days a year.',
      source: 'art. 15.2 ET',
    },
    {
      step: 'hours',
      text: 'At most 40 hours a week averaged over the year and 9 ordinary hours a day; daily time recording is mandatory.',
      source: 'art. 34 ET',
    },
    {
      step: 'probation',
      text: '6 months for qualified technicians, 2 for others (3 under 25 staff), 1 in a temporary contract of up to 6 months; none for someone who did the job before.',
      source: 'art. 14 ET',
    },
    {
      step: 'agreement',
      text: 'Name the convenio colectivo and the professional group; its table is the pay floor.',
      source: 'art. 82 ET',
    },
    {
      step: 'pay',
      text: '14 payments by default (two extra payments), or 12 with them prorated; never below the SMI.',
      source: 'arts. 27, 31 ET',
    },
    {
      step: 'work_mode',
      text: 'At least 30% remote over 3 months needs a written remote work agreement, and its costs are paid.',
      source: 'Ley 10/2021',
    },
    { step: 'benefits', text: '30 calendar days of holiday.', source: 'art. 38 ET' },
  ],
  check,
  documents: (answers) =>
    remoteShare(answers) >= 0.3 ? ['contrato', 'acuerdo_trabajo_a_distancia'] : ['contrato'],
  conditions: () => [],
  minimumLeave: (answers) =>
    answers.relationship !== 'employee'
      ? noLeave('LETA art. 1', 'An autónomo has no statutory leave.')
      : {
          days: 30,
          unit: 'calendar_days',
          source: 'Estatuto de los Trabajadores art. 38',
          note: 'Thirty calendar days a year, whatever the days worked; a convenio may give more.',
        },
  signature: () => 'electronic',
};
