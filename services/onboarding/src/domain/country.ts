import type { LaunchCountry } from '@kithena/contracts';

import { parseDue, type Template, type TaskTemplate } from './plan.js';

/**
 * What the law asks of a new hire's first days, per launch country
 * (Recruiting PRD §O7, ONB-004). Awaiting a country reviewer, as the terms
 * packs are. Identification numbers are People's to collect, through its own
 * onboarding form; a task here only asks for them there (`kind: 'form'`).
 */

const t = (
  key: string,
  title: string,
  phase: TaskTemplate['phase'],
  ownerRole: TaskTemplate['ownerRole'],
  kind: TaskTemplate['kind'],
  due: string,
): TaskTemplate => ({
  key,
  title,
  phase,
  ownerRole,
  ownerPersonId: null,
  kind,
  due: parseDue(due),
  link: null,
});

const TASKS: Readonly<Record<LaunchCountry, readonly TaskTemplate[]>> = {
  ES: [
    t(
      'es_social_security_alta',
      'Register with Social Security (alta) before the start',
      'before_start',
      'hr',
      'todo',
      '-3d',
    ),
    t(
      'es_naf_bank',
      'Give your Social Security number (NAF) and bank details',
      'before_start',
      'new_hire',
      'form',
      '-7d',
    ),
    t(
      'es_contrat_sepe',
      'Communicate the contract to the public employment service',
      'first_week',
      'hr',
      'todo',
      '+10d',
    ),
    t('es_time_recording', 'Switch on daily time recording', 'day_one', 'hr', 'account', '0'),
  ],
  DE: [
    t(
      'de_tax_insurance',
      'Give your tax ID, health insurer and social security number',
      'before_start',
      'new_hire',
      'form',
      '-7d',
    ),
    t(
      'de_social_insurance',
      'Register with social insurance by the first payroll',
      'first_month',
      'hr',
      'todo',
      '+14d',
    ),
    t(
      'de_nachweis',
      'Hand over the essential terms (Nachweis) if not already given',
      'day_one',
      'hr',
      'document',
      '0',
    ),
    t(
      'de_data_protection',
      'Acknowledge data protection and confidentiality',
      'day_one',
      'new_hire',
      'acknowledge',
      '0',
    ),
  ],
  GB: [
    t(
      'gb_right_to_work',
      'Right-to-work check before the start',
      'before_start',
      'hr',
      'todo',
      '-1d',
    ),
    t(
      'gb_written_statement',
      'Give the written statement of particulars',
      'day_one',
      'hr',
      'document',
      '0',
    ),
    t(
      'gb_starter_checklist',
      'Fill in the starter checklist for payroll',
      'day_one',
      'new_hire',
      'form',
      '0',
    ),
    t(
      'gb_pension_assessment',
      'Assess for pension auto-enrolment',
      'first_month',
      'hr',
      'todo',
      '+30d',
    ),
  ],
  IN: [
    t('in_pan_bank', 'Give your PAN and bank details', 'before_start', 'new_hire', 'form', '-7d'),
    t(
      'in_uan',
      'Give your provident fund UAN, or ask for a new one',
      'before_start',
      'new_hire',
      'form',
      '-7d',
    ),
    t('in_appointment_letter', 'Give the appointment letter', 'day_one', 'hr', 'document', '0'),
    t(
      'in_pf_esi',
      'Register for the provident fund and state insurance where they apply',
      'first_month',
      'hr',
      'todo',
      '+30d',
    ),
  ],
  US: [
    t(
      'us_w4',
      'Fill in Form W-4 and the state withholding form',
      'before_start',
      'new_hire',
      'form',
      '-3d',
    ),
    t('us_i9_section_1', 'Complete Form I-9 section 1', 'day_one', 'new_hire', 'form', '0'),
    t('us_i9_section_2', 'Complete Form I-9 section 2', 'first_week', 'hr', 'todo', '+3d'),
    t('us_e_verify', 'Run E-Verify where required', 'first_week', 'hr', 'todo', '+3d'),
  ],
};

export const countryTasks = (country: LaunchCountry): readonly TaskTemplate[] => TASKS[country];

/** The plan a company starts with, before it writes its own (§O3, §O6). */
export function defaultTemplate(id: string): Template {
  return {
    id,
    name: 'Everyone',
    active: true,
    conditions: {},
    tasks: [
      t(
        'welcome_email',
        'Send the welcome email and the first-week agenda',
        'before_start',
        'hr',
        'todo',
        '-10d',
      ),
      t('assign_buddy', 'Choose a buddy', 'before_start', 'manager', 'todo', '-10d'),
      t('equipment', 'Prepare the laptop and equipment', 'before_start', 'it', 'equipment', '-5d'),
      t(
        'accounts',
        'Set up email and the accounts the role needs',
        'before_start',
        'it',
        'account',
        '-2d',
      ),
      t(
        'personal_details',
        'Fill in your personal details',
        'before_start',
        'new_hire',
        'form',
        '-5d',
      ),
      t('welcome_meeting', 'Welcome meeting', 'day_one', 'manager', 'meeting', '0'),
      t('buddy_coffee', 'Coffee with your buddy', 'first_week', 'buddy', 'meeting', '+2d'),
      t('meet_team', 'Meet the team', 'first_week', 'new_hire', 'meeting', '+4d'),
      t('checkin_30', '30-day check-in', 'first_month', 'manager', 'meeting', '+30d'),
      t('checkin_60', '60-day check-in', 'probation', 'manager', 'meeting', '+60d'),
      t('checkin_90', '90-day check-in', 'probation', 'manager', 'meeting', '+90d'),
    ],
  };
}
