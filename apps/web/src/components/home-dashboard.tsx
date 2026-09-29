import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  List,
  ListItem,
  PageHeader,
  Stat,
  icons,
} from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import type { HomeData } from '../lib/home';
import { since } from './since';

/**
 * The entry dashboard (N3): what needs this person across the modules they
 * have, in four figures and two lists.
 *
 * Each tile is a count People gave, with the question it answers under it,
 * and each links to where the work is done. The lists are the work itself:
 * the changes waiting for their decision, and who is starting. A company
 * without People, or a person People knows nothing about yet, gets the
 * greeting and an honest empty state rather than zeros that look like facts.
 */
export interface HomeDashboardProps {
  readonly greeting: string;
  /** "19:55 workplace time", and where. */
  readonly clock?: ReactNode;
  readonly place?: ReactNode;
  readonly data: HomeData | null;
  /** The account control a phone shows beside the title. */
  readonly account?: ReactNode;
}

function Tile({
  href,
  label,
  value,
  description,
}: {
  readonly href: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly description: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      <Stat
        label={label}
        value={value}
        description={description}
        className="h-full transition-shadow hover:shadow-md"
      />
    </a>
  );
}

export function HomeDashboard({
  greeting,
  clock,
  place,
  data,
  account,
}: HomeDashboardProps): JSX.Element {
  const approvals = data?.approvals ?? null;
  const dir = data?.directory ?? null;
  const me = data?.me ?? null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="@3xl/page:pe-64"
        title={`Hi ${greeting}`}
        meta={
          <span className="flex flex-wrap items-center gap-x-1.5 text-base font-normal text-fg-muted">
            {clock}
            {place ? <span>· {place}</span> : null}
          </span>
        }
        actions={account ? <span className="flex @3xl/page:hidden">{account}</span> : undefined}
      />

      {data === null ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              icon={<icons.inbox />}
              title="Nothing needs you yet"
              description="Requests, documents and approvals appear here as each module is switched on."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 @5xl/page:grid-cols-4 @5xl/page:gap-3.5">
            {approvals === null ? null : (
              <Tile
                href="/people/approvals"
                label="Approvals"
                value={approvals.total}
                description={approvals.isHr ? 'waiting for you' : 'of yours, waiting'}
              />
            )}
            {dir?.incomplete == null ? null : (
              <Tile
                href="/people/data-health/completeness"
                label="Incomplete records"
                value={dir.incomplete}
                description={`of ${dir.total.toLocaleString('en-GB')} people`}
              />
            )}
            {dir?.notStarted == null ? null : (
              <Tile
                href="/people/directory/list?conditions=%5B%7B%22key%22%3A%22status%22%2C%22op%22%3A%22is%22%2C%22values%22%3A%5B%22pre_hire%22%5D%7D%5D"
                label="Starting soon"
                value={dir.notStarted}
                description="hired, not started yet"
              />
            )}
            {me === null ? null : (
              <Tile
                href="/people/me"
                label="Your profile"
                value={me.missing === null || me.missing === 0 ? 'Done' : me.missing}
                description={
                  me.missing === null || me.missing === 0
                    ? 'every required detail is in'
                    : `of ${String(me.required)} required details missing`
                }
              />
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle level={2}>Needs you</CardTitle>
                {approvals !== null && approvals.total > approvals.items.length ? (
                  <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                    <a href="/people/approvals">All {approvals.total}</a>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                {approvals === null || approvals.items.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nothing is waiting for your decision.</p>
                ) : (
                  <List className="-mx-2 bg-transparent shadow-none">
                    {approvals.items.map((a) => (
                      <ListItem
                        key={a.id}
                        asChild
                        leading={<Avatar name={a.name} src={a.avatarUrl ?? undefined} size="lg" />}
                        description={
                          approvals.isHr
                            ? `${a.label} change · asked by ${a.requestedBy}`
                            : `${a.label} · waiting for HR`
                        }
                        meta={since(a.requestedAt, data.now)}
                      >
                        <a href="/people/approvals">{a.name}</a>
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle level={2}>Starting soon</CardTitle>
              </CardHeader>
              <CardContent>
                {data.starting.length === 0 ? (
                  <p className="text-sm text-fg-muted">Nobody is waiting to start.</p>
                ) : (
                  <List className="-mx-2 bg-transparent shadow-none">
                    {data.starting.map((p) => (
                      <ListItem
                        key={p.id}
                        asChild
                        leading={<Avatar name={p.name} src={p.avatarUrl ?? undefined} size="lg" />}
                        description={p.detail}
                        trailing={
                          <Badge size="sm" tone="info">
                            Starting soon
                          </Badge>
                        }
                      >
                        <a href={`/people/${p.id}`}>{p.name}</a>
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
