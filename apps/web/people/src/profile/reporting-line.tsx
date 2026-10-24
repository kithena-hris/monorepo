import { Avatar, AvatarGroup, PageSection, PersonCard, Tooltip } from '@reach/ui';
import type { JSX } from 'react';
import { t } from '../i18n';

/**
 * Who somebody reports to, from the top of the organisation down to them,
 * and who else reports to their manager. Only people the viewer may read:
 * the line stops where their access does.
 */

export interface LinePerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly avatarUrl: string | null;
}

export interface ReportingLineState {
  readonly chain: readonly LinePerson[];
  readonly peers: readonly LinePerson[];
  readonly morePeers: boolean;
}

const profileOf = (id: string): string => `/people/${id}`;

export function ReportingLine({
  line,
  person,
}: {
  readonly line: ReportingLineState;
  /** Whose profile this is, at the foot of the line. */
  readonly person: {
    readonly name: string;
    readonly title: string | null;
    readonly avatarUrl: string | null;
  };
}): JSX.Element | null {
  if (line.chain.length === 0 && line.peers.length === 0) return null;
  const firstName = person.name.split(' ')[0] ?? person.name;
  return (
    <PageSection surface title={t('profile.reporting-line.reporting_line', 'Reporting line')}>
      <div className="flex flex-col gap-5">
        {/* The chain as the org chart draws it: a card each, joined by a rule. */}
        <ol
          aria-label={t('profile.reporting-line.s_reporting_line', '{{name}}’s reporting line', {
            name: person.name,
          })}
          className="flex flex-col"
        >
          {line.chain.map((p) => (
            <li key={p.id} className="flex flex-col">
              <PersonCard
                layout="row"
                name={p.name}
                description={p.title ?? undefined}
                href={profileOf(p.id)}
                {...(p.avatarUrl === null ? {} : { avatarSrc: p.avatarUrl })}
              />
              <span aria-hidden className="mx-auto h-3.5 w-0.5 bg-border-strong" />
            </li>
          ))}
          <li>
            <PersonCard
              layout="row"
              selected
              name={person.name}
              description={person.title ?? undefined}
              {...(person.avatarUrl === null ? {} : { avatarSrc: person.avatarUrl })}
            />
          </li>
        </ol>
        {line.peers.length === 0 ? null : (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm text-fg-muted">
              {line.morePeers
                ? t(
                    'profile.reporting-line.more_peers_same_manager',
                    {
                      one: 'More than {{count}} peer with the same manager as {{firstName}}',
                      other: 'More than {{count}} peers with the same manager as {{firstName}}',
                    },
                    { count: line.peers.length, firstName },
                  )
                : t(
                    'profile.reporting-line.peers_same_manager',
                    {
                      one: '{{count}} peer with the same manager as {{firstName}}',
                      other: '{{count}} peers with the same manager as {{firstName}}',
                    },
                    { count: line.peers.length, firstName },
                  )}
            </p>
            <AvatarGroup
              max={8}
              total={line.peers.length}
              aria-label={t('profile.reporting-line.peers', 'Peers: {{join}}', {
                join: line.peers.map((p) => p.name).join(', '),
              })}
            >
              {line.peers.map((p) => (
                <Tooltip
                  key={p.id}
                  content={
                    p.title === null
                      ? p.name
                      : t('profile.reporting-line.text', '{{name}}, {{title}}', {
                          name: p.name,
                          title: p.title,
                        })
                  }
                >
                  <a href={profileOf(p.id)} aria-label={p.name} className="rounded-full">
                    <Avatar size="md" name={p.name} src={p.avatarUrl ?? undefined} />
                  </a>
                </Tooltip>
              ))}
            </AvatarGroup>
          </div>
        )}
      </div>
    </PageSection>
  );
}
