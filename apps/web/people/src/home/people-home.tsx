import { Button, Nav, NavItem, NavList, PageHeader, PageSection, Stack } from '@reach/ui';
import type { JSX } from 'react';

import manifest from '../../public/routes.json';
import { Loaded, type Loadable } from '../load';

/**
 * Where People starts (PEO-119): every People area this person's roles open,
 * so nobody has to type a URL to reach a settings screen.
 *
 * The places are the manifest's `sections`, the same list a host draws its
 * People navigation from, so the two cannot disagree. Only what the roles open
 * is listed. The list decides nothing: every screen is still refused by People
 * to anybody who may not use it.
 */
export interface PeopleHomeState {
  readonly hr: boolean;
  readonly admin: boolean;
  readonly finance: boolean;
}

export interface PeopleHomeProps {
  readonly load: Loadable<PeopleHomeState>;
}

/** A section or an action of the manifest: open to everybody, or to any of `for`. */
export interface Place {
  readonly path: string;
  readonly label: string;
  readonly group?: string;
  readonly for?: readonly string[];
}

export const opens = (place: Place, can: PeopleHomeState): boolean =>
  place.for === undefined ||
  Object.entries(can).some(([role, held]) => held && place.for?.includes(role) === true);

function Places({
  label,
  places,
}: {
  readonly label: string;
  readonly places: readonly Place[];
}): JSX.Element {
  return (
    <PageSection title={label}>
      <Nav label={label}>
        <NavList>
          {places.map((p) => (
            <NavItem key={p.path} href={p.path}>
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
      {(can) => {
        const open = (manifest.sections as readonly Place[]).filter(
          (p) => p.path !== '/people' && opens(p, can),
        );
        const groups = [...new Set(open.map((p) => p.group ?? 'People'))];
        const actions = (manifest.actions as readonly Place[]).filter((a) => opens(a, can));
        return (
          <Stack gap={6}>
            <PageHeader
              title="People"
              description="Everybody’s records, and how People is set up."
              actions={
                actions.length === 0 ? undefined : (
                  <span className="flex gap-2">
                    {actions.map((a) => (
                      <Button key={a.path} variant="primary" asChild>
                        <a href={a.path}>{a.label}</a>
                      </Button>
                    ))}
                  </span>
                )
              }
            />
            {groups.map((group) => (
              <Places
                key={group}
                label={group}
                places={open.filter((p) => (p.group ?? 'People') === group)}
              />
            ))}
          </Stack>
        );
      }}
    </Loaded>
  );
}
