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
  type DataColumn,
  Textarea,
  usePages,
  icons,
} from '@reach/ui';
import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react';

import { useTyped } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import { t } from '../i18n';

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

/** What a person holds, an administrator's HR and Finance included. */
const has = (person: { readonly roles: readonly string[] }, role: TenantRole): boolean =>
  person.roles.includes(role) || (role !== 'people_admin' && person.roles.includes('people_admin'));

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
    get label(): string {
      return t('settings.roles.people_administrator', 'People administrator');
    },
    get means(): string {
      return t(
        'settings.roles.changes_the_fields_the_settings_and',
        'Changes the fields, the settings and who holds a role, and does anything HR and Finance can.',
      );
    },
    icon: <icons.permission aria-hidden />,
  },
  {
    role: 'hr',
    get label(): string {
      return t('settings.roles.hr', 'HR');
    },
    get means(): string {
      return t(
        'settings.roles.sees_and_corrects_everybodys_record',
        'Sees and corrects everybody’s record.',
      );
    },
    icon: <icons.people aria-hidden />,
  },
  {
    role: 'finance',
    get label(): string {
      return t('settings.roles.finance', 'Finance');
    },
    get means(): string {
      return t(
        'settings.roles.sees_pay_and_asks_for_full',
        'Sees pay, and asks for full values, for payroll.',
      );
    },
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
    <Loaded load={props.load} what={t('settings.roles.the_roles', 'the roles')}>
      {(state) => <Roles {...props} state={state} />}
    </Loaded>
  );
}

const nameOf = (p: RolesPerson): string =>
  p.name ??
  p.workEmail ??
  t('settings.roles.somebody_without_a_record_yet', 'Somebody without a record yet');
