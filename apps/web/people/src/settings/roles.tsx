import {
  Alert,
  Badge,
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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@reach/ui';
import { useState, type JSX } from 'react';

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
  readonly people: readonly RolesPerson[];
}

export interface RoleSettingsProps {
  readonly load: Loadable<RolesState>;
  readonly onGrant: (accountId: string, role: TenantRole, reason: string) => Promise<Outcome>;
  readonly onRevoke: (accountId: string, role: TenantRole, reason: string) => Promise<Outcome>;
}

const ROLES: readonly {
  readonly role: TenantRole;
  readonly label: string;
  readonly means: string;
}[] = [
  { role: 'hr', label: 'HR', means: 'sees and corrects everybody’s record' },
  { role: 'finance', label: 'Finance', means: 'sees pay, and asks for full values' },
  {
    role: 'people_admin',
    label: 'People administrator',
    means: 'changes the fields, the settings and who holds a role',
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
}: RoleSettingsProps & { readonly state: RolesState }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const admins = state.people.filter((p) => p.roles.includes('people_admin')).length;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Roles"
        description={ROLES.map((r) => `${r.label} ${r.means}`).join('. ') + '.'}
      />
      {state.canManage ? null : (
        <Alert tone="info">Only a People administrator can change who holds a role.</Alert>
      )}
      {state.people.length === 0 ? (
        <EmptyState
          title="Nobody signs in yet"
          description="People appear here once they have an account."
        />
      ) : (
        <Table aria-label="Who holds a role">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              {ROLES.map((r) => (
                <TableHead key={r.role}>{r.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.people.map((person) => {
              const who = person.name ?? person.workEmail ?? 'Somebody without a record yet';
              const me = person.accountId === state.viewerAccountId;
              return (
                <TableRow key={person.accountId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {who}
                        {me ? ' (you)' : ''}
                      </span>
                      {person.name !== null && person.workEmail !== null ? (
                        <span className="text-fg-muted text-sm">{person.workEmail}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  {ROLES.map(({ role, label }) => {
                    const held = person.roles.includes(role);
                    // Nobody grants themselves a role, and the last
                    // administrator cannot be removed: People refuses both,
                    // and the control says so before anybody tries.
                    const locked =
                      !state.canManage ||
                      (me && !held) ||
                      (held && role === 'people_admin' && admins === 1);
                    return (
                      <TableCell key={role}>
                        {state.canManage ? (
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
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
