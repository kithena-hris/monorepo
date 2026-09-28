import { Avatar, AvatarGroup, PageSection, Timeline, TimelineItem, Tooltip } from '@reach/ui';
import type { JSX } from 'react';

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
    <PageSection surface title="Reporting line">
      <div className="flex flex-col gap-5">
        <Timeline aria-label={`${person.name}’s reporting line`}>
          {line.chain.map((p) => (
            <TimelineItem
              key={p.id}
              marker={<Avatar size="sm" name={p.name} src={p.avatarUrl ?? undefined} />}
              title={
                <a href={profileOf(p.id)} className="underline-offset-4 hover:underline">
                  {p.name}
                </a>
              }
            >
              {p.title ?? ''}
            </TimelineItem>
          ))}
          <TimelineItem
            last
            tone="accent"
            marker={<Avatar size="sm" name={person.name} src={person.avatarUrl ?? undefined} />}
            title={<span className="font-semibold">{person.name}</span>}
          >
            {person.title ?? ''}
          </TimelineItem>
        </Timeline>
        {line.peers.length === 0 ? null : (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm text-fg-muted">
              {line.morePeers ? 'More than ' : ''}
              {String(line.peers.length)} {line.peers.length === 1 ? 'peer' : 'peers'} with the same
              manager as {firstName}
            </p>
            <AvatarGroup
              max={8}
              total={line.peers.length}
              aria-label={`Peers: ${line.peers.map((p) => p.name).join(', ')}`}
            >
              {line.peers.map((p) => (
                <Tooltip key={p.id} content={p.title === null ? p.name : `${p.name}, ${p.title}`}>
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
