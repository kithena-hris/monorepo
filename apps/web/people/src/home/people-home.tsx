import { Nav, NavItem, NavList, PageHeader, PageSection, Stack } from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * Where People starts (PEO-119): every People area this person's roles open,
 * so nobody has to type a URL to reach a settings screen.
 *
 * Only what the roles open is listed. The list decides nothing: every screen
 * is still refused by People to anybody who may not use it.
 */
export interface PeopleHomeState {
  readonly hr: boolean;
  readonly admin: boolean;
  readonly finance: boolean;
}

export interface PeopleHomeProps {
  readonly load: Loadable<PeopleHomeState>;
}

interface Place {
  readonly href: string;
  readonly label: string;
  readonly open: (can: PeopleHomeState) => boolean;
}

const everybody = (): boolean => true;
const hr = (can: PeopleHomeState): boolean => can.hr;
const admin = (can: PeopleHomeState): boolean => can.admin;
const hrOrAdmin = (can: PeopleHomeState): boolean => can.hr || can.admin;

const WORK: readonly Place[] = [
  { href: '/people/directory', label: 'Directory', open: everybody },
  { href: '/people/me', label: 'My profile', open: everybody },
  { href: '/people/completeness', label: 'Missing information', open: hr },
  { href: '/people/identifier-reviews', label: 'Identifiers to review', open: hr },
  { href: '/people/duplicates', label: 'Possible duplicates', open: hr },
  { href: '/people/analytics', label: 'Analytics', open: hr },
  { href: '/people/import', label: 'Import', open: hr },
  { href: '/people/export', label: 'Export', open: everybody },
  { href: '/people/full-values', label: 'Full values', open: (can) => can.finance || can.hr },
];

const SETTINGS: readonly Place[] = [
  { href: '/people/settings/fields', label: 'Employee fields', open: admin },
  { href: '/people/settings/organisation', label: 'Legal entities, locations and numbering', open: everybody },
  { href: '/people/settings/roles', label: 'Roles', open: hrOrAdmin },
  { href: '/people/settings/integrations', label: 'Integrations', open: admin },
];

function Places({
  label,
  places,
  can,
}: {
  readonly label: string;
  readonly places: readonly Place[];
  readonly can: PeopleHomeState;
}): JSX.Element | null {
  const open = places.filter((p) => p.open(can));
  if (open.length === 0) return null;
  return (
    <PageSection title={label}>
      <Nav label={label}>
        <NavList>
          {open.map((p) => (
            <NavItem key={p.href} href={p.href}>
              {p.label}
            </NavItem>
          ))}
        </NavList>
      </Nav>
    </PageSection>
  );
}

export function PeopleHome({ load }: PeopleHomeProps): JSX.Element {
  return (
    <Loaded load={load} what="People">
      {(can) => (
        <Stack gap={6}>
          <PageHeader title="People" description="Everybody’s records, and how People is set up." />
          <Places label="People" places={WORK} can={can} />
          <Places label="Settings" places={SETTINGS} can={can} />
        </Stack>
      )}
    </Loaded>
  );
}
