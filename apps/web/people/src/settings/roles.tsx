import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Card,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  PageHeader,
  SearchField,
  Stack,
  DataTable,
  Textarea,
  usePages,
  icons,
} from '@reach/ui';
import { useCallback, useState, type JSX, type ReactNode } from 'react';

import { useTyped } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';

/**
 * Who holds a People role, and changing it (PEO-112; PRD §6.6, §9.4).
 *
 * A People administrator ticks or unticks a role and says why; the reason is
 * kept with the change, in its event. The rules are People's and it refuses
 * whatever breaks them — a role for oneself, the last administrator — and the
 * refusal is shown here as People worded it. HR sees the same table without
 * the controls.
 */

export type TenantRole = 'hr' | 'finance' | 'people_admin';

export interface RolesPerson {
  readonly accountId: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly workEmail: string | null;
  readonly roles: readonly TenantRole[];
}

export interface RolesState {
  readonly viewerAccountId: string;
  readonly canManage: boolean;
  /** A page of everybody who signs in, or those the search finds. */
  readonly people: readonly RolesPerson[];
  /** The next page's place; null on the last. Absent from an older People. */
  readonly next?: string | null;
  /** Everybody holding a role, whatever the page. Absent from an older People. */
  readonly holders?: readonly RolesPerson[];
}

export interface RoleSettingsProps {
  readonly load: Loadable<RolesState>;
  readonly onGrant: (accountId: string, role: TenantRole, reason: string) => Promise<Outcome>;
  readonly onRevoke: (accountId: string, role: TenantRole, reason: string) => Promise<Outcome>;
  /** The search over who holds a role (`?q=`), once typing rests; People's to answer. */
  readonly search?: string;
  readonly onSearchChange?: (search: string) => void;
  /** The table's page after `after`, as People answers it (a `RolesState`), or null. */
  readonly onLoadMore?: (after: string) => Promise<unknown>;
}

const ROLES: readonly {
  readonly role: TenantRole;
  readonly label: string;
  readonly means: string;
  readonly icon: ReactNode;
}[] = [
  {
    role: 'people_admin',
    label: 'People administrator',
    means:
      'Changes the fields, the settings and who holds a role, and does anything HR and Finance can.',
    icon: <icons.permission aria-hidden />,
  },
  {
    role: 'hr',
    label: 'HR',
    means: 'Sees and corrects everybody’s record.',
    icon: <icons.people aria-hidden />,
  },
  {
    role: 'finance',
    label: 'Finance',
    means: 'Sees pay, and asks for full values, for payroll.',
    icon: <icons.payroll aria-hidden />,
  },
];

const labelOf = (role: TenantRole): string => ROLES.find((r) => r.role === role)?.label ?? role;

interface Pending {
  readonly person: RolesPerson;
  readonly role: TenantRole;
  readonly grant: boolean;
}

export function RoleSettings(props: RoleSettingsProps): JSX.Element {
  return (
    <Loaded load={props.load} what="the roles">
      {(state) => <Roles {...props} state={state} />}
    </Loaded>
  );
}

