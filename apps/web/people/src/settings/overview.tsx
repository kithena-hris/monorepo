import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  KeyValues,
  PageHeader,
  Stack,
  icons,
} from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * People's settings, read back before anybody opens one (the Settings page's
 * People entry).
 *
 * One card per setting, the way a console lays out its configuration: what
 * it is, one sentence on what it governs, then what is set now. The whole
 * card is the link to change it. A setting this viewer may not open is not
 * loaded and not drawn, rather than shown and refused.
 */
export interface PeopleSettingsState {
  readonly fields: {
    readonly published: { readonly version: number; readonly publishedAt: string } | null;
    readonly unpublishedChanges: number;
    readonly fields: readonly unknown[];
  } | null;
  readonly organisation: {
    readonly settings: {
      readonly defaultTimeZone: string;
      readonly cohortMinimum: number;
      readonly photoAtSignup?: string;
    };
    readonly legalEntities: readonly { readonly archived: boolean }[];
    readonly locations: readonly { readonly archived: boolean }[];
    readonly retentionFloors: readonly { readonly status: string }[];
  } | null;
  readonly roles: {
    readonly people: readonly { readonly roles: readonly string[] }[];
  } | null;
  readonly integrations: {
    readonly endpoints: readonly { readonly enabled: boolean }[];
    readonly scim: {
      readonly connections: readonly {
        readonly system: string;
        readonly revokedAt: string | null;
        readonly linked: number;
      }[];
    } | null;
  } | null;
}

export interface PeopleSettingsProps {
  readonly load: Loadable<PeopleSettingsState>;
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

export function PeopleSettings({ load }: PeopleSettingsProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="People settings"
        description="How People works for everybody here. Open a setting to change it."
      />
      <Loaded load={load} what="People settings">
        {(data) => <Cards data={data} />}
      </Loaded>
    </Stack>
  );
}

function Cards({ data }: { readonly data: PeopleSettingsState }): JSX.Element {
  const cards: ReactNode[] = [];

  if (data.fields !== null) {
    const { published, unpublishedChanges, fields } = data.fields;
    cards.push(
      <SettingCard
        key="fields"
        href="/settings/people/fields"
        icon={<icons.document aria-hidden />}
        title="Employee fields"
        description="The details People keeps on each person: what they are, who sees them, and when they are asked."
        items={[
          { label: 'Fields', value: String(fields.length) },
          {
            label: 'Published',
            value:
              published === null
                ? 'Not yet'
                : `Version ${String(published.version)}, ${day(published.publishedAt)}`,
          },
          {
            label: 'Unpublished changes',
            value:
              unpublishedChanges === 0 ? (
                'None'
              ) : (
                <Badge tone="attention">{plural(unpublishedChanges, 'change')}</Badge>
              ),
          },
        ]}
      />,
    );
  }

  if (data.organisation !== null) {
    const o = data.organisation;
    const live = (xs: readonly { archived: boolean }[]): number =>
      xs.filter((x) => !x.archived).length;
    const unreviewed = o.retentionFloors.filter((f) => f.status !== 'reviewed').length;
    cards.push(
      <SettingCard
        key="organisation"
        href="/settings/people/organisation"
        icon={<icons.organisation aria-hidden />}
        title="Organisation"
        description="Legal entities, work locations, employee numbering, the default time zone and retention."
        items={[
          { label: 'Legal entities', value: String(live(o.legalEntities)) },
          { label: 'Work locations', value: String(live(o.locations)) },
          { label: 'Default time zone', value: o.settings.defaultTimeZone },
          {
            label: 'Photo at sign-up',
            value:
              o.settings.photoAtSignup === 'required'
                ? 'Asked first'
                : o.settings.photoAtSignup === 'optional'
                  ? 'Asked, can skip'
                  : 'Not asked',
          },
          {
            label: 'Smallest group reported',
            value: plural(o.settings.cohortMinimum, 'person', 'people'),
          },
          {
            label: 'Retention periods',
            value:
              unreviewed === 0 ? (
                'Reviewed'
              ) : (
                <Badge tone="attention">{`${String(unreviewed)} waiting for legal review`}</Badge>
              ),
          },
        ]}
      />,
    );
  }

  if (data.roles !== null) {
    const holding = (role: string): number =>
      data.roles?.people.filter((p) => p.roles.includes(role)).length ?? 0;
    cards.push(
      <SettingCard
        key="roles"
        href="/settings/people/roles"
        icon={<icons.people aria-hidden />}
        title="Roles"
        description="Who is an HR member, a People administrator or in finance here."
        items={[
          { label: 'People administrators', value: String(holding('people_admin')) },
          { label: 'HR members', value: String(holding('hr')) },
          { label: 'Finance', value: String(holding('finance')) },
        ]}
      />,
    );
  }

  if (data.integrations !== null) {
    const live = data.integrations.scim?.connections.filter((c) => c.revokedAt === null) ?? [];
    const enabled = data.integrations.endpoints.filter((e) => e.enabled).length;
    cards.push(
      <SettingCard
        key="integrations"
        href="/settings/people/integrations"
        icon={<icons.link aria-hidden />}
        title="Integrations"
        description="Webhooks that tell other systems about changes, and provisioning from an identity provider."
        items={[
          {
            label: 'Webhooks',
            value:
              data.integrations.endpoints.length === 0
                ? 'None'
                : `${String(enabled)} of ${String(data.integrations.endpoints.length)} on`,
          },
          {
            label: 'Provisioning',
            value:
              live.length === 0
                ? 'Not connected'
                : live
                    .map((c) => `${c.system}, ${plural(c.linked, 'person', 'people')} linked`)
                    .join('; '),
          },
        ]}
      />,
    );
  }

  if (cards.length === 0) {
    return (
      <EmptyState
        title="Nothing here for you to change"
        description="People's settings are for its administrators and HR. Ask one of them if something needs changing."
      />
    );
  }
  return <div className="grid gap-4 md:grid-cols-2">{cards}</div>;
}

function SettingCard({
  href,
  icon,
  title,
  description,
  items,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly items: readonly { readonly label: string; readonly value: ReactNode }[];
}): JSX.Element {
  return (
    // The whole card is the link, through the title's anchor stretched over
    // it (Card's documented way): one tab stop, named by the title.
    <Card interactive className="relative">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-fg-muted [&_svg]:size-5">{icon}</span>
          <CardTitle level={2}>
            <a href={href} className="after:absolute after:inset-0 focus-visible:outline-none">
              {title}
            </a>
          </CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <KeyValues items={items} columns={2} aria-label={`${title}, now`} />
      </CardContent>
    </Card>
  );
}
