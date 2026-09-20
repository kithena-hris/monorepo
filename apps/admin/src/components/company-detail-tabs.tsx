'use client';

import {
  Alert,
  Badge,
  DonutChart,
  PageSection,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  icons,
} from '@reach/ui';
import { useMemo, type JSX, type ReactNode } from 'react';

import { EmployeeActions, type EmployeeActionResult } from './employee-actions';
import { InviteEmployeeDialog } from './invite-employee-dialog';
import type { InviteResult } from './invite-employee-form';

const VisibleIcon = icons.visible;
const HiddenIcon = icons.hidden;

export interface DetailPerson {
  id: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface DetailTheme {
  name: string;
  accent: string;
  contrastOnWhite: number;
}

export interface CompanyDetailTabsProps {
  readonly companyName: string;
  /**
   * Rendered on the server and handed down, rather than built here.
   *
   * This component is a client one — the tabs need state — and the address card
   * awaits a weather lookup. Passing the finished element as a prop is what
   * lets that lookup sit behind its own `Suspense` on the page: the tabs render
   * immediately, and the card swaps in when the sky arrives.
   */
  readonly addressCard: ReactNode;
  readonly people: readonly DetailPerson[];
  readonly brandingPublic: boolean;
  readonly hasLogo: boolean;
  readonly hasCover: boolean;
  readonly theme: DetailTheme | null;
  readonly invite: (previous: InviteResult | null, form: FormData) => Promise<InviteResult>;
  /** Issues a fresh link for one person: an invitation, or recovery if they enrolled. */
  readonly resend: (
    accountId: string,
    email: string,
    status: string,
  ) => Promise<EmployeeActionResult>;
  readonly withdraw: (accountId: string) => Promise<EmployeeActionResult>;
}

/**
 * One company, in three views.
 *
 * Tabs rather than one column, because the three things an operator comes here
 * for are read at different times and only one of them is ever urgent: who can
 * sign in, where the company is, and what their login page looks like. Stacked,
 * the third pushed the second off the screen and the first was the reason
 * anybody opened the page.
 *
 * Every number is derived from the rows on this page. The registry holds no
 * metrics and this screen deliberately does not read a module's schema for any,
 * so what is drawn here is what `platform.*` already knows.
 */
export function CompanyDetailTabs({
  companyName,
  addressCard,
  people,
  brandingPublic,
  hasLogo,
  hasCover,
  theme,
  invite,
  resend,
  withdraw,
}: CompanyDetailTabsProps): JSX.Element {
  const counts = useMemo(() => {
    const active = people.filter((person) => person.status === 'active').length;
    const invited = people.filter((person) => person.status === 'invited').length;
    return { active, invited, other: people.length - active - invited };
  }, [people]);

  return (
    <Stack gap={8}>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="people">Employees ({people.length})</TabsTrigger>
          <TabsTrigger value="branding">Sign-in page</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-2">
            <PageSection
              title="Who can sign in"
              description="Every employee the registry holds for this company."
              surface
            >
              {people.length === 0 ? (
                <Alert tone="warning" title="Nobody can sign in">
                  This company has no employee accounts at all.
                </Alert>
              ) : (
                <DonutChart
                  label="Employees by state"
                  size={190}
                  data={(
                    [
                      { label: 'Can sign in', value: counts.active, tone: 'success' },
                      { label: 'Awaiting enrolment', value: counts.invited, tone: 'warning' },
                      { label: 'Other', value: counts.other, tone: 'neutral' },
                    ] as const
                  ).filter((slice) => slice.value > 0)}
                  center={
                    <span className="flex flex-col items-center">
                      <span className="text-lg font-semibold">{people.length}</span>
                      <span className="text-fg-muted text-xs">employees</span>
                    </span>
                  }
                />
              )}
            </PageSection>

            {addressCard}
          </div>
        </TabsContent>

        <TabsContent value="people">
          <PageSection
            title="Employees"
            description={`${String(people.length)} ${people.length === 1 ? 'employee' : 'employees'} in the registry.`}
            actions={<InviteEmployeeDialog action={invite} companyName={companyName} />}
            surface
          >
            {people.length === 0 ? (
              <Alert tone="warning" title="Nobody can sign in">
                This company has no employee accounts at all.
              </Alert>
            ) : (
              <Table aria-label={`People at ${companyName}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    {/* Named for assistive tech, blank on screen: a column of
                        identical menu buttons does not need a heading read out
                        before each one. */}
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="truncate">{person.email}</TableCell>
                      <TableCell>
                        <Badge dot tone={badgeTone(person.status)}>
                          {person.status}
                        </Badge>
                      </TableCell>
                      <TableCell numeric>
                        <time dateTime={person.createdAt} className="text-fg-muted text-sm">
                          {formatDate(person.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="w-px">
                        {/*
                          The actions are bound to this row here rather than
                          passed the row and asked to remember it: a server
                          action closed over one account id cannot be pointed at
                          another by anything happening in the browser.
                        */}
                        <EmployeeActions
                          email={person.email}
                          status={person.status}
                          companyName={companyName}
                          resend={() => resend(person.id, person.email, person.status)}
                          withdraw={() => withdraw(person.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageSection>
        </TabsContent>

        <TabsContent value="branding">
          <PageSection
            title="What their own employees see"
            description="The accent and images on this company's sign-in page."
            surface
          >
            <Stack gap={5}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="border-border size-9 shrink-0 rounded-full border"
                  style={theme ? { background: theme.accent } : undefined}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{theme?.name ?? 'Default accent'}</span>
                  <span className="text-fg-muted text-xs">
                    {theme === null
                      ? 'No theme chosen, so the product accent is used.'
                      : `${theme.contrastOnWhite.toFixed(1)}:1 on white`}
                  </span>
                </span>
              </div>

              <dl className="grid gap-3 sm:grid-cols-3">
                <Asset label="Logo" present={hasLogo} />
                <Asset label="Cover image" present={hasCover} />
                <div>
                  <dt className="text-fg-muted text-xs">Shown before sign-in</dt>
                  <dd className="mt-1">
                    <Badge tone={brandingPublic ? 'success' : 'neutral'} dot>
                      {brandingPublic ? 'Yes' : 'Hidden'}
                    </Badge>
                  </dd>
                </div>
              </dl>

              {brandingPublic ? null : (
                <Alert tone="info" title="Branding is hidden">
                  Their logo and cover image are stored but are not shown before an employee signs in.
                </Alert>
              )}
            </Stack>
          </PageSection>
        </TabsContent>
      </Tabs>
    </Stack>
  );
}

function Asset({ label, present }: { label: string; present: boolean }): JSX.Element {
  const Icon = present ? VisibleIcon : HiddenIcon;
  return (
    <div>
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm">
        <Icon aria-hidden className="text-fg-muted size-4" />
        {present ? 'Uploaded' : 'None'}
      </dd>
    </div>
  );
}

/** The date an operator reads, not the timestamp the database stores. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * `invited` is deliberately not a warning.
 *
 * It is the correct state for somebody who has been sent a link and has not
 * used it yet, which is most of a company's first week. Colouring the normal
 * case as a problem teaches an operator to ignore the colour.
 */
function badgeTone(status: string): 'success' | 'info' | 'warning' {
  if (status === 'active') return 'success';
  if (status === 'invited') return 'info';
  return 'warning';
}
