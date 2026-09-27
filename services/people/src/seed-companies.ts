/**
 * The local companies `seed-local.ts` fills in, as data.
 *
 * Acme is the small one every test and screenshot has used. Dunder Mifflin is
 * the fictional paper company of *The Office*: a corporate office, branches,
 * and the people everybody knows, with a reporting line deep enough to draw
 * and personal details varied enough to exercise the fields screens. Local
 * sample data only; nothing here is a real person's record.
 *
 * The line-up puts everybody in the job they are best known for, so the chart
 * is whole (at the finale most of Scranton had left); personal details —
 * marriages, partners, children — are as the series ends. A birthday is only
 * given where the show gives one.
 */

export interface SeedField {
  readonly key: string;
  readonly sectionKey: 'employment' | 'personal';
  readonly label: string;
  readonly dataType: 'text' | 'long_text' | 'select' | 'date' | 'number' | 'phone';
  readonly description?: string;
  readonly options?: readonly string[];
  readonly visibility?: readonly string[];
  readonly ownership?: readonly string[];
  readonly collectAt?: 'signup' | 'enrolment' | 'onboarding' | 'hr_only' | 'anytime';
  readonly requiredness?: 'never' | 'always';
  readonly classification?: 'public' | 'internal' | 'confidential';
  readonly piiKind?: 'none' | 'identity' | 'contact';
}

export interface SeedPerson {
  /** `first.last`, the handle the work email and the reporting line use. */
  readonly handle: string;
  readonly given: string;
  readonly family: string;
  /** Hired from this date; null, added and not hired yet. */
  readonly hireDate: string | null;
  readonly manager: string | null;
  readonly title: string;
  /** A `department` option. */
  readonly department: string;
  /** A location's key, from the company's `locations`. */
  readonly location?: string;
  /** Any other field's value, by key. */
  readonly details?: Readonly<Record<string, string | number>>;
}

/** Who works part time, by handle: everybody else is full time. */
export const PART_TIME: ReadonlySet<string> = new Set([
  'ryan.howard',
  'erin.hannon',
  'madge.madsen',
  'lonny.collins',
  'creed.bratton',
  'donald.knuth',
]);

export interface SeedCompany {
  readonly slug: string;
  readonly displayName: string;
  /** Where the company's first legal entity is, and its zone. */
  readonly country: string;
  readonly timeZone: string;
  readonly address: { readonly line1: string; readonly city: string };
  /** The administrator identity names, by handle: their own record is `people` with that handle. */
  readonly admin: { readonly handle: string; readonly given: string; readonly family: string };
  readonly locations: readonly {
    readonly key: string;
    readonly name: string;
    readonly timeZone: string;
  }[];
  readonly fields: readonly SeedField[];
  readonly people: readonly SeedPerson[];
}

