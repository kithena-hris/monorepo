/**
 * The design's sample people, for stories. The only people a story may show
 * (docs/reach-mobile-build-plan.md, "Rules no ticket restates").
 */
export const PEOPLE = [
  {
    name: 'Priya Shah',
    role: 'Senior Engineer',
    team: 'Engineering',
    location: 'Berlin',
    status: 'Active',
    start: '2 Sep 2024',
    /** Annual base, in euro cents. */
    salary: 9_200_000,
  },
  {
    name: 'Jonas Weber',
    role: 'Engineering Manager',
    team: 'Engineering',
    location: 'Berlin',
    status: 'Active',
    start: '14 Jan 2021',
    salary: 11_800_000,
  },
  {
    name: 'Amara Okafor',
    role: 'Product Designer',
    team: 'Design',
    location: 'London',
    status: 'On leave',
    start: '20 Jun 2022',
    salary: 8_400_000,
  },
  {
    name: 'Lucas Moreau',
    role: 'Account Executive',
    team: 'Sales',
    location: 'Paris',
    status: 'Onboarding',
    start: '21 Sep 2026',
    salary: 7_100_000,
  },
  {
    name: 'Mei Tanaka',
    role: 'Data Analyst',
    team: 'Finance',
    location: 'Remote',
    status: 'Active',
    start: '6 Mar 2023',
    salary: 7_800_000,
  },
  {
    name: 'Diego Alvarez',
    role: 'Support Lead',
    team: 'Support',
    location: 'Madrid',
    status: 'Offboarding',
    start: '2 Nov 2020',
    salary: 6_600_000,
  },
  {
    name: 'Sofia Lindqvist',
    role: 'Recruiter',
    team: 'People',
    location: 'Stockholm',
    status: 'Active',
    start: '10 Feb 2025',
    salary: 6_900_000,
  },
  {
    name: 'Nora Becker',
    role: 'Head of People',
    team: 'People',
    location: 'Berlin',
    status: 'Active',
    start: '1 Apr 2019',
    salary: 12_400_000,
  },
  {
    name: 'Omar Haddad',
    role: 'Backend Engineer',
    team: 'Engineering',
    location: 'Remote',
    status: 'Active',
    start: '18 Jul 2023',
    salary: 8_800_000,
  },
  {
    name: 'Yuki Sato',
    role: 'iOS Engineer',
    team: 'Engineering',
    location: 'Tokyo',
    status: 'Invited',
    start: '1 Oct 2026',
    salary: 9_000_000,
  },
  {
    name: 'Tom Fischer',
    role: 'Sales Manager',
    team: 'Sales',
    location: 'Munich',
    status: 'Active',
    start: '9 May 2022',
    salary: 9_700_000,
  },
  {
    name: 'Zara Ahmed',
    role: 'Finance Lead',
    team: 'Finance',
    location: 'London',
    status: 'Active',
    start: '3 Aug 2021',
    salary: 10_900_000,
  },
] as const;

/** A status's badge tone, as the design pairs them. */
export const STATUS_TONE = {
  Active: 'success',
  'On leave': 'info',
  Onboarding: 'accent',
  Offboarding: 'warning',
  Invited: 'neutral',
} as const;

/** The design's sample candidates, for a hiring board: name, role, tags. */
export const CANDIDATES = [
  { name: 'Hana Kim', role: 'Product Designer', tags: ['Portfolio'] },
  { name: 'Leo Rossi', role: 'Backend Engineer', tags: ['Referral'] },
  { name: 'Ines Duarte', role: 'Account Executive', tags: [] },
  { name: 'Ravi Patel', role: 'Data Analyst', tags: ['Remote'] },
  { name: 'Maya Cohen', role: 'iOS Engineer', tags: ['Senior'] },
  { name: 'Sam Okoro', role: 'Support Lead', tags: [] },
  { name: 'Eva Novak', role: 'Recruiter', tags: ['Internal'] },
  { name: 'Ali Rahman', role: 'Designer', tags: [] },
] as const;
