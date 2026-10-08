import {
  Alert,
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  List,
  ListItem,
  SearchField,
  Switch,
  Text,
} from '@reach/ui-native';
import { ShieldCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import { ReasonDialog } from '../employment';
import type { PeopleScreen } from '../routes';

type Role = 'hr' | 'finance' | 'people_admin';

interface RolesPerson {
  readonly accountId: string;
  readonly personId: string | null;
  readonly name: string | null;
  readonly workEmail: string | null;
  readonly roles: readonly Role[];
}

interface RolesState {
  readonly viewerAccountId: string;
  readonly canManage: boolean;
  readonly people: readonly RolesPerson[];
  readonly next: string | null;
  readonly holders: readonly RolesPerson[];
}

const ROLES: readonly { role: Role; label: string; means: string }[] = [
  {
    role: 'people_admin',
    label: 'People administrator',
    means:
      'Changes the fields, the settings and who holds a role, and does anything HR and Finance can.',
  },
  { role: 'hr', label: 'HR', means: 'Sees and corrects everybody’s record.' },
  { role: 'finance', label: 'Finance', means: 'Sees pay, and asks for full values, for payroll.' },
];
const labelOf = (role: Role): string => ROLES.find((r) => r.role === role)?.label ?? role;
const nameOf = (p: RolesPerson): string => p.name ?? p.workEmail ?? 'Somebody without a record yet';

/**
 * Roles (design H4): who holds administrator, HR and finance access. Tapping
 * a person opens their roles; each change asks for a reason, kept with it.
 * People refuses a role for oneself and removing the last administrator, and
 * the switches say so before anybody tries.
 */
export function Roles({ navigation }: PeopleScreen<'Roles'>): React.JSX.Element {
  const signed = useSigned();
  const [state, setState] = useState<RolesState | null>(null);
  const [rows, setRows] = useState<readonly RolesPerson[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<RolesPerson | null>(null);
  const [more, setMore] = useState(false);
  const round = useRef(0);

  const load = async (search: string): Promise<void> => {
    const mine = ++round.current;
    const answer = await ask<RolesState>(signed, 'RoleSettings', {
      search: search === '' ? null : search,
      after: null,
    });
    if (mine !== round.current) return;
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setFailed(null);
    setState(answer.data);
    setRows(answer.data.people);
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(typed.trim()), typed === '' ? 0 : 300);
    return () => {
      clearTimeout(timer);
    };
  }, [signed, typed]);

  const back = { label: 'Settings', onPress: navigation.goBack };
  if (failed !== null) {
    return (
      <Page title="Roles" back={back}>
        <Failed message={failed} onRetry={() => void load(typed.trim())} />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title="Roles" back={back}>
        <Loading label="Loading the roles" />
      </Page>
    );
  }
  const admins = state.holders.filter((p) => p.roles.includes('people_admin')).length;
  return (
    <Page title="Roles" back={back}>
      <Text tone="muted">
        Who has administrator, HR and finance access. Managers and employees get theirs from the org
        chart, not from here. A People administrator also has everything HR and Finance have.
      </Text>
      {state.canManage ? null : (
        <Alert tone="info">Only a People administrator can change who holds a role.</Alert>
      )}
      {state.holders.some((p) => p.roles.includes('finance')) ? null : (
        <Alert tone="warning" title="Nobody is granted Finance">
          People administrators have Finance’s access until someone is added.
        </Alert>
      )}
      <SearchField
        value={typed}
        onValueChange={setTyped}
        placeholder="Find a person"
        label="Find a person"
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={typed === '' ? 'Nobody signs in yet' : 'Nobody matches'}
          description={
            typed === '' ? 'People appear here once they have an account.' : 'Try another name.'
          }
        />
      ) : (
        <List>
          {rows.map((p) => {
            const me = p.accountId === state.viewerAccountId;
            return (
              <ListItem
                key={p.accountId}
                leading={<Avatar name={nameOf(p)} size={40} />}
                description={p.roles.length === 0 ? 'No role' : p.roles.map(labelOf).join(' · ')}
                {...(state.canManage ? { chevron: true } : {})}
                {...(state.canManage
                  ? {
                      onPress: () => {
                        setOpen(p);
                      },
                    }
                  : {})}
              >
                {`${nameOf(p)}${me ? ' (you)' : ''}`}
              </ListItem>
            );
          })}
        </List>
      )}
      {state.next === null ? null : (
        <Button
          loading={more}
          onPress={() => {
            setMore(true);
            void ask<RolesState>(signed, 'RoleSettings', {
              search: typed.trim() === '' ? null : typed.trim(),
              after: state.next,
            }).then((page) => {
              setMore(false);
              if (!page.ok) return;
              setRows((held) => [...held, ...page.data.people]);
              setState({ ...state, next: page.data.next });
            });
          }}
        >
          Show more
        </Button>
      )}
      {open === null ? null : (
        <PersonRoles
          person={open}
          me={open.accountId === state.viewerAccountId}
          lastAdmin={admins === 1}
          onClose={() => {
            setOpen(null);
          }}
          onChanged={() => {
            setOpen(null);
            void load(typed.trim());
          }}
        />
      )}
    </Page>
  );
}

/** One person's roles, each a switch; turning one asks why first. */
function PersonRoles({
  person,
  me,
  lastAdmin,
  onClose,
  onChanged,
}: {
  person: RolesPerson;
  me: boolean;
  lastAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [pending, setPending] = useState<{ role: Role; grant: boolean } | null>(null);
  const who = nameOf(person);
  if (pending !== null) {
    return (
      <ReasonDialog
        title={
          pending.grant
            ? `Make ${who} ${labelOf(pending.role)}`
            : `Remove ${labelOf(pending.role)} from ${who}`
        }
        description="The reason is kept with the change."
        action={pending.grant ? 'Grant' : 'Remove'}
        busy={busy !== null}
        onClose={() => {
          setPending(null);
        }}
        onSubmit={(reason) => {
          void act(
            pending.grant ? 'GrantRole' : 'RevokeRole',
            { accountId: person.accountId, role: pending.role, reason },
            pending.grant
              ? `${who} is now ${labelOf(pending.role)}`
              : `${labelOf(pending.role)} removed`,
          ).then((done) => {
            setPending(null);
            if (done !== null) onChanged();
          });
        }}
      />
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{who}</DialogTitle>
          {person.workEmail === null ? null : (
            <DialogDescription>{person.workEmail}</DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          <List>
            {ROLES.map(({ role, label, means }) => {
              const held = person.roles.includes(role);
              const locked = (me && !held) || (held && role === 'people_admin' && lastAdmin);
              return (
                <ListItem
                  key={role}
                  description={
                    me && !held
                      ? 'Nobody grants themselves a role.'
                      : held && role === 'people_admin' && lastAdmin
                        ? 'The last administrator stays.'
                        : means
                  }
                  trailing={
                    <Switch
                      checked={held}
                      disabled={locked}
                      accessibilityLabel={`${label} for ${who}`}
                      onCheckedChange={(on) => {
                        setPending({ role, grant: on });
                      }}
                    />
                  }
                >
                  {label}
                </ListItem>
              );
            })}
          </List>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
