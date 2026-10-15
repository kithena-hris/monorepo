/**
 * What a model never reads (PRD §14.6, §22.2): before an application's text
 * leaves Recruiting, code removes who the person is, how to reach them, the
 * address beyond the city, and every protected characteristic — date of birth
 * and age, gender markers, nationality, marital status, religion, health,
 * union membership — and, when the company asks, the names of schools.
 *
 * Two passes: a labelled line ("Nationality: …", "Geburtsdatum: …") loses its
 * value whatever the value is, and known shapes and words are removed where
 * they stand in a sentence. A photo never reaches here: images are not text.
 * The counts go into the assessment's record, beside the masked text itself.
 */

export type Masked =
  | 'name'
  | 'contact'
  | 'address'
  | 'birth'
  | 'age'
  | 'gender'
  | 'nationality'
  | 'family'
  | 'religion'
  | 'health'
  | 'union'
  | 'school';

export interface Known {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly city: string | null;
}

/** A label, in English, German or Spanish, and what its value is. */
const LABELS: readonly (readonly [Masked, RegExp])[] = [
  ['birth', /date of birth|d\.?o\.?b\.?|born|geburtsdatum|geboren|fecha de nacimiento/u],
  ['age', /\bage\b|alter|edad/u],
  ['gender', /gender|sex|geschlecht|sexo|género/u],
  ['nationality', /nationality|citizenship|staatsangehörigkeit|nationalität|nacionalidad/u],
  ['family', /marital status|family status|familienstand|estado civil|children|kinder|hijos/u],
  ['religion', /religion|confession|konfession|religión/u],
  ['health', /health|disability|behinderung|salud|discapacidad/u],
  ['address', /address|adresse|anschrift|dirección|domicilio/u],
];

const ESCAPE = /[.*+?^${}()|[\]\\]/gu;
const escape = (s: string) => s.replace(ESCAPE, '\\$&');

const SHAPES: readonly (readonly [Masked, RegExp])[] = [
  ['contact', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu],
  [
    'contact',
    /(?:https?:\/\/)?(?:www\.)?(?:linkedin|github|xing|instagram|facebook|twitter|x)\.com\/\S+/giu,
  ],
  // A phone number starts with +, a bracketed area code or a trunk 0, so "2018 - 2022" stays.
  ['contact', /(?:\+\d|\(\d{2,4}\)|\b0\d)[\d ()./-]{6,}\d/gu],
  ['address', /\b(?:calle|c\/|avenida|avda\.?|plaza|paseo|carrer)\s+[^,\n]+,?/giu],
  ['address', /\b[\p{L}-]+(?:straße|strasse|weg|allee|platz|gasse)\s*\d+\w?,?/giu],
  [
    'address',
    /\b\d+\s+[\p{L} ]+?\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|boulevard|blvd)\b\.?,?/giu,
  ],
  // Postcodes: ES/DE five digits, GB outward and inward, US ZIP, IN PIN.
  ['address', /\b(?:\d{5}(?:-\d{4})?|\d{6}|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/gu],
  ['age', /\b\d{2}\s*(?:years old|years of age|jahre alt|años)\b/giu],
  ['gender', /\b(?:mr|mrs|ms|miss|herr|frau|sr|sra|srta)\.?(?=\s)/giu],
  ['gender', /\b(?:she\/her|he\/him|they\/them)\b/giu],
  [
    'family',
    /\b(?:married|divorced|widowed|verheiratet|ledig|geschieden|casad[oa]|solter[oa]|divorciad[oa])\b/giu,
  ],
  [
    'religion',
    /\b(?:buddhist|catholic|christian|hindu|jewish|muslim|protestant|sikh|katholisch|evangelisch|católic[oa]|musulm[aá]n[a]?)\b/giu,
  ],
  ['health', /\b(?:disability|disabled|chronic illness|schwerbehindert\w*|discapacidad)\b/giu],
  [
    'union',
    /\b(?:trade union|labou?r union|union member\w*|gewerkschaft\w*|sindicato)\b(?:\s+[A-Z]{2,}\b)?/gu,
  ],
];

// Case matters here: a school's name is the capitalised words beside the keyword.
const KEYWORD = String.raw`(?:University|Universität|Universidad|College|Institute|Hochschule|School|Escuela|Instituto)`;
const NAME = String.raw`\p{Lu}[\p{L}&.-]*`;
const SCHOOL = new RegExp(
  [
    String.raw`\b${KEYWORD}\s+(?:(?:of|de|für|for)\s+)?${NAME}(?:\s+(?:(?:of|de|für)\s+)?${NAME})*`,
    String.raw`\b${NAME}(?:\s+${NAME})*\s+(?:University|Universität|College|Institute|Hochschule)\b`,
    String.raw`\b(?:IIT|IIM|NIT|MIT|UCL|LSE|ETH)\b(?:\s+${NAME})?`,
  ].join('|'),
  'gu',
);

export function maskApplication(
  text: string,
  known: Known,
  options: { readonly schools: boolean },
): { readonly text: string; readonly masked: Readonly<Partial<Record<Masked, number>>> } {
  const masked: Partial<Record<Masked, number>> = {};
  const count = (kind: Masked) => {
    masked[kind] = (masked[kind] ?? 0) + 1;
  };
  const tag = (kind: Masked) => `[${kind}]`;

  // 1. A labelled line loses its value, whatever the value is.
  let out = text
    .split('\n')
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon < 0) return line;
      const label = line.slice(0, colon).trim().toLowerCase();
      const hit = LABELS.find(([, pattern]) => pattern.test(label));
      if (hit === undefined || label.length > 40) return line;
      count(hit[0]);
      return `${line.slice(0, colon + 1)} ${tag(hit[0])}`;
    })
    .join('\n');

  // 2. The person's own name and contact details, as given on the form.
  const names = known.name.split(/\s+/u).filter((n) => n.length > 1);
  for (const [value, kind] of [
    [known.email, 'contact'],
    [known.phone, 'contact'],
    [known.name, 'name'],
    ...names.map((n) => [n, 'name'] as const),
  ] as const) {
    if (value === null || value === '') continue;
    out = out.replace(new RegExp(`(?<![\\p{L}])${escape(value)}(?![\\p{L}])`, 'giu'), () => {
      count(kind);
      return tag(kind);
    });
  }

  // 3. Shapes and words where they stand.
  for (const [kind, pattern] of SHAPES)
    out = out.replace(pattern, () => {
      count(kind);
      return tag(kind);
    });
  // A stray birth year beside a masked birth date ("1. März 1991").
  if ((masked.birth ?? 0) > 0) out = out.replace(/\[birth\][^\n]*/gu, tag('birth'));

  if (options.schools)
    out = out.replace(SCHOOL, () => {
      count('school');
      return tag('school');
    });

  // The city stays: it is how a commute and a work permit are judged.
  return { text: out, masked };
}
