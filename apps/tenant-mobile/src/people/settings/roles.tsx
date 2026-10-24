import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  List,
  ListItem,
  SearchField,
  Switch,
  Text,
} from '@reach/ui-native';
import { Banknote, Network, ShieldCheck, Sparkles, Users } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, useSigned } from '../api';
import { ReasonDialog } from '../employment';
import type { PeopleScreen } from '../routes';
import { t } from '../../i18n';

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

const ROLES = (): readonly {
  role: Role;
  label: string;
  means: string;
  short: string;
  icon: typeof ShieldCheck;
}[] => [
  {
    role: 'people_admin',
    label: t('people.settings.roles.administrator', 'Administrator'),
    means: t(
      'people.settings.roles.changes_the_fields_the_settings_and',
      'Changes the fields, the settings and who holds a role, and does anything HR and Finance can.',
    ),
    short: t(
      'people.settings.roles.every_setting_and_every_record',
      'Every setting and every record',
    ),
    icon: ShieldCheck,
  },
  {
    role: 'hr',
    label: 'HR',
    means: t(
      'people.settings.roles.sees_and_corrects_everybodys_record',
      'Sees and corrects everybody’s record.',
    ),
    short: t(
      'people.settings.roles.every_record_approvals_and_imports',
      'Every record, approvals and imports',
    ),
    icon: Users,
  },
  {
    role: 'finance',
    label: t('people.settings.roles.finance', 'Finance'),
    means: t(
      'people.settings.roles.sees_pay_and_asks_for_full',
      'Sees pay, and asks for full values, for payroll.',
    ),
    short: t(
      'people.settings.roles.pay_and_bank_details_for_payroll',
      'Pay and bank details, for payroll',
    ),
    icon: Banknote,
  },
];
const labelOf = (role: Role): string => ROLES().find((r) => r.role === role)?.label ?? role;
const nameOf = (p: RolesPerson): string =>
  p.name ??
  p.workEmail ??
  t('people.settings.roles.somebody_without_a_record_yet', 'Somebody without a record yet');

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
  const [roleOpen, setRoleOpen] = useState<Role | null>(null);
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

  const back = {
    label: t('people.settings.roles.settings', 'Settings'),
    onPress: navigation.goBack,
  };
  if (failed !== null) {
    return (
      <Page title={t('people.settings.roles.roles', 'Roles')} back={back}>
        <Failed message={failed} onRetry={() => void load(typed.trim())} />
      </Page>
    );
  }
  if (state === null) {
    return (
      <Page title={t('people.settings.roles.roles', 'Roles')} back={back}>
        <Loading label={t('people.settings.roles.loading_the_roles', 'Loading the roles')} />
      </Page>
    );
  }
  const admins = state.holders.filter((p) => p.roles.includes('people_admin')).length;
  const holdersOf = (role: Role): readonly RolesPerson[] =>
    state.holders.filter((p) => p.roles.includes(role));
  return (
    <Page title={t('people.settings.roles.roles', 'Roles')} back={back}>
      {state.canManage ? null : (
        <Alert tone="info">
          {t(
            'people.settings.roles.only_a_people_administrator_can_change',
            'Only a People administrator can change who holds a role.',
          )}
        </Alert>
      )}
      {/* Four cards (v3 S8): what each role can do, who has it, and one button. */}
      {ROLES().map(({ role, label, short, icon }) => {
        const holders = holdersOf(role);
        return (
          <Card key={role} className="gap-3">
            <ListItem
              listitem={false}
              icon={icon}
              description={short}
              wrap
              className="bg-transparent px-0"
            >
              {label}
            </ListItem>
            <View className="flex-row items-center gap-3">
              {holders.length === 0 ? (
                <Text tone="muted" className="flex-1">
                  {t('people.settings.roles.nobody_yet', 'Nobody yet')}
                </Text>
              ) : holders.length === 1 ? (
                <View className="flex-1 flex-row items-center gap-2">
                  <Avatar name={nameOf(holders[0] as RolesPerson)} size={28} />
                  <Text weight="medium" numberOfLines={1} className="flex-1">
                    {nameOf(holders[0] as RolesPerson)}
                  </Text>
                </View>
              ) : (
                <View className="flex-1 flex-row items-center gap-2">
                  <AvatarGroup size={28} max={3}>
                    {holders.map((h) => (
                      <Avatar key={h.accountId} name={nameOf(h)} />
                    ))}
                  </AvatarGroup>
                  <Text weight="medium">
                    {t('people.settings.roles.people', '{{String}} people', {
                      String: String(holders.length),
                    })}
                  </Text>
                </View>
              )}
              {state.canManage ? (
                <Button
                  size="sm"
                  variant={holders.length === 0 ? 'tinted' : 'secondary'}
                  onPress={() => {
                    setRoleOpen(role);
                  }}
                >
                  {holders.length === 0
                    ? t('people.settings.roles.add_someone', 'Add someone')
                    : t('people.settings.roles.change', 'Change')}
                </Button>
              ) : null}
            </View>
          </Card>
        );
      })}
      <Card className="gap-3">
        <ListItem
          listitem={false}
          icon={Network}
          description={t(
            'people.settings.roles.their_reports_work_details_and_requests',
            'Their reports’ work details and requests',
          )}
          wrap
          className="bg-transparent px-0"
        >
          {t('people.settings.roles.managers', 'Managers')}
        </ListItem>
        <View className="flex-row items-center gap-3">
          <Text tone="muted" className="flex-1">
            {t('people.settings.roles.from_reporting_lines', 'From reporting lines')}
          </Text>
          <Badge size="sm">{t('people.settings.roles.automatic', 'Automatic')}</Badge>
        </View>
      </Card>
      {holdersOf('finance').length === 0 ? (
        <View className="flex-row items-start gap-1.5 px-1">
          <Icon icon={Sparkles} size={13} tone="accent" />
          <Text variant="footnote" tone="accent" className="flex-1">
            {t(
              'people.settings.roles.finance_is_empty_so_payroll_exports',
              'Finance is empty, so payroll exports need HR. Add someone to share the load.',
            )}
          </Text>
        </View>
      ) : null}
      {roleOpen === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setRoleOpen(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{labelOf(roleOpen)}</DialogTitle>
              <DialogDescription>
                {t(
                  'people.settings.roles.tap_a_person_to_change_their',
                  'Tap a person to change their roles.',
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <SearchField
                value={typed}
                onValueChange={setTyped}
                placeholder={t(
                  'people.settings.roles.find_a_person_to_add',
                  'Find a person to add',
                )}
                label={t('people.settings.roles.find_a_person', 'Find a person')}
              />
              <ScrollView style={{ flexGrow: 0, maxHeight: 360 }}>
                {(typed.trim() === '' ? holdersOf(roleOpen) : rows).map((p) => (
                  <ListItem
                    key={p.accountId}
                    listitem={false}
                    leading={<Avatar name={nameOf(p)} size={36} />}
                    description={
                      p.roles.length === 0
                        ? t('people.settings.roles.no_role', 'No role')
                        : p.roles.map(labelOf).join(' · ')
                    }
                    chevron
                    onPress={() => {
                      setRoleOpen(null);
                      setOpen(p);
                    }}
                  >
                    {`${nameOf(p)}${p.accountId === state.viewerAccountId ? ' (you)' : ''}`}
                  </ListItem>
                ))}
              </ScrollView>
              {state.next === null || typed.trim() === '' ? null : (
                <Button
                  loading={more}
                  onPress={() => {
                    setMore(true);
                    void ask<RolesState>(signed, 'RoleSettings', {
                      search: typed.trim(),
                      after: state.next,
                    }).then((page) => {
                      setMore(false);
                      if (!page.ok) return;
                      setRows((held) => [...held, ...page.data.people]);
                      setState({ ...state, next: page.data.next });
                    });
                  }}
                >
                  {t('people.settings.roles.show_more', 'Show more')}
                </Button>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setRoleOpen(null);
                }}
              >
                {t('people.settings.roles.done', 'Done')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            ? t('people.settings.roles.make', 'Make {{who}} {{labelOf}}', {
                who,
                labelOf: labelOf(pending.role),
              })
            : t('people.settings.roles.remove_from', 'Remove {{labelOf}} from {{who}}', {
                labelOf: labelOf(pending.role),
                who,
              })
        }
        description={t(
          'people.settings.roles.the_reason_is_kept_with_the',
          'The reason is kept with the change.',
        )}
        action={
          pending.grant
            ? t('people.settings.roles.grant', 'Grant')
            : t('people.settings.roles.remove', 'Remove')
        }
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
            {ROLES().map(({ role, label, means }) => {
              const held = person.roles.includes(role);
              const locked = (me && !held) || (held && role === 'people_admin' && lastAdmin);
              return (
                <ListItem
                  key={role}
                  description={
                    me && !held
                      ? t(
                          'people.settings.roles.nobody_grants_themselves_a_role',
                          'Nobody grants themselves a role.',
                        )
                      : held && role === 'people_admin' && lastAdmin
                        ? t(
                            'people.settings.roles.the_last_administrator_stays',
                            'The last administrator stays.',
                          )
                        : means
                  }
                  trailing={
                    <Switch
                      checked={held}
                      disabled={locked}
                      accessibilityLabel={t('people.settings.roles.for', '{{label}} for {{who}}', {
                        label,
                        who,
                      })}
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
            {t('people.settings.roles.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
