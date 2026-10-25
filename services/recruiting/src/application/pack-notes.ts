import type { Words } from '@kithena/domain-kit';

/**
 * What each country's contract types mean, in a line (each pack's `NOTE`), in
 * the reader's words: the candidate reads it under their contract's name.
 *
 * A literal key per note, so the extractor finds every one and each is
 * translated; `pack-notes.test.ts` holds every English here to the pack's, so
 * a note changed in the law is changed here too or the build fails.
 */
export function contractNote(t: Words, country: string, contractType: string): string | null {
  switch (`${country}.${contractType}`) {
    case 'DE.unbefristet':
      return t(
        'terms.note.de.unbefristet',
        'Open-ended, full or part time by the hours you set. After six months in a company of more than ten, the Kündigungsschutzgesetz protects against dismissal.',
      );
    case 'DE.befristet_mit_sachgrund':
      return t(
        'terms.note.de.befristet_mit_sachgrund',
        'Fixed term for one of the objective reasons in § 14(1) TzBfG, of any length. Signed in writing before work starts, or it becomes open-ended.',
      );
    case 'DE.befristet_ohne_sachgrund':
      return t(
        'terms.note.de.befristet_ohne_sachgrund',
        'Fixed term without a reason: at most 2 years with up to 3 extensions (4 years in a company’s first 4), and never for someone employed here before.',
      );
    case 'DE.kurzfristig':
      return t(
        'terms.note.de.kurzfristig',
        'Short-term work: at most 3 months or 70 working days in a calendar year, not the person’s main occupation. No social insurance contributions (§ 8(1) no. 2 SGB IV).',
      );
    case 'DE.minijob':
      return t(
        'terms.note.de.minijob',
        'Pay up to €603 a month in 2026 (§ 8(1a) SGB IV), with flat-rate employer contributions. Every employee right applies, leave included.',
      );
    case 'DE.werkstudent':
      return t(
        'terms.note.de.werkstudent',
        'An enrolled student, up to 20 hours a week in term time. Only pension insurance is due (§ 5(3) SGB VI).',
      );
    case 'DE.praktikum_pflicht':
      return t(
        'terms.note.de.praktikum_pflicht',
        'Required by a study or training regulation. Not paid the Mindestlohn (§ 22(1) no. 1 MiLoG).',
      );
    case 'DE.praktikum_freiwillig':
      return t(
        'terms.note.de.praktikum_freiwillig',
        'Voluntary internship. The Mindestlohn applies once it runs over 3 months (§ 22(1) no. 3 MiLoG); the terms are set out in writing (§ 2(1a) NachwG).',
      );
    case 'DE.ausbildung':
      return t(
        'terms.note.de.ausbildung',
        'Vocational training under the BBiG: 24 to 42 months, a probation of 1 to 4 months, at least €724 a month in the first year for a start in 2026.',
      );
    case 'DE.freier_mitarbeiter':
      return t(
        'terms.note.de.freier_mitarbeiter',
        'A service contract, not employment: no leave, probation or Mindestlohn. Set hours, place and instructions would make it employment (§ 7 SGB IV).',
      );
    case 'ES.indefinido':
      return t(
        'terms.note.es.indefinido',
        'Open-ended, the rule since the 2021 labour reform. Full or part time by the hours you set.',
      );
    case 'ES.fijo_discontinuo':
      return t(
        'terms.note.es.fijo_discontinuo',
        'Open-ended, for work that comes in seasons or campaigns: the person is called back each time, in order (art. 16 ET).',
      );
    case 'ES.temporal_produccion':
      return t(
        'terms.note.es.temporal_produccion',
        'For an unforeseeable rise in work, up to 6 months (12 by sector agreement), or a foreseeable peak of at most 90 days a year (art. 15.2 ET). The cause goes in the contract.',
      );
    case 'ES.temporal_sustitucion':
      return t(
        'terms.note.es.temporal_sustitucion',
        'To cover someone whose job is kept for them, to complete reduced hours, or a vacancy during selection for at most 3 months (art. 15.3 ET).',
      );
    case 'ES.formativo_alternancia':
      return t(
        'terms.note.es.formativo_alternancia',
        'Work alongside vocational or university study, 3 months to 2 years, at most 65% of the hours in the first year and 85% in the second (art. 11.2 ET).',
      );
    case 'ES.formativo_practica':
      return t(
        'terms.note.es.formativo_practica',
        'A first job in the field within 3 years of the degree or qualification (5 with a disability), 6 to 12 months (art. 11.3 ET).',
      );
    case 'ES.autonomo':
      return t(
        'terms.note.es.autonomo',
        'A service contract with a self-employed person, not employment: no SMI, holiday or dismissal rules apply.',
      );
    case 'GB.permanent':
      return t(
        'terms.note.gb.permanent',
        'Open-ended. Unfair dismissal protection after the qualifying period: two years now, six months from January 2027 under the Employment Rights Act 2025.',
      );
    case 'GB.fixed_term':
      return t(
        'terms.note.gb.fixed_term',
        'Ends on a date or an event, with no maximum length, on terms no worse than permanent staff. Four years of successive terms make it permanent unless justified (FTE Regulations 2002).',
      );
    case 'GB.apprenticeship':
      return t(
        'terms.note.gb.apprenticeship',
        'At least 8 months of training towards an approved standard, with off-the-job training paid. The apprentice rate applies under 19 or in the first year.',
      );
    case 'GB.zero_hours':
      return t(
        'terms.note.gb.zero_hours',
        'No guaranteed hours: paid for the hours worked, with holiday pay and the National Living Wage. A clause forbidding other work is void (ERA 1996 s. 27A).',
      );
    case 'GB.self_employed':
      return t(
        'terms.note.gb.self_employed',
        'A contract for services: no minimum wage, holiday pay or PAYE. The off-payroll rules (IR35) may apply to a medium or large client.',
      );
    case 'IN.permanent':
      return t(
        'terms.note.in.permanent',
        'Open-ended, under the state’s standing orders. Gratuity after five years of continuous service.',
      );
    case 'IN.fixed_term':
      return t(
        'terms.note.in.fixed_term',
        'For a set period, with the same hours, wages and benefits as permanent staff, and gratuity after one year (Code on Social Security 2020 s. 53).',
      );
    case 'IN.apprentice':
      return t(
        'terms.note.in.apprentice',
        'Training under a contract registered on the national apprenticeship portal, 6 to 36 months, with at least the prescribed monthly stipend (Apprentices Act 1961).',
      );
    case 'IN.consultant':
      return t(
        'terms.note.in.consultant',
        'A contract for services, not employment: no provident fund, state insurance or gratuity.',
      );
    case 'US.at_will_full_time':
      return t(
        'terms.note.us.at_will_full_time',
        'Either side may end it at any time for any lawful reason; Montana requires good cause after the probationary period.',
      );
    case 'US.at_will_part_time':
      return t(
        'terms.note.us.at_will_part_time',
        'At-will, with fewer hours. Health cover eligibility follows the company’s plans and the Affordable Care Act’s 30-hour line.',
      );
    case 'US.temporary':
      return t(
        'terms.note.us.temporary',
        'At-will employment expected to end after a season or a project, still owed the minimum wage and overtime.',
      );
    case 'US.intern':
      return t(
        'terms.note.us.intern',
        'Paid at least the minimum wage. An unpaid internship must pass the Department of Labor’s primary beneficiary test.',
      );
    case 'US.fixed_term_contract':
      return t(
        'terms.note.us.fixed_term_contract',
        'A contract for a set term, which ends at-will status for its length: ending it early can mean paying out the rest.',
      );
    case 'US.contractor_1099':
      return t(
        'terms.note.us.contractor_1099',
        'A service agreement, not employment: no minimum wage, overtime or withholding. The IRS and the states look at the facts, not the label.',
      );
    default:
      return null;
  }
}
