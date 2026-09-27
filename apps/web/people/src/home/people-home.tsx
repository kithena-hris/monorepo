import {
  Avatar,
  AvatarUploader,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type UploadedImage,
  icons,
  Nav,
  NavItem,
  NavList,
  PageHeader,
  PageSection,
  Split,
  Stack,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { FieldFiles, FileInput, type UploadOutcome } from '../record/files';
import { MissingMark } from '../record/missing';

/**
 * Where People starts: who am I here, what needs me, what is missing.
 *
 * Read top to bottom in that order. The person first, as a strip rather than
 * a card of cards — their photo, what they do, where and since when, and the
 * way to their record. Then what needs them, as lists with a way to all of
 * it: the changes waiting for a decision and the details only they can give,
 * each one a link to exactly where it is done. Beside that, narrower, the
 * reporting line as the org chart draws it: the managers above, them, the
 * people below. HR's quieter figures and every place People has come last.
 *
 * Everything here was decided by People for this viewer: a part they have no
 * use for arrives as null and is simply not drawn, and nothing on the page
 * can show a person or a field People did not hand over.
 */

export interface OverviewPerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly avatarUrl: string | null;
}

export interface PeopleHomeState {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  /** When the page was drawn: what a local time and an age are read against. */
  readonly now: string;
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly title: string | null;
    readonly department: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly location: string | null;
    readonly timeZone: string;
    readonly startedOn: string | null;
    readonly today: string;
    readonly status: string | null;
    readonly missing: number | null;
    readonly required: number;
  } | null;
  readonly reportingLine: {
    readonly managers: readonly OverviewPerson[];
    readonly moreAbove: boolean;
    readonly peers: number | null;
    readonly reports: readonly OverviewPerson[];
    readonly reportsTotal: number;
    readonly reportsFilter: string | null;
  } | null;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly items: readonly {
      readonly id: string;
      readonly personId: string;
      readonly name: string;
      readonly avatarUrl: string | null;
      readonly label: string;
      readonly requestedAt: string;
      readonly requestedBy: string;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly section: string;
    /** Null: the viewer fills it in. */
    readonly ownedBy: string | null;
  }[];
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
  /**
   * What signing up still asks of them: a photo, and image or document fields
   * collected at sign-up. Absent or null when nothing is left.
   */
  readonly setup?: {
    readonly photo: 'optional' | 'required' | null;
    readonly fields: readonly SetupField[];
  } | null;
}

export interface SetupField {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly required: boolean;
}

export type PhotoOutcome =
  | { readonly ok: true; readonly avatarUrl: string | null }
  | { readonly ok: false; readonly message: string };

export interface PeopleHomeProps {
  readonly load: Loadable<PeopleHomeState>;
  /** Their own photo, uploaded by the shell. */
  readonly onPhoto?: (file: File) => Promise<PhotoOutcome>;
  /** A sign-up file: uploaded, then saved to the field, by the shell. */
  readonly onSetupFile?: (field: SetupField, file: File) => Promise<UploadOutcome>;
}