function Roles({
  state,
  onGrant,
  onRevoke,
  search,
  onSearchChange,
  onLoadMore,
}: RoleSettingsProps & { readonly state: RolesState }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const [query, setQuery] = useTyped(search ?? '', onSearchChange);
  // The table, a page at a time as it scrolls; the cards, every holder.
  const more = useCallback(
    async (after: string) => {
      const page = (await onLoadMore?.(after)) as RolesState | null | undefined;
      return page == null ? null : { items: page.people, next: page.next ?? null };
    },
    [onLoadMore],
  );
  const pages = usePages(
    state.people,
    state.next ?? null,
    onLoadMore === undefined ? undefined : more,
  );
  const everyHolder = state.holders ?? state.people;
  const admins = everyHolder.filter((p) => p.roles.includes('people_admin')).length;
  const holders = (role: TenantRole) => everyHolder.filter((p) => p.roles.includes(role));
  const nameOf = (p: RolesPerson) => p.name ?? p.workEmail ?? 'Somebody without a record yet';
  // People searches; until its answer arrives, what is loaded is narrowed here.
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ''
      ? pages.items
      : pages.items.filter((p) =>
          [p.name, p.workEmail].some((v) => v?.toLowerCase().includes(needle) === true),
        );

  return (
    <Stack gap={6}>
      <PageHeader
        title="Roles"
        description="Who has administrator, HR and finance access. Managers and employees get theirs from the org chart, not from here."
      />
      {/* What was granted is what is listed; an administrator's rights reach further (decided 2026-09-29). */}
      <p className="text-sm text-fg-muted">
        A People administrator also has everything HR and Finance have, without holding those roles.
      </p>
      {state.canManage ? null : (
        <Alert tone="info">Only a People administrator can change who holds a role.</Alert>
      )}
      {/* What each role means and who holds it, before the table of names (S14). */}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/page:grid-cols-3" aria-label="Roles">
        {ROLES.map(({ role, label, means, icon }) => {
          const held = holders(role);
          return (
            <li key={role} className="flex">
              <Card variant="outlined" padded className="flex flex-1 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={label} shape="rounded" tone="accent" size="lg" fallback={icon} />
                  <span className="text-md font-semibold">{label}</span>
                  <Badge className="ms-auto" aria-label={`${String(held.length)} people`}>
                    {held.length}
                  </Badge>
                </div>
                <p className="text-sm text-fg-muted">{means}</p>
                {held.length === 0 ? (
                  <p className="text-sm font-medium text-warning-fg">Nobody yet</p>
                ) : (
                  <AvatarGroup size="sm" max={5} aria-label={`Who is ${label}`}>
                    {held.map((p) => (
                      <Avatar key={p.accountId} name={nameOf(p)} size="sm" />
                    ))}
                  </AvatarGroup>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {holders('finance').length === 0 ? (
        <Alert tone="warning" title="Nobody is granted Finance">
          People administrators have Finance’s access until someone is added.
        </Alert>
      ) : null}
      {state.people.length === 0 && needle === '' ? (
        <EmptyState
          title="Nobody signs in yet"
          description="People appear here once they have an account."
        />
      ) : (
        <Stack gap={3}>
          <div className="w-full max-w-72 touch:max-w-none">
            <SearchField
              label="Find a person"
              placeholder="Find a person"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <DataTable<RolesPerson>
            label="Who holds a role"
            rows={shown}
            rowId={(p) => p.accountId}
            describeRow={nameOf}
            // Infinite: the page's one scroll, the next people loading near its
            // end, only the rows on screen drawn; cards under a finger.
            stickyHeader
            containerClassName="page-fill max-h-dvh min-h-96"
            {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
            loadingMore={pages.loading}
            empty="Nobody matches"
            columns={[
              {
                id: 'person',
                header: 'Person',
                cell: (person) => {
                  const who = nameOf(person);
                  const me = person.accountId === state.viewerAccountId;
                  return (
                    <div className="flex items-center gap-3">
                      <Avatar name={who} size="sm" />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {who}
                          {me ? ' (you)' : ''}
                        </span>
                        {person.name !== null && person.workEmail !== null ? (
                          <span className="text-fg-muted text-sm">{person.workEmail}</span>
                        ) : null}
                      </div>
                    </div>
                  );
                },
              },
              ...ROLES.map(({ role, label }) => ({
                id: role,
                header: label,
                shortHeader: label,
                cell: (person: RolesPerson) => {
                  const who = nameOf(person);
                  const me = person.accountId === state.viewerAccountId;
                  const held = person.roles.includes(role);
                  // Nobody grants themselves a role, and the last
                  // administrator cannot be removed: People refuses both,
                  // and the control says so before anybody tries.
                  const locked =
                    !state.canManage ||
                    (me && !held) ||
                    (held && role === 'people_admin' && admins === 1);
                  return state.canManage ? (
                    <Checkbox
                      checked={held}
                      disabled={locked}
                      aria-label={`${label} for ${who}`}
                      onCheckedChange={(on) => {
                        setPending({ person, role, grant: on === true });
                      }}
                    />
                  ) : held ? (
                    <Badge tone="accent">{label}</Badge>
                  ) : (
                    <span className="text-fg-muted" aria-label={`Not ${label}`}>
                      —
                    </span>
                  );
                },
              })),
            ]}
          />
        </Stack>
      )}
      <Confirm
        pending={pending}
        onClose={() => {
          setPending(null);
        }}
        onConfirm={(reason) =>
          pending === null
            ? Promise.resolve({ ok: true } as const)
            : (pending.grant ? onGrant : onRevoke)(pending.person.accountId, pending.role, reason)
        }
      />
    </Stack>
  );
}

/** Why, before anything changes: the reason travels with the event. */
function Confirm({
  pending,
  onClose,
  onConfirm,
}: {
  readonly pending: Pending | null;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string) => Promise<Outcome>;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const empty = reason.trim() === '';

  const close = (): void => {
    setReason('');
    setShown(false);
    setRefused(null);
    onClose();
  };

  const who =
    pending === null ? '' : (pending.person.name ?? pending.person.workEmail ?? 'this person');
  const title =
    pending === null
      ? ''
      : pending.grant
        ? `Make ${who} ${labelOf(pending.role)}`
        : `Remove ${labelOf(pending.role)} from ${who}`;

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            It takes effect within a minute, and is kept with who and why.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required invalid={shown && empty}>
              <FieldLabel>Reason</FieldLabel>
              <FieldControl>
                <Textarea
                  value={reason}
                  maxLength={500}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>Up to 500 characters.</FieldDescription>
              <FieldError>Say why.</FieldError>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not changed">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setShown(true);
              if (empty) return;
              setBusy(true);
              void onConfirm(reason.trim()).then((outcome) => {
                setBusy(false);
                if (outcome.ok) close();
                else setRefused(outcome.message);
              });
            }}
          >
            {pending?.grant === false ? 'Remove' : 'Grant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