const accountOf = (p: RolesPerson): string => p.accountId;

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
  // An administrator holds HR's and Finance's too: counted, and shown ticked.
  const holders = (role: TenantRole) => everyHolder.filter((p) => has(p, role));
  // Held while what they read holds, so typing in the search or a page
  // landing redraws only the rows that changed.
  const viewer = state.viewerAccountId;
  const canManage = state.canManage;
  const columns = useMemo<readonly DataColumn<RolesPerson>[]>(
    () => [
      {
        id: 'person',
        header: t('settings.roles.person', 'Person'),
        cell: (person) => {
          const who = nameOf(person);
          const me = person.accountId === viewer;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={who} size="sm" />
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {who}
                  {me ? t('settings.roles.you', ' (you)') : ''}
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
          const me = person.accountId === viewer;
          const held = person.roles.includes(role);
          // HR and Finance come with administrator: ticked, and not theirs to untick here.
          const included = !held && has(person, role);
          // Nobody grants themselves a role, and the last
          // administrator cannot be removed: People refuses both,
          // and the control says so before anybody tries.
          const locked =
            !canManage ||
            included ||
            (me && !held) ||
            (held && role === 'people_admin' && admins === 1);
          return canManage ? (
            <Checkbox
              checked={held || included}
              disabled={locked}
              title={
                included
                  ? t(
                      'settings.roles.included_with_people_administrator',
                      'Included with People administrator',
                    )
                  : undefined
              }
              aria-label={
                included
                  ? t(
                      'settings.roles.for_included_with_people_administrator',
                      '{{label}} for {{who}}, included with People administrator',
                      { label, who },
                    )
                  : t('settings.roles.for', '{{label}} for {{who}}', { label, who })
              }
              onCheckedChange={(on) => {
                setPending({ person, role, grant: on === true });
              }}
            />
          ) : held || has(person, role) ? (
            <Badge tone="accent">{label}</Badge>
          ) : (
            <span
              className="text-fg-muted"
              aria-label={t('settings.roles.not', 'Not {{label}}', { label })}
            >
              —
            </span>
          );
        },
      })),
    ],
    [viewer, canManage, admins],
  );
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
        title={t('settings.roles.roles', 'Roles')}
        description={t(
          'settings.roles.who_has_administrator_hr_and_finance',
          'Who has administrator, HR and finance access. Managers and employees get theirs from the org chart, not from here.',
        )}
      />
      {/* An administrator's HR and Finance are listed as held (the owner, 17 October 2026). */}
      <p className="text-sm text-fg-muted">
        {t(
          'settings.roles.a_people_administrator_has_everything_hr',
          'A People administrator has everything HR and Finance have, so both are ticked for them, and administers every other module the company has.',
        )}
      </p>
      {state.canManage ? null : (
        <Alert tone="info">
          {t(
            'settings.roles.only_a_people_administrator_can_change',
            'Only a People administrator can change who holds a role.',
          )}
        </Alert>
      )}
      {/* What each role means and who holds it, before the table of names (S14). */}
      <ul
        className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/page:grid-cols-3"
        aria-label={t('settings.roles.roles', 'Roles')}
      >
        {ROLES.map(({ role, label, means, icon }) => {
          const held = holders(role);
          return (
            <li key={role} className="flex">
              <Card variant="outlined" padded className="flex flex-1 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={label} shape="rounded" tone="accent" size="lg" fallback={icon} />
                  <span className="text-md font-semibold">{label}</span>
                  <Badge
                    className="ms-auto"
                    aria-label={t('settings.roles.people', '{{length}} people', {
                      length: String(held.length),
                    })}
                  >
                    {held.length}
                  </Badge>
                </div>
                <p className="text-sm text-fg-muted">{means}</p>
                {held.length === 0 ? (
                  <p className="text-sm font-medium text-warning-fg">
                    {t('settings.roles.nobody_yet', 'Nobody yet')}
                  </p>
                ) : (
                  <AvatarGroup
                    size="sm"
                    max={5}
                    aria-label={t('settings.roles.who_is', 'Who is {{label}}', { label })}
                  >
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
        <Alert tone="warning" title={t('settings.roles.nobody_has_finance', 'Nobody has Finance')}>
          {t(
            'settings.roles.add_someone_or_name_a_people',
            'Add someone, or name a People administrator: they have Finance’s access too.',
          )}
        </Alert>
      ) : null}
      {state.people.length === 0 && needle === '' ? (
        <EmptyState
          title={t('settings.roles.nobody_signs_in_yet', 'Nobody signs in yet')}
          description={t(
            'settings.roles.people_appear_here_once_they_have',
            'People appear here once they have an account.',
          )}
        />
      ) : (
        <Stack gap={3}>
          <div className="w-full max-w-72 touch:max-w-none">
            <SearchField
              label={t('settings.roles.find_a_person', 'Find a person')}
              placeholder={t('settings.roles.find_a_person', 'Find a person')}
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <DataTable<RolesPerson>
            label={t('settings.roles.who_holds_a_role', 'Who holds a role')}
            rows={shown}
            rowId={accountOf}
            describeRow={nameOf}
            // Infinite: the page's one scroll, the next people loading near its
            // end, only the rows on screen drawn; cards under a finger.
            fill
            {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
            loadingMore={pages.loading}
            empty={t('settings.roles.nobody_matches', 'Nobody matches')}
            columns={columns}
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
    pending === null
      ? ''
      : (pending.person.name ??
        pending.person.workEmail ??
        t('settings.roles.this_person', 'this person'));
  const title =
    pending === null
      ? ''
      : pending.grant
        ? t('settings.roles.make', 'Make {{who}} {{labelOf}}', {
            who,
            labelOf: labelOf(pending.role),
          })
        : t('settings.roles.remove_from', 'Remove {{labelOf}} from {{who}}', {
            labelOf: labelOf(pending.role),
            who,
          });

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
            {t(
              'settings.roles.it_takes_effect_within_a_minute',
              'It takes effect within a minute, and is kept with who and why.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field required invalid={shown && empty}>
              <FieldLabel>{t('settings.roles.reason', 'Reason')}</FieldLabel>
              <FieldControl>
                <Textarea
                  value={reason}
                  maxLength={500}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t('settings.roles.up_to_500_characters', 'Up to 500 characters.')}
              </FieldDescription>
              <FieldError>{t('settings.roles.say_why', 'Say why.')}</FieldError>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title={t('settings.roles.not_changed', 'Not changed')}>
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={close}>{t('settings.roles.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel={t('settings.roles.saving', 'Saving')}
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
            {pending?.grant === false
              ? t('settings.roles.remove', 'Remove')
              : t('settings.roles.grant', 'Grant')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