/* ------------------------------------------------------------- words -- */

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago": how long something has waited, in days. */
export function waited(since: string, now: string): string {
  const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / DAY));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${String(days)} days ago`;
  return `${String(Math.floor(days / 30))} months ago`;
}

/** "2 years, 3 months": whole months from a start date to today, both calendar dates. */
export function tenure(startedOn: string, today: string): string | null {
  const [y1, m1, d1] = startedOn.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => n === undefined || Number.isNaN(n))) return null;
  const months =
    ((y2 ?? 0) - (y1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0)) - ((d2 ?? 0) < (d1 ?? 0) ? 1 : 0);
  if (months < 0) return null;
  if (months === 0) return 'less than a month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
  return [years > 0 ? plural(years, 'year') : null, rest > 0 ? plural(rest, 'month') : null]
    .filter((x) => x !== null)
    .join(', ');
}

const longDate = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

const localTime = (now: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone }).format(new Date(now));
  } catch {
    return '';
  }
};

const STATUS: Readonly<
  Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }>
> = {
  active: { label: 'Active', tone: 'success' },
  pre_hire: { label: 'Starting soon', tone: 'info' },
  provisional: { label: 'Not hired yet', tone: 'neutral' },
  on_leave: { label: 'On leave', tone: 'info' },
  notice: { label: 'On notice', tone: 'warning' },
};

/* -------------------------------------------------------------- parts -- */

/** A detail with its icon: the icon is decoration, the words carry it. */
function Detail({
  icon,
  children,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
      <span aria-hidden className="shrink-0 text-fg-subtle [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

function Identity({
  me,
  now,
}: {
  readonly me: NonNullable<PeopleHomeState['me']>;
  readonly now: string;
}): JSX.Element {
  const role = [me.title, me.department].filter((x) => x !== null).join(' · ');
  const status = me.status === null ? undefined : STATUS[me.status];
  const time = localTime(now, me.timeZone);
  const since = me.startedOn === null ? null : tenure(me.startedOn, me.today);
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
      <Avatar size="3xl" name={me.name} src={me.avatarUrl ?? undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <PageHeader
          title={me.name}
          description={role === '' ? undefined : role}
          meta={
            <>
              {status === undefined ? null : <Badge tone={status.tone}>{status.label}</Badge>}
              {me.missing === null || me.missing === 0 ? null : <MissingMark count={me.missing} />}
            </>
          }
          actions={
            <Button asChild variant={me.missing ? 'secondary' : 'primary'}>
              <a href="/people/me">View your profile</a>
            </Button>
          }
        />
        <ul aria-label="Your details" className="flex flex-wrap gap-x-6 gap-y-2">
          {me.location === null ? null : (
            <Detail icon={<icons.location />}>
              {me.location}
              {time === '' ? null : <span className="tabular-nums">, {time} local time</span>}
            </Detail>
          )}
          {me.startedOn === null ? null : (
            <Detail icon={<icons.calendar />}>
              Joined {longDate(me.startedOn)}
              {since === null ? null : ` · ${since}`}
            </Detail>
          )}
          {me.email === null ? null : (
            <Detail icon={<icons.email />}>
              <a className="relative tap-target underline-offset-4 hover:underline" href={`mailto:${me.email}`}>
                {me.email}
              </a>
            </Detail>
          )}
          {me.phone === null ? null : (
            <Detail icon={<icons.phone />}>
              <a className="relative tap-target underline-offset-4 hover:underline" href={`tel:${me.phone}`}>
                {me.phone}
              </a>
            </Detail>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Done, said quietly: the state is good news, not an empty page. */
function Done({ title, detail }: { readonly title: string; readonly detail: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 shrink-0 text-success-fg [&_svg]:size-4">
        <icons.success />
      </span>
      <p className="max-w-prose text-sm text-fg-muted">
        <span className="font-medium text-fg">{title}.</span> {detail}
      </p>
    </div>
  );
}

/** A "Show all" that is a link, because it goes somewhere. */
function ShowAll({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
      <a href={href}>{children}</a>
    </Button>
  );
}

function Approvals({
  approvals,
  now,
}: {
  readonly approvals: NonNullable<PeopleHomeState['approvals']>;
  readonly now: string;
}): JSX.Element {
  const title = approvals.isHr ? 'Waiting for your approval' : 'Your changes waiting for approval';
  return (
    <PageSection
      surface
      title={title}
      description={
        approvals.total === 0
          ? undefined
          : `${String(approvals.total)} ${approvals.total === 1 ? 'change' : 'changes'}, oldest first`
      }
      actions={
        approvals.total > approvals.items.length || approvals.total > 0 ? (
          <ShowAll href="/people/approvals">
            {approvals.total > approvals.items.length
              ? `Show all ${String(approvals.total)}`
              : 'Open approvals'}
          </ShowAll>
        ) : undefined
      }
    >
      {approvals.items.length === 0 ? (
        <Done
          title="Nothing waiting"
          detail={
            approvals.isHr
              ? 'When somebody changes a detail that needs HR’s approval, it lands here first.'
              : 'Changes you make that need HR’s approval wait here until they decide.'
          }
        />
      ) : (
        <Nav as="div" label={title} className="-mx-2.5">
          <NavList>
            {approvals.items.map((a) => (
              <NavItem
                key={a.id}
                level={2}
                href="/people/approvals"
                className="py-2"
                icon={<Avatar size="md" name={a.name} src={a.avatarUrl ?? undefined} />}
                badge={
                  <span className="text-xs text-fg-muted tabular-nums">
                    {waited(a.requestedAt, now)}
                  </span>
                }
              >
                <Lines first={`${a.name} · ${a.label}`} second={`Asked by ${a.requestedBy}`} />
              </NavItem>
            ))}
          </NavList>
        </Nav>
      )}
    </PageSection>
  );
}

function Missing({
  missing,
  required,
}: {
  readonly missing: PeopleHomeState['missing'];
  readonly required: number;
}): JSX.Element {
  const yours = missing.filter((m) => m.ownedBy === null);
  const theirs = missing.filter((m) => m.ownedBy !== null);
  return (
    <PageSection
      surface
      title="Your missing information"
      description={
        missing.length === 0
          ? undefined
          : `${String(missing.length)} of ${String(required)} required ${required === 1 ? 'detail' : 'details'} missing`
      }
      actions={
        missing.length === 0 ? undefined : <ShowAll href="/people/me">Open your profile</ShowAll>
      }
    >
      {missing.length === 0 ? (
        <Done
          title="Your record is complete"
          detail="Everything People asks of you is filled in. If a new detail is needed, it shows up here."
        />
      ) : (
        <Stack gap={4}>
          {yours.length === 0 ? null : (
            <Nav as="div" label="For you to add" className="-mx-2.5">
              <NavList>
                {yours.map((m) => (
                  <NavItem
                    key={m.key}
                    level={2}
                    href={`/people/me?field=${encodeURIComponent(m.key)}`}
                    className="py-2"
                    icon={<icons.warning className="text-warning-fg" />}
                    badge={<span className="text-sm font-medium text-accent-fg">Add</span>}
                  >
                    <Lines first={m.label} second={m.section} />
                  </NavItem>
                ))}
              </NavList>
            </Nav>
          )}
          {theirs.length === 0 ? null : (
            <div>
              <p className="text-xs text-fg-muted">
                Waiting on {[...new Set(theirs.map((m) => m.ownedBy))].join(' and ')}, nothing for
                you to do:
              </p>
              <ul aria-label="Waiting on somebody else" className="mt-1.5 flex flex-wrap gap-2">
                {theirs.map((m) => (
                  <li key={m.key}>
                    <Badge size="sm">{m.label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Stack>
      )}
    </PageSection>
  );
}

/** A row's two lines: what it is, then the detail. */
function Lines({
  first,
  second,
}: {
  readonly first: ReactNode;
  readonly second?: ReactNode;
}): JSX.Element {
  return (
    <>
      <span className="block truncate font-medium text-fg">{first}</span>
      {second === undefined || second === null ? null : (
        <span className="block truncate text-xs text-fg-muted">{second}</span>
      )}
    </>
  );
}

/** One person in the line: their photo, name and title, and a link to them. */
function Member({ person }: { readonly person: OverviewPerson }): JSX.Element {
  return (
    <NavItem
      level={2}
      href={`/people/${person.id}`}
      className="py-2"
      icon={<Avatar size="md" name={person.name} src={person.avatarUrl ?? undefined} />}
    >
      <Lines first={person.name} second={person.title} />
    </NavItem>
  );
}

function ReportingLine({
  line,
  me,
}: {
  readonly line: NonNullable<PeopleHomeState['reportingLine']>;
  readonly me: NonNullable<PeopleHomeState['me']>;
}): JSX.Element {
  // Top of the chart first, as an org chart reads.
  const above = line.managers.toReversed();
  const top = above[0];
  return (
    <PageSection surface title="Your reporting line">
      <Stack gap={4}>
        {/* The chain, top down to them; one rule joins the photos, as a chart draws it. */}
        <Nav as="div" label="Your managers, from the top" className="relative -mx-2.5">
          <span aria-hidden className="absolute top-5 bottom-5 left-[1.625rem] w-px bg-border" />
          {line.moreAbove && top !== undefined ? (
            <p className="relative py-1 ps-12 text-xs text-fg-muted">
              <a className="underline underline-offset-4" href={`/people/${top.id}`}>
                The line goes on above {top.name}
              </a>
            </p>
          ) : null}
          <NavList className="relative">
            {above.map((m) => (
              <Member key={m.id} person={m} />
            ))}
          </NavList>
          <div className="relative flex items-center gap-2.5 px-2.5 py-2 text-sm">
            <Avatar size="md" name={me.name} src={me.avatarUrl ?? undefined} />
            <span className="min-w-0">
              <Lines
                first={
                  <>
                    {me.name} <span className="font-normal text-fg-muted">(you)</span>
                  </>
                }
                second={me.title}
              />
            </span>
          </div>
        </Nav>
        {line.peers === null || line.managers.length === 0 ? null : (
          <p className="text-xs text-fg-muted">
            {line.peers === 0
              ? `Nobody else reports to ${line.managers[0]?.name ?? 'your manager'}.`
              : `${String(line.peers)} ${line.peers === 1 ? 'other person reports' : 'others report'} to ${line.managers[0]?.name ?? 'your manager'}.`}
          </p>
        )}
        {line.reportsTotal === 0 ? null : (
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">
                Your direct reports{' '}
                <span className="font-normal text-fg-muted tabular-nums">{line.reportsTotal}</span>
              </h3>
              {line.reportsFilter === null ? null : (
                <ShowAll
                  href={`/people/directory?filter=${encodeURIComponent(line.reportsFilter)}`}
                >
                  {line.reportsTotal > line.reports.length
                    ? `Show all ${String(line.reportsTotal)}`
                    : 'In the directory'}
                </ShowAll>
              )}
            </div>
            <Nav as="div" label="Your direct reports" className="-mx-2.5 mt-1">
              <NavList>
                {line.reports.map((r) => (
                  <Member key={r.id} person={r} />
                ))}
              </NavList>
            </Nav>
          </div>
        )}
      </Stack>
    </PageSection>
  );
}

/* --------------------------------------------------------------- page -- */

/**
 * What signing up still asks of them, first on the first screen they land on
 * (the sign-up page itself is identity's, and never holds a file): their
 * photo when the company asks for one, and any image or document the company
 * collects at sign-up. Each is kept as soon as it is chosen. What is optional
 * can wait; the card goes once nothing is left.
 */
function Setup({
  setup,
  name,
  onPhoto,
  onSetupFile,
}: {
  readonly setup: NonNullable<PeopleHomeState['setup']>;
  readonly name: string;
  readonly onPhoto: PeopleHomeProps['onPhoto'];
  readonly onSetupFile: PeopleHomeProps['onSetupFile'];
}): JSX.Element | null {
  const [later, setLater] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly UploadedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const required =
    setup.photo === 'required' ||
    setup.fields.some((f) => f.required && !done.has(f.key));
  if (later && !required) return null;
  const byKey = new Map(setup.fields.map((f) => [f.key, f]));

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Finish setting up your account</CardTitle>
        <CardDescription>
          {required
            ? 'Your company asks for these before anything else. Each is saved as soon as you choose it.'
            : 'Your company would like these. Each is saved as soon as you choose it.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={5}>
          {setup.photo === null || onPhoto === undefined ? null : (
            <AvatarUploader
              label={setup.photo === 'required' ? 'Your photo (required)' : 'Your photo'}
              hint={
                busy
                  ? 'Uploading…'
                  : (photoProblem ?? 'A clear photo of your face, so colleagues know who you are.')
              }
              value={picked}
              src={photo}
              fallback={<Avatar size="xl" name={name} className="ring-0" />}
              accept={['image/png', 'image/jpeg', 'image/webp']}
              maxSize={20 * 1024 * 1024}
              disabled={busy}
              invalid={photoProblem !== null}
              onReject={(rejections) => {
                setPhotoProblem(rejections[0]?.message ?? 'That image was not accepted.');
              }}
              onChange={(next) => {
                const file = next[0]?.file;
                setPicked(next);
                setPhotoProblem(null);
                if (file === undefined) return;
                setBusy(true);
                void onPhoto(file).then((outcome) => {
                  setBusy(false);
                  if (outcome.ok) setPhoto(outcome.avatarUrl);
                  else {
                    setPhotoProblem(outcome.message);
                    setPicked([]);
                  }
                });
              }}
            />
          )}
          {setup.fields.length === 0 || onSetupFile === undefined ? null : (
            <FieldFiles.Provider
              value={{
                known: new Map(),
                upload: (key, file) => {
                  const field = byKey.get(key);
                  if (field === undefined) {
                    return Promise.resolve({ ok: false, message: 'No such field' });
                  }
                  return onSetupFile(field, file).then((outcome) => {
                    if (outcome.ok) setDone((d) => new Set([...d, key]));
                    return outcome;
                  });
                },
              }}
            >
              {setup.fields.map((f) => (
                <FileInput
                  key={f.key}
                  field={{
                    key: f.key,
                    label: f.label,
                    description: f.description,
                    dataType: f.dataType as 'image' | 'document_ref',
                    options: [],
                    required: f.required,
                    readOnly: false,
                  }}
                  value={null}
                  invalid={false}
                  description={f.description ?? ''}
                  onChange={() => undefined}
                />
              ))}
            </FieldFiles.Provider>
          )}
          {required ? null : (
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setLater(true);
                }}
              >
                Later
              </Button>
            </div>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function PeopleHome({ load, onPhoto, onSetupFile }: PeopleHomeProps): JSX.Element {
  return (
    <Loaded load={load} what="your overview">
      {(state) => {
        const { me, reportingLine, approvals, team } = state;
        const main = (
          <Stack gap={6}>
            {approvals === null ? null : <Approvals approvals={approvals} now={state.now} />}
            {me === null ? null : <Missing missing={state.missing} required={me.required} />}
          </Stack>
        );
        return (
          <Stack gap={8}>
            {me === null || state.setup == null ? null : (
              <Setup
                setup={state.setup}
                name={me.name}
                onPhoto={onPhoto}
                onSetupFile={onSetupFile}
              />
            )}
            {me === null ? (
              <PageHeader
                title="People"
                description="Your account is not linked to anybody’s record, so there is no profile to show."
              />
            ) : (
              <Identity me={me} now={state.now} />
            )}
            {me !== null && reportingLine !== null ? (
              <Split aside={<ReportingLine line={reportingLine} me={me} />} gap={6}>
                {main}
              </Split>
            ) : (
              main
            )}
            {team === null ? null : (
              <PageSection
                title="Everybody’s records"
                actions={<ShowAll href="/people/completeness">Missing information</ShowAll>}
              >
                <p className="max-w-prose text-sm text-fg-muted">
                  <span className="font-medium text-fg tabular-nums">{team.toFill}</span>{' '}
                  {team.toFill === 1 ? 'detail waits' : 'details wait'} for HR to fill in, and{' '}
                  <span className="font-medium text-fg tabular-nums">{team.waiting}</span>{' '}
                  {team.waiting === 1 ? 'person has' : 'people have'} something of their own to add.
                </p>
              </PageSection>
            )}
          </Stack>
        );
      }}
    </Loaded>
  );
}