/** A calendar date this many days from today, in UTC: seed data, not domain logic. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'];
const personal = ['self', 'hr'];

const WORK_FIELDS = (departments: readonly string[]): SeedField[] => [
  { key: 'job_title', sectionKey: 'employment', label: 'Job title', dataType: 'text' },
  {
    key: 'department',
    sectionKey: 'employment',
    label: 'Department',
    dataType: 'select',
    options: departments,
  },
  {
    key: 'working_hours',
    sectionKey: 'employment',
    label: 'Working hours',
    dataType: 'select',
    description: 'Full time or part time.',
    options: ['Full time', 'Part time'],
  },
  {
    key: 'work_phone',
    sectionKey: 'employment',
    label: 'Work phone',
    dataType: 'phone',
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    piiKind: 'contact',
  },
  {
    key: 'hire_date',
    sectionKey: 'employment',
    label: 'Start date',
    dataType: 'date',
    visibility: ['self', 'manager', 'hr'],
  },
  {
    key: 'emergency_contact',
    sectionKey: 'personal',
    label: 'Emergency contact',
    dataType: 'text',
    visibility: personal,
    ownership: ['employee', 'hr'],
    collectAt: 'onboarding',
    requiredness: 'always',
    classification: 'confidential',
    piiKind: 'contact',
  },
];

export const ACME: SeedCompany = {
  slug: 'acme',
  displayName: 'Acme Corp',
  country: 'ES',
  timeZone: 'Europe/Madrid',
  address: { line1: 'Calle Mayor 1', city: 'Madrid' },
  admin: { handle: 'ada', given: 'Ada', family: 'Lovelace' },
  locations: [],
  fields: WORK_FIELDS(['Leadership', 'Engineering', 'Research', 'People']),
  people: [
    {
      handle: 'grace.hopper',
      given: 'Grace',
      family: 'Hopper',
      hireDate: '2024-03-04',
      manager: null,
      title: 'Chief Executive',
      department: 'leadership',
    },
    {
      handle: 'alan.turing',
      given: 'Alan',
      family: 'Turing',
      hireDate: '2024-09-02',
      manager: 'grace.hopper',
      title: 'VP Engineering',
      department: 'engineering',
    },
    {
      handle: 'katherine.johnson',
      given: 'Katherine',
      family: 'Johnson',
      hireDate: '2025-01-13',
      manager: 'grace.hopper',
      title: 'Head of Research',
      department: 'research',
    },
    {
      handle: 'tim.berners-lee',
      given: 'Tim',
      family: 'Berners-Lee',
      hireDate: '2025-06-02',
      manager: 'alan.turing',
      title: 'Staff Engineer',
      department: 'engineering',
    },
    {
      handle: 'margaret.hamilton',
      given: 'Margaret',
      family: 'Hamilton',
      hireDate: '2025-11-03',
      manager: 'alan.turing',
      title: 'Engineering Manager',
      department: 'engineering',
    },
    {
      handle: 'edsger.dijkstra',
      given: 'Edsger',
      family: 'Dijkstra',
      hireDate: '2026-02-02',
      manager: 'margaret.hamilton',
      title: 'Engineer',
      department: 'engineering',
    },
    // Hired, starting in a fortnight: pre-hire until then.
    {
      handle: 'barbara.liskov',
      given: 'Barbara',
      family: 'Liskov',
      hireDate: inDays(14),
      manager: 'margaret.hamilton',
      title: 'Engineer',
      department: 'engineering',
    },
    // Added and not hired yet: provisional.
    {
      handle: 'donald.knuth',
      given: 'Donald',
      family: 'Knuth',
      hireDate: null,
      manager: 'katherine.johnson',
      title: 'Researcher',
      department: 'research',
    },
    {
      handle: 'ada',
      given: 'Ada',
      family: 'Lovelace',
      hireDate: null,
      manager: 'grace.hopper',
      title: 'Head of People',
      department: 'people',
    },
  ],
};

const MARITAL = [
  'Single',
  'In a relationship',
  'Engaged',
  'Married',
  'Separated',
  'Divorced',
  'Widowed',
];

export const DUNDER_MIFFLIN: SeedCompany = {
  slug: 'dunder-mifflin',
  displayName: 'Dunder Mifflin',
  country: 'US',
  timeZone: 'America/New_York',
  address: { line1: '1725 Slough Avenue', city: 'Scranton' },
  // Toby: HR at Scranton, and the one who holds People here.
  admin: { handle: 'toby.flenderson', given: 'Toby', family: 'Flenderson' },
  locations: [
    { key: 'corporate', name: 'Corporate, New York', timeZone: 'America/New_York' },
    { key: 'scranton', name: 'Scranton Branch', timeZone: 'America/New_York' },
    { key: 'nashua', name: 'Nashua Branch', timeZone: 'America/New_York' },
    { key: 'utica', name: 'Utica Branch', timeZone: 'America/New_York' },
  ],
  fields: [
    ...WORK_FIELDS([
      'Executive',
      'Management',
      'Sales',
      'Accounting',
      'Human Resources',
      'Administration',
      'Customer Service',
      'Supplier Relations',
      'Quality Assurance',
      'Warehouse',
    ]),
    {
      key: 'date_of_birth',
      sectionKey: 'personal',
      label: 'Date of birth',
      dataType: 'date',
      visibility: personal,
      ownership: ['employee', 'hr'],
      collectAt: 'onboarding',
      classification: 'confidential',
      piiKind: 'identity',
    },
    {
      key: 'marital_status',
      sectionKey: 'personal',
      label: 'Marital status',
      dataType: 'select',
      options: MARITAL,
      visibility: personal,
      ownership: ['employee', 'hr'],
      collectAt: 'onboarding',
      classification: 'confidential',
    },
    {
      key: 'partner',
      sectionKey: 'personal',
      label: 'Spouse or partner',
      dataType: 'text',
      visibility: personal,
      ownership: ['employee', 'hr'],
      collectAt: 'anytime',
      classification: 'confidential',
    },
    {
      key: 'children',
      sectionKey: 'personal',
      label: 'Children',
      description: 'Names, for benefits and leave.',
      dataType: 'text',
      visibility: personal,
      ownership: ['employee', 'hr'],
      collectAt: 'anytime',
      classification: 'confidential',
    },
    {
      key: 'hometown',
      sectionKey: 'personal',
      label: 'Hometown',
      dataType: 'text',
      visibility: everyone,
      ownership: ['employee', 'hr'],
      collectAt: 'anytime',
    },
  ],
  people: [
    // Corporate, New York.
    {
      handle: 'david.wallace',
      given: 'David',
      family: 'Wallace',
      hireDate: '1995-04-03',
      manager: null,
      title: 'Chief Executive Officer',
      department: 'executive',
      location: 'corporate',
      details: {
        marital_status: 'Married',
        partner: 'Rachel Wallace',
        children: 'Teddy',
        work_phone: '+12125550100',
      },
    },
    {
      handle: 'jan.levinson',
      given: 'Jan',
      family: 'Levinson',
      hireDate: '1998-09-14',
      manager: 'david.wallace',
      title: 'Vice President, Northeast Sales',
      department: 'executive',
      location: 'corporate',
      details: { marital_status: 'Single', children: 'Astrid', work_phone: '+12125550101' },
    },

    // Scranton.
    {
      handle: 'michael.scott',
      given: 'Michael',
      family: 'Scott',
      hireDate: '1993-06-07',
      manager: 'jan.levinson',
      title: 'Regional Manager',
      department: 'management',
      location: 'scranton',
      details: {
        date_of_birth: '1964-03-15',
        marital_status: 'Married',
        partner: 'Holly Flax',
        hometown: 'Scranton, Pennsylvania',
        work_phone: '+15705550100',
      },
    },
    {
      handle: 'dwight.schrute',
      given: 'Dwight',
      family: 'Schrute',
      hireDate: '1999-02-15',
      manager: 'michael.scott',
      title: 'Assistant to the Regional Manager',
      department: 'sales',
      location: 'scranton',
      details: {
        date_of_birth: '1970-01-20',
        marital_status: 'Married',
        partner: 'Angela Schrute',
        children: 'Phillip',
        hometown: 'Schrute Farms, Honesdale, Pennsylvania',
        work_phone: '+15705550101',
        emergency_contact: 'Mose Schrute, cousin',
      },
    },
    {
      handle: 'jim.halpert',
      given: 'Jim',
      family: 'Halpert',
      hireDate: '2001-08-20',
      manager: 'michael.scott',
      title: 'Sales Representative',
      department: 'sales',
      location: 'scranton',
      details: {
        date_of_birth: '1978-10-01',
        marital_status: 'Married',
        partner: 'Pam Halpert',
        children: 'Cece, Phillip',
        hometown: 'Scranton, Pennsylvania',
        work_phone: '+15705550102',
        emergency_contact: 'Pam Halpert, wife',
      },
    },
    {
      handle: 'pam.beesly',
      given: 'Pam',
      family: 'Beesly',
      hireDate: '2001-08-27',
      manager: 'michael.scott',
      title: 'Office Administrator',
      department: 'administration',
      location: 'scranton',
      details: {
        date_of_birth: '1979-03-25',
        marital_status: 'Married',
        partner: 'Jim Halpert',
        children: 'Cece, Phillip',
        hometown: 'Scranton, Pennsylvania',
        work_phone: '+15705550103',
        emergency_contact: 'Jim Halpert, husband',
      },
    },
    {
      handle: 'andy.bernard',
      given: 'Andy',
      family: 'Bernard',
      hireDate: '2006-05-01',
      manager: 'michael.scott',
      title: 'Sales Representative',
      department: 'sales',
      location: 'scranton',
      details: {
        marital_status: 'Single',
        hometown: 'Nashua, New Hampshire',
        work_phone: '+15705550104',
      },
    },
    {
      handle: 'stanley.hudson',
      given: 'Stanley',
      family: 'Hudson',
      hireDate: '1994-01-10',
      manager: 'michael.scott',
      title: 'Sales Representative',
      department: 'sales',
      location: 'scranton',
      details: {
        marital_status: 'Married',
        partner: 'Teri Hudson',
        children: 'Melissa',
        work_phone: '+15705550105',
      },
    },
    {
      handle: 'phyllis.vance',
      given: 'Phyllis',
      family: 'Vance',
      hireDate: '1991-03-18',
      manager: 'michael.scott',
      title: 'Sales Representative',
      department: 'sales',
      location: 'scranton',
      details: {
        marital_status: 'Married',
        partner: 'Bob Vance, Vance Refrigeration',
        work_phone: '+15705550106',
        emergency_contact: 'Bob Vance, husband',
      },
    },
    {
      handle: 'angela.martin',
      given: 'Angela',
      family: 'Martin',
      hireDate: '1999-06-01',
      manager: 'michael.scott',
      title: 'Senior Accountant',
      department: 'accounting',
      location: 'scranton',
      details: {
        date_of_birth: '1971-06-25',
        marital_status: 'Married',
        partner: 'Dwight Schrute',
        children: 'Phillip',
        work_phone: '+15705550107',
      },
    },
    {
      handle: 'oscar.martinez',
      given: 'Oscar',
      family: 'Martinez',
      hireDate: '2000-03-06',
      manager: 'angela.martin',
      title: 'Accountant',
      department: 'accounting',
      location: 'scranton',
      details: { marital_status: 'In a relationship', partner: 'Gil', work_phone: '+15705550108' },
    },
    {
      handle: 'kevin.malone',
      given: 'Kevin',
      family: 'Malone',
      hireDate: '1996-10-14',
      manager: 'angela.martin',
      title: 'Accountant',
      department: 'accounting',
      location: 'scranton',
      details: {
        date_of_birth: '1968-06-01',
        marital_status: 'Single',
        hometown: 'Scranton, Pennsylvania',
        work_phone: '+15705550109',
      },
    },
    {
      handle: 'toby.flenderson',
      given: 'Toby',
      family: 'Flenderson',
      hireDate: '1998-11-02',
      manager: 'david.wallace',
      title: 'Human Resources Representative',
      department: 'human resources',
      location: 'scranton',
      details: { marital_status: 'Divorced', children: 'Sasha', work_phone: '+15705550110' },
    },
    {
      handle: 'kelly.kapoor',
      given: 'Kelly',
      family: 'Kapoor',
      hireDate: '2004-02-09',
      manager: 'michael.scott',
      title: 'Customer Service Representative',
      department: 'customer service',
      location: 'scranton',
      details: {
        date_of_birth: '1980-02-05',
        marital_status: 'In a relationship',
        partner: 'Ryan Howard',
        work_phone: '+15705550111',
      },
    },
    {
      handle: 'ryan.howard',
      given: 'Ryan',
      family: 'Howard',
      hireDate: '2005-03-21',
      manager: 'michael.scott',
      title: 'Temp',
      department: 'sales',
      location: 'scranton',
      details: {
        date_of_birth: '1979-05-05',
        marital_status: 'In a relationship',
        partner: 'Kelly Kapoor',
        children: 'Drake',
        work_phone: '+15705550112',
      },
    },
    {
      handle: 'meredith.palmer',
      given: 'Meredith',
      family: 'Palmer',
      hireDate: '1994-07-11',
      manager: 'michael.scott',
      title: 'Supplier Relations Representative',
      department: 'supplier relations',
      location: 'scranton',
      details: { marital_status: 'Divorced', children: 'Jake', work_phone: '+15705550113' },
    },
    {
      handle: 'creed.bratton',
      given: 'Creed',
      family: 'Bratton',
      hireDate: '1997-12-01',
      manager: 'michael.scott',
      title: 'Quality Assurance Representative',
      department: 'quality assurance',
      location: 'scranton',
      details: { work_phone: '+15705550114' },
    },
    {
      handle: 'erin.hannon',
      given: 'Erin',
      family: 'Hannon',
      hireDate: '2009-11-16',
      manager: 'michael.scott',
      title: 'Receptionist',
      department: 'administration',
      location: 'scranton',
      details: {
        marital_status: 'In a relationship',
        partner: 'Pete Miller',
        work_phone: '+15705550115',
      },
    },
    {
      handle: 'pete.miller',
      given: 'Pete',
      family: 'Miller',
      hireDate: '2012-10-01',
      manager: 'michael.scott',
      title: 'Customer Service Representative',
      department: 'customer service',
      location: 'scranton',
      details: {
        marital_status: 'In a relationship',
        partner: 'Erin Hannon',
        work_phone: '+15705550116',
      },
    },
    {
      handle: 'clark.green',
      given: 'Clark',
      family: 'Green',
      hireDate: '2012-10-01',
      manager: 'michael.scott',
      title: 'Customer Service Representative',
      department: 'customer service',
      location: 'scranton',
      details: { marital_status: 'Single', work_phone: '+15705550117' },
    },
    {
      handle: 'darryl.philbin',
      given: 'Darryl',
      family: 'Philbin',
      hireDate: '1998-04-20',
      manager: 'michael.scott',
      title: 'Warehouse Foreman',
      department: 'warehouse',
      location: 'scranton',
      details: { marital_status: 'Divorced', children: 'Jada', work_phone: '+15705550120' },
    },
    {
      handle: 'roy.anderson',
      given: 'Roy',
      family: 'Anderson',
      hireDate: '1996-08-05',
      manager: 'darryl.philbin',
      title: 'Warehouse Worker',
      department: 'warehouse',
      location: 'scranton',
      details: { marital_status: 'Married', partner: 'Laura', work_phone: '+15705550121' },
    },
    {
      handle: 'nate.nickerson',
      given: 'Nate',
      family: 'Nickerson',
      hireDate: '2007-03-12',
      manager: 'darryl.philbin',
      title: 'Warehouse Worker',
      department: 'warehouse',
      location: 'scranton',
    },
    {
      handle: 'val.johnson',
      given: 'Val',
      family: 'Johnson',
      hireDate: '2011-02-07',
      manager: 'darryl.philbin',
      title: 'Warehouse Worker',
      department: 'warehouse',
      location: 'scranton',
    },
    {
      handle: 'madge.madsen',
      given: 'Madge',
      family: 'Madsen',
      hireDate: '1995-05-15',
      manager: 'darryl.philbin',
      title: 'Warehouse Worker',
      department: 'warehouse',
      location: 'scranton',
    },
    {
      handle: 'lonny.collins',
      given: 'Lonny',
      family: 'Collins',
      hireDate: '1997-09-22',
      manager: 'darryl.philbin',
      title: 'Warehouse Worker',
      department: 'warehouse',
      location: 'scranton',
    },

    // Other branches.
    {
      handle: 'holly.flax',
      given: 'Holly',
      family: 'Flax',
      hireDate: '2008-04-10',
      manager: 'jan.levinson',
      title: 'Human Resources Representative',
      department: 'human resources',
      location: 'nashua',
      details: { marital_status: 'Married', partner: 'Michael Scott', work_phone: '+16035550100' },
    },
    {
      handle: 'karen.filippelli',
      given: 'Karen',
      family: 'Filippelli',
      hireDate: '2006-04-24',
      manager: 'jan.levinson',
      title: 'Regional Manager',
      department: 'management',
      location: 'utica',
      details: { marital_status: 'Married', work_phone: '+13155550100' },
    },

    // Hired, starting in a fortnight: pre-hire until then.
    {
      handle: 'nellie.bertram',
      given: 'Nellie',
      family: 'Bertram',
      hireDate: inDays(14),
      manager: 'michael.scott',
      title: 'Special Projects Manager',
      department: 'management',
      location: 'scranton',
      details: { marital_status: 'Single' },
    },
    // Added and not hired yet: provisional.
    {
      handle: 'gabe.lewis',
      given: 'Gabe',
      family: 'Lewis',
      hireDate: null,
      manager: 'jan.levinson',
      title: 'Coordinating Director of Emerging Regions',
      department: 'executive',
      location: 'corporate',
    },
  ],
};

export const COMPANIES: readonly SeedCompany[] = [ACME, DUNDER_MIFFLIN];
