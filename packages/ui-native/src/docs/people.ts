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
  },
  {
    name: 'Jonas Weber',
    role: 'Engineering Manager',
    team: 'Engineering',
    location: 'Berlin',
    status: 'Active',
  },
  {
    name: 'Amara Okafor',
    role: 'Product Designer',
    team: 'Design',
    location: 'London',
    status: 'On leave',
  },
  {
    name: 'Lucas Moreau',
    role: 'Account Executive',
    team: 'Sales',
    location: 'Paris',
    status: 'Onboarding',
  },
  {
    name: 'Mei Tanaka',
    role: 'Data Analyst',
    team: 'Finance',
    location: 'Remote',
    status: 'Active',
  },
  {
    name: 'Diego Alvarez',
    role: 'Support Lead',
    team: 'Support',
    location: 'Madrid',
    status: 'Offboarding',
  },
  {
    name: 'Sofia Lindqvist',
    role: 'Recruiter',
    team: 'People',
    location: 'Stockholm',
    status: 'Active',
  },
  {
    name: 'Nora Becker',
    role: 'Head of People',
    team: 'People',
    location: 'Berlin',
    status: 'Active',
  },
  {
    name: 'Omar Haddad',
    role: 'Backend Engineer',
    team: 'Engineering',
    location: 'Remote',
    status: 'Active',
  },
  {
    name: 'Yuki Sato',
    role: 'iOS Engineer',
    team: 'Engineering',
    location: 'Tokyo',
    status: 'Invited',
  },
  {
    name: 'Tom Fischer',
    role: 'Sales Manager',
    team: 'Sales',
    location: 'Munich',
    status: 'Active',
  },
  {
    name: 'Zara Ahmed',
    role: 'Finance Lead',
    team: 'Finance',
    location: 'London',
    status: 'Active',
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
