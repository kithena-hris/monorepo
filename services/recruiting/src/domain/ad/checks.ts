import type { CalendarDate, LaunchCountry } from '@kithena/contracts';

/**
 * The ad checks (Recruiting PRD §8.3, REC-017): deterministic, per country
 * and language, run before an ad is published. An error blocks publishing
 * and says why next to the words it found; a warning is read and published
 * anyway. A model may explain a flagged phrase later (Phase 2); it never
 * decides one.
 */

export interface AdText {
  readonly title: string;
  /** The ad's language: `en`, `de`, `es`, `ca`… */
  readonly language: string;
  /** The ad's text, flattened from the editor, in reading order. */
  readonly body: string;
  readonly salaryShown: boolean;
  readonly hasEqualOpportunityStatement: boolean;
}

export interface AdPlace {
  readonly country: LaunchCountry;
  /** US state or `NYC`; a Spanish community; null when not known. */
  readonly region: string | null;
}

export interface AdSettings {
  /** US federal contractors must carry an EEO statement (41 CFR 60-1.41). */
  readonly federalContractor: boolean;
  /** The apply form or a questionnaire asks for current or past pay. */
  readonly asksPayHistory: boolean;
}

export interface AdCheck {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly source: string;
  /** The words found, and where, so the editor can mark them. */
  readonly match: {
    readonly text: string;
    readonly index: number;
    readonly in: 'title' | 'body';
  } | null;
}

/** EU Pay Transparency Directive 2023/970: transposition due 7 June 2026. */
const PAY_TRANSPARENCY_FROM = '2026-06-07';
const EU: ReadonlySet<LaunchCountry> = new Set(['DE', 'ES']);

/** US states and cities whose law requires a pay range in the ad. */
const US_PAY_RANGE = new Set([
  'CA',
  'CO',
  'WA',
  'NY',
  'NYC',
  'IL',
  'MN',
  'MD',
  'MA',
  'NJ',
  'VT',
  'HI',
  'DC',
]);
/** US states and cities that ban asking for pay history. */
const US_PAY_HISTORY_BAN = new Set([
  'CA',
  'CO',
  'CT',
  'DE',
  'HI',
  'IL',
  'ME',
  'MD',
  'MA',
  'NJ',
  'NY',
  'NYC',
  'OR',
  'VT',
  'WA',
  'DC',
]);

/** A neutral marker in a German title (AGG § 11): (m/w/d) and its variants, a gender star or colon. */
const DE_NEUTRAL =
  /\((?:[mwfdx]\s*\/\s*){2}[mwfdx]\)|\(all genders\)|\(alle geschlechter\)|\(gn\)|\w[*:_]in(?:nen)?\b|\bfachkraft\b|\bperson\b/iu;

interface Pattern {
  readonly pattern: RegExp;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** Words that point at a protected characteristic, per language. */
const WORDS: Readonly<Record<string, readonly Pattern[]>> = {
  en: [
    {
      pattern:
        /\b(?:aged|age)\s+(?:between\s+)?\d{2}\s*(?:-|to|and)\s*\d{2}\b|\bunder\s+\d{2}\s+years?\b|\bmaximum age\b/iu,
      severity: 'error',
      message: 'An age limit discriminates on age',
    },
    {
      pattern: /\b(?:photo|photograph|headshot)\b/iu,
      severity: 'error',
      message: 'Asking for a photo invites discrimination on appearance, age and origin',
    },
    {
      pattern: /\b(?:married|single|marital status)\b/iu,
      severity: 'error',
      message: 'Marital status is not a job requirement',
    },
    {
      pattern: /\bnative (?:english )?speaker\b/iu,
      severity: 'warning',
      message: '“Native speaker” excludes by origin; ask for a level instead (C1, C2)',
    },
    {
      pattern: /\b(?:young|youthful|digital natives?|recent graduates? only)\b/iu,
      severity: 'warning',
      message: 'This reads as a preference for younger people',
    },
    {
      pattern: /\b(?:he|his|him)\b(?! or she)/iu,
      severity: 'warning',
      message: 'A gendered pronoun; “you” or “they” reads to everyone',
    },
  ],
  de: [
    {
      pattern: /\b(?:zwischen\s+\d{2}\s+und\s+\d{2}\s+jahren|höchstalter|nicht älter als)\b/iu,
      severity: 'error',
      message: 'Eine Altersgrenze benachteiligt wegen des Alters (§ 1 AGG)',
    },
    {
      pattern: /\b(?:foto|lichtbild|bewerbungsfoto)\b/iu,
      severity: 'error',
      message: 'Ein Foto zu verlangen lädt zu Benachteiligung ein (§ 1 AGG)',
    },
    {
      pattern: /\b(?:ledig|verheiratet|familienstand)\b/iu,
      severity: 'error',
      message: 'Der Familienstand ist keine Anforderung an die Stelle',
    },
    {
      pattern: /\bmuttersprach\w*/iu,
      severity: 'warning',
      message: '„Muttersprachler“ schließt nach Herkunft aus; besser ein Niveau (C1, C2)',
    },
    {
      pattern: /\b(?:junges? team|jung(?:e|en)?\b|digital natives?)/iu,
      severity: 'warning',
      message: 'Das liest sich als Vorliebe für Jüngere',
    },
  ],
  es: [
    {
      pattern: /\b(?:entre\s+\d{2}\s+y\s+\d{2}\s+años|menor(?:es)? de\s+\d{2}|edad máxima)\b/iu,
      severity: 'error',
      message: 'Un límite de edad discrimina por edad',
    },
    {
      pattern: /\b(?:foto(?:grafía)?|buena presencia)\b/iu,
      severity: 'error',
      message: 'Pedir foto o «buena presencia» invita a discriminar por apariencia',
    },
    {
      pattern: /\b(?:casad[oa]|solter[oa]|estado civil)\b/iu,
      severity: 'error',
      message: 'El estado civil no es un requisito del puesto',
    },
    {
      pattern: /\bnativ[oa]\b/iu,
      severity: 'warning',
      message: '«Nativo» excluye por origen; mejor un nivel (C1, C2)',
    },
    {
      pattern: /\b(?:joven|jóvenes|equipo joven)\b/iu,
      severity: 'warning',
      message: 'Se lee como preferencia por personas jóvenes',
    },
  ],
};

/** The languages an ad at a place is expected in. Another warns, never blocks. */
const LOCAL_LANGUAGES: Readonly<Record<LaunchCountry, readonly string[]>> = {
  DE: ['de', 'en'],
  ES: ['es', 'ca', 'eu', 'gl', 'en'],
  GB: ['en', 'cy', 'gd'],
  IN: ['en', 'hi'],
  US: ['en', 'es'],
};

function scan(text: string, where: 'title' | 'body', patterns: readonly Pattern[]): AdCheck[] {
  const out: AdCheck[] = [];
  for (const { pattern, severity, message } of patterns) {
    const found = pattern.exec(text);
    if (found !== null) {
      out.push({
        code: 'protected_characteristic',
        severity,
        message,
        source: 'AGG § 11; Equality Act 2010 s. 13; Title VII; art. 4.2 ET',
        match: { text: found[0], index: found.index, in: where },
      });
    }
  }
  return out;
}

export function adChecks(
  ad: AdText,
  places: readonly AdPlace[],
  settings: AdSettings,
  on: CalendarDate,
): AdCheck[] {
  const out: AdCheck[] = [];
  const countries = new Set(places.map((p) => p.country));
  const regions = new Set(places.flatMap((p) => (p.region === null ? [] : [p.region])));

  if (countries.has('DE') && !DE_NEUTRAL.test(ad.title)) {
    out.push({
      code: 'gender_neutral_title',
      severity: 'error',
      message:
        'A German ad’s title carries a neutral marker such as (m/w/d), or is neutral by itself',
      source: 'AGG §§ 1, 11',
      match: { text: ad.title, index: 0, in: 'title' },
    });
  }

  if (!ad.salaryShown) {
    const usRange = [...regions].some((r) => US_PAY_RANGE.has(r)) && countries.has('US');
    if (usRange) {
      out.push({
        code: 'pay_range_required',
        severity: 'error',
        message: 'This location’s law requires the pay range in the ad',
        source: 'US state and city pay transparency laws',
        match: null,
      });
    } else if (on >= PAY_TRANSPARENCY_FROM && [...countries].some((c) => EU.has(c))) {
      out.push({
        code: 'pay_range_before_interview',
        severity: 'warning',
        message: 'Give the starting pay or range in the ad, or before the first interview',
        source: 'Directive (EU) 2023/970 art. 5(1)',
        match: null,
      });
    }
  }

  if (settings.asksPayHistory) {
    const banned =
      (on >= PAY_TRANSPARENCY_FROM && [...countries].some((c) => EU.has(c))) ||
      (countries.has('US') && [...regions].some((r) => US_PAY_HISTORY_BAN.has(r)));
    if (banned) {
      out.push({
        code: 'pay_history_banned',
        severity: 'error',
        message:
          'Asking for current or past pay is not allowed here; ask for an expectation instead',
        source: 'Directive (EU) 2023/970 art. 5(2); US salary-history bans',
        match: null,
      });
    }
  }

  const patterns = WORDS[ad.language] ?? WORDS['en'] ?? [];
  out.push(...scan(ad.title, 'title', patterns), ...scan(ad.body, 'body', patterns));

  if (countries.has('US') && !ad.hasEqualOpportunityStatement) {
    out.push(
      settings.federalContractor
        ? {
            code: 'eeo_statement_required',
            severity: 'error',
            message:
              'A federal contractor’s ads state that all qualified applicants are considered without regard to protected characteristics',
            source: '41 CFR 60-1.41',
            match: null,
          }
        : {
            code: 'eeo_statement_offered',
            severity: 'warning',
            message: 'Add an equal-opportunity statement',
            source: 'EEOC guidance',
            match: null,
          },
    );
  }

  for (const country of countries) {
    if (!LOCAL_LANGUAGES[country].includes(ad.language)) {
      out.push({
        code: 'language_not_local',
        severity: 'warning',
        message: `An ad for ${country} in a language the place does not usually use`,
        source: 'company practice',
        match: null,
      });
    }
  }
  return out;
}

export const adPasses = (checks: readonly AdCheck[]): boolean =>
  checks.every((check) => check.severity !== 'error');
