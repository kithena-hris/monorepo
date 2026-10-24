import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hero,
  Icon,
  Inline,
  KeyValues,
  ListItem,
  QuickAction,
  Stack,
  Text,
  useToast,
} from '@reach/ui-native';
import { dateFormat } from '@reach/ui-native/words';
import * as WebBrowser from 'expo-web-browser';
import {
  AtSign,
  Banknote,
  Briefcase,
  Cake,
  CalendarCheck,
  CalendarDays,
  Camera,
  CircleDashed,
  Heart,
  House,
  IdCard,
  Landmark,
  MessageCircle,
  Network,
  Settings,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Type,
  User as UserIcon,
  Image as ImageIcon,
  Paperclip,
  CalendarX,
  Clock,
  Ellipsis,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  History as HistoryIcon,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plane,
  RotateCcw,
  Send,
  Trash2,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react-native';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Account, AccountActionsContext } from '../account-card';
import { FILE_TYPES } from './attribute-input';
import { changePhoto, openFile, PersonAvatar, removePhoto } from './media';
import { Failed, Loading, Page } from '../frame';
import { useAct } from './act';
import {
  isEmpty,
  useRead,
  useSigned,
  valueOf,
  valuesOf,
  type Entry,
  type RecordField,
  type Value,
} from './api';
import { DisplayValue, longDate } from './display';
import { EditSectionDialog } from './edit-section';
import { HistoryDialog } from './history';
import {
  EmploymentPeriods,
  isDestructive,
  MOVE_LABEL,
  MoveDialog,
  offeredMoves,
  PlaceDialog,
  ReasonDialog,
  type MoveKind,
  type Period,
  type Placement,
} from './employment';
import { STATUS_TONE } from './people-tab';
import type { PeopleScreen } from './routes';
import { useRoles } from './roles';
import { AskDialog, Documents, SendDocumentDialog } from '../inbox/profile-asks';
import { t } from '../i18n';

interface Pending {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly value: Entry;
  readonly effectiveFrom: string;
  readonly expiresAt: string;
  readonly requestedBy: string;
  /** The viewer asked for it, so may withdraw it. */
  readonly mine: boolean;
  readonly canDecide: boolean;
  /** The viewer asked and nobody else may approve it: they approve it alone. */
  readonly canSelfApprove: boolean | null;
}

interface Linked {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
}

interface ProfileData {
  readonly person: {
    readonly name: string;
    readonly summary: string | null;
    readonly avatarUrl: string | null;
    readonly canChangePhoto: boolean | null;
    readonly missing: number | null;
    readonly canViewAs: boolean | null;
  };
  readonly calendar: { readonly today: string; readonly timeZone: string } | null;
  readonly files: readonly { readonly id: string; readonly name: string }[] | null;
  readonly placement: Placement | null;
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly values: readonly Entry[];
  readonly employment: {
    readonly status: string | null;
    readonly periods: readonly Period[];
  } | null;
  readonly pending: readonly Pending[] | null;
  readonly reportingLine: {
    readonly chain: readonly Linked[];
    readonly peers: readonly Linked[];
  } | null;
}

/** The web's words for a status (`statusLabel`). */
const STATUS = (): Record<string, string> => ({
  provisional: t('people.profile.provisional', 'Provisional'),
  pre_hire: t('people.profile.starting_soon', 'Starting soon'),
  onboarding: t('people.profile.onboarding', 'Onboarding'),
  active: t('people.profile.active', 'Active'),
  on_leave: t('people.profile.on_leave', 'On leave'),
  notice: t('people.profile.on_notice', 'On notice'),
  terminated: t('people.profile.left', 'Left'),
  discarded: t('people.profile.discarded', 'Discarded'),
  merged: t('people.profile.merged_into_another_record', 'Merged into another record'),
});

/** Each move's glyph in the menu. */
const MOVE_ICON: Record<MoveKind, LucideIcon> = {
  giveNotice: LogOut,
  withdrawNotice: RotateCcw,
  terminate: UserX,
  endAccess: UserX,
  startLeave: Plane,
  endLeave: CalendarCheck,
  discard: Trash2,
  rehire: UserCheck,
  hire: CalendarX,
};

/** "2026-11-01" or an instant, as a day in words. */
const day = (iso: string): string => longDate(iso.slice(0, 10));

/**
 * A change waiting on somebody, under the value it would replace (design
 * `pend`), with what the viewer may do about it: take back their own, approve
 * it alone where nobody else may, or decide it.
 */
function PendingNote({
  field,
  pending,
  onDone,
}: {
  field: RecordField;
  pending: Pending;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const decide = async (approve: boolean, soleApprover = false): Promise<void> => {
    const done = await act(
      'DecidePendingChange',
      { id: pending.id, approve, note: null, soleApprover },
      approve ? 'Approved' : 'Rejected',
    );
    if (done !== null) onDone();
  };
  return (
    <Alert tone="warning" icon={Clock}>
      <Stack gap={2}>
        <DisplayValue field={field} value={valueOf(pending.value)} />
        <Text variant="subhead">
          {t(
            'people.profile.from_asked_by_waits_until',
            'From {{day}}, asked by {{requestedBy}}. Waits until {{day2}}.',
            {
              day: day(pending.effectiveFrom),
              requestedBy: pending.requestedBy,
              day2: day(pending.expiresAt),
            },
          )}
        </Text>
        <Inline gap={2}>
          {pending.mine ? (
            <Button
              size="sm"
              loading={busy === 'WithdrawPendingChange'}
              onPress={() => {
                void act('WithdrawPendingChange', { id: pending.id }, 'Withdrawn').then((done) => {
                  if (done !== null) onDone();
                });
              }}
            >
              {t('people.profile.withdraw', 'Withdraw')}
            </Button>
          ) : null}
          {pending.canSelfApprove === true ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'DecidePendingChange'}
              onPress={() => void decide(true, true)}
            >
              {t('people.profile.approve_it_yourself', 'Approve it yourself')}
            </Button>
          ) : pending.canDecide ? (
            <>
              <Button size="sm" onPress={() => void decide(false)}>
                {t('people.profile.reject', 'Reject')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'DecidePendingChange'}
                onPress={() => void decide(true)}
              >
                {t('people.profile.approve', 'Approve')}
              </Button>
            </>
          ) : null}
        </Inline>
      </Stack>
    </Alert>
  );
}

/** What a field's value says about the person, by type: the address to write to, the number to call. */
function contactOf(data: ProfileData, values: Readonly<Record<string, Value>>, type: string) {
  for (const section of data.sections) {
    for (const field of section.fields) {
      const value = values[field.key];
      if (field.dataType === type && typeof value === 'string' && value !== '') return value;
    }
  }
  return null;
}

/** A field's glyph in its row's tile, by what it holds. */
function iconFor(field: RecordField): LucideIcon {
  const key = field.key;
  if (/birth/u.test(key)) return Cake;
  if (/title|role|job/u.test(key)) return Briefcase;
  if (/department|team|unit/u.test(key)) return Network;
  if (/location|office/u.test(key)) return MapPin;
  if (/emergency/u.test(key)) return Heart;
  switch (field.dataType) {
    case 'national_id':
      return IdCard;
    case 'bank_account':
      return Landmark;
    case 'address':
      return House;
    case 'phone':
      return Smartphone;
    case 'email':
      return AtSign;
    case 'money':
      return Banknote;
    case 'date':
      return CalendarDays;
    case 'person_ref':
      return UserIcon;
    case 'image':
    case 'file':
    case 'document':
      return Paperclip;
    default:
      return Type;
  }
}

/** What HR still needs from the viewer, from `Overview` (design v3 P13). */
interface Needs {
  readonly me: { readonly missing: number | null; readonly required: number } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly ownedBy: string | null;
  }[];
  readonly corrections:
    | readonly {
        readonly key: string;
        readonly label: string;
        readonly sectionKey: string;
        readonly reason: string;
      }[]
    | null;
}

const clock = (zone: string): string => {
  try {
    return dateFormat({
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date());
  } catch {
    return '';
  }
};

/**
 * A record (design v3 P11–P13): a photo header with four quick actions, the
 * four facts people look for most, then one card per section where every
 * detail is a row with an icon, a small grey label and a large value. A
 * missing detail says so with an Ask; a pending change sits under the value
 * it would replace. Edits are one centred modal per section. The viewer's
 * own when no person is named: the Me tab, opening on what HR still needs.
 *
 * Everything here is what People sent for this viewer: a field they may not
 * read is not in the answer to draw, and one they may not change has no
 * control in the editor.
 */
export function Profile({ navigation, route }: PeopleScreen<'Profile'>): React.JSX.Element {
  const personId = route.params?.personId ?? null;
  const { load, reload } = useRead<ProfileData>('Profile', { personId });
  const back = route.params?.back;
  const { act, busy } = useAct();
  const signed = useSigned();
  const { toast } = useToast();
  const tabs = useContext(AccountActionsContext);
  const [open, setOpen] = useState<
    | { kind: 'move'; move: MoveKind }
    | { kind: 'place' }
    | { kind: 'pdf' }
    | { kind: 'view' }
    | { kind: 'ask' }
    | { kind: 'send' }
    | { kind: 'edit'; sectionKey: string }
    | { kind: 'history' }
    | { kind: 'docs' }
    | { kind: 'summary' }
    | null
  >(null);
  const roles = useRoles();
  const own = personId === null;
  const needs = useRead<Needs>('Overview').load;
  const close = (): void => {
    setOpen(null);
  };
  const [viewing, setViewing] = useState(false);
  const [revealed, setRevealed] = useState<Readonly<Record<string, string>>>({});

  // Back from anywhere a change could have been made: read it again.
  const seen = useRef(false);
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (seen.current) reload();
        seen.current = true;
      }),
    [navigation, reload],
  );

  const frame = (children: ReactNode, trailing?: ReactNode): React.JSX.Element => (
    <Page
      {...(back === undefined ? {} : { back: { label: back, onPress: navigation.goBack } })}
      {...(trailing === undefined ? {} : { trailing })}
    >
      {children}
    </Page>
  );

  if (load.status === 'loading')
    return frame(<Loading label={t('people.profile.loading_the_record', 'Loading the record')} />);
  if (load.status === 'error') return frame(<Failed message={load.message} onRetry={reload} />);

  const data = load.data;
  const values = valuesOf(data.values);
  const status = data.employment?.status ?? null;
  const sections = data.sections.filter((s) => s.fields.length > 0);
  // Profile names nobody's id for the viewer's own record; their photo's address does.
  const meId = /photos\/([0-9a-f-]{36})/i.exec(data.person.avatarUrl ?? '')?.[1] ?? null;
  const email = own ? null : contactOf(data, values, 'email');
  const phone = own ? null : contactOf(data, values, 'phone');
  // The chain runs from the top of the organisation down: the manager is its last.
  const manager = data.reportingLine?.chain.at(-1);
  const firstName = data.person.name.split(' ')[0] ?? data.person.name;
  const editable = (section: (typeof sections)[number]): boolean =>
    section.fields.some((f) => !f.readOnly && f.keptIn === null);
  const edit = (sectionKey: string): void => {
    setOpen({ kind: 'edit', sectionKey });
  };
  const fieldOf = (pattern: RegExp): RecordField | undefined =>
    sections.flatMap((s) => s.fields).find((f) => pattern.test(f.key));
  const sectionWith = (pattern: RegExp): string | undefined =>
    sections.find((s) => s.fields.some((f) => pattern.test(f.key) && !f.readOnly))?.key;

  // What the viewer may ask the person to fill in, all at once (design D4).
  const askable = data.sections
    .flatMap((x) => x.fields)
    .filter((f) => f.askable === true && isEmpty(values[f.key]));
  const moves = own ? [] : offeredMoves(status);
  const roleSection = sectionWith(/title|department|team|job/u);
  const paySection = sections.find((s) =>
    s.fields.some((f) => f.dataType === 'money' && !f.readOnly),
  )?.key;
  const menu = own ? (
    <Button
      size="sm"
      startIcon={<Icon icon={Settings} />}
      accessibilityLabel={t('people.profile.settings', 'Settings')}
      onPress={() => {
        navigation.navigate('Settings');
      }}
    />
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          size="sm"
          startIcon={<Icon icon={Ellipsis} />}
          accessibilityLabel={t('people.profile.actions', 'Actions')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        label={t('people.profile.actions_for', 'Actions for {{name}}', { name: data.person.name })}
        align="end"
        className="w-[300px]"
      >
        {moves.length === 0 && data.placement === null && roleSection === undefined ? null : (
          <DropdownMenuLabel>{t('people.profile.employment', 'Employment')}</DropdownMenuLabel>
        )}
        {roleSection === undefined ? null : (
          <DropdownMenuItem
            icon={Briefcase}
            onSelect={() => {
              edit(roleSection);
            }}
          >
            {t('people.profile.change_role_or_team', 'Change role or team')}
          </DropdownMenuItem>
        )}
        {paySection === undefined ? null : (
          <DropdownMenuItem
            icon={Banknote}
            onSelect={() => {
              edit(paySection);
            }}
          >
            {t('people.profile.change_pay', 'Change pay')}
          </DropdownMenuItem>
        )}
        {data.placement === null ? null : (
          <DropdownMenuItem
            icon={MapPin}
            onSelect={() => {
              setOpen({ kind: 'place' });
            }}
          >
            {t('people.profile.change_placement', 'Change placement')}
          </DropdownMenuItem>
        )}
        {moves
          .filter((kind) => !isDestructive(kind))
          .map((kind) => (
            <DropdownMenuItem
              key={kind}
              icon={MOVE_ICON[kind]}
              onSelect={() => {
                setOpen({ kind: 'move', move: kind });
              }}
            >
              {MOVE_LABEL[kind]}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('people.profile.record', 'Record')}</DropdownMenuLabel>
        {askable.length === 0 ? null : (
          <DropdownMenuItem
            icon={Send}
            onSelect={() => {
              setOpen({ kind: 'ask' });
            }}
          >
            {t('people.profile.ask_for_details', 'Ask {{firstName}} for details', { firstName })}
          </DropdownMenuItem>
        )}
        {roles.hr ? (
          <DropdownMenuItem
            icon={FileText}
            onSelect={() => {
              setOpen({ kind: 'send' });
            }}
          >
            {t('people.profile.send_a_document', 'Send a document')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          icon={HistoryIcon}
          onSelect={() => {
            setOpen({ kind: 'history' });
          }}
        >
          {t('people.profile.history', 'History')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={FileDown}
          onSelect={() => {
            setOpen({ kind: 'pdf' });
          }}
        >
          {t('people.profile.download_record', 'Download record')}
        </DropdownMenuItem>
        {data.person.canViewAs === true ? (
          <DropdownMenuItem
            icon={Eye}
            onSelect={() => {
              setOpen({ kind: 'view' });
            }}
          >
            {t('people.profile.view_as', 'View as {{firstName}}', { firstName })}
          </DropdownMenuItem>
        ) : null}
        {moves.some(isDestructive) ? <DropdownMenuSeparator /> : null}
        {moves.filter(isDestructive).map((kind) => (
          <DropdownMenuItem
            key={kind}
            icon={MOVE_ICON[kind]}
            destructive
            onSelect={() => {
              setOpen({ kind: 'move', move: kind });
            }}
          >
            {kind === 'terminate'
              ? t('people.profile.end_employment', 'End employment')
              : MOVE_LABEL[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const today = data.calendar?.today ?? new Date().toISOString().slice(0, 10);

  // The four facts (P11): manager, team, started, and the time where they are.
  const team = fieldOf(/department|team/u);
  const started = fieldOf(/hire_date|start_date/u);
  const zone = data.calendar?.timeZone ?? null;
  const city = zone === null ? null : (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
  const facts: { label: string; value: ReactNode; onPress?: () => void }[] = [];
  if (!own && manager !== undefined)
    facts.push({
      label: t('people.profile.manager', 'Manager'),
      value: (
        <View className="flex-row items-center gap-2">
          <Avatar name={manager.name} size={24} decorative />
          <Text weight="semibold" numberOfLines={1} className="flex-1">
            {manager.name}
          </Text>
        </View>
      ),
      onPress: () => {
        navigation.push('Profile', { personId: manager.id, name: manager.name, back: firstName });
      },
    });
  if (!own && team !== undefined && !isEmpty(values[team.key]))
    facts.push({
      label: team.label,
      value: <DisplayValue field={team} value={values[team.key]} />,
    });
  if (!own && started !== undefined && !isEmpty(values[started.key]))
    facts.push({
      label: t('people.profile.started', 'Started'),
      value: <DisplayValue field={started} value={values[started.key]} />,
    });
  if (!own && zone !== null)
    facts.push({
      label: t('people.profile.local_time', 'Local time'),
      value: `${clock(zone)} · ${city ?? ''}`,
    });

  // Your own: what HR still needs, each with its button (P13).
  const mine = own && needs.status === 'ready' ? needs.data : null;
  const corrections = mine?.corrections ?? [];
  const yours = (mine?.missing ?? []).filter((m) => m.ownedBy === null);
  const percent =
    mine?.me == null || mine.me.required === 0
      ? null
      : Math.round(((mine.me.required - mine.missing.length) / mine.me.required) * 100);

  return frame(
    <>
      {open?.kind === 'move' && personId !== null ? (
        <MoveDialog
          kind={open.move}
          personId={personId}
          name={data.person.name}
          today={today}
          timeZone={data.calendar?.timeZone ?? 'UTC'}
          lastPeriod={data.employment?.periods.at(-1) ?? null}
          placement={data.placement}
          onClose={close}
          onDone={reload}
        />
      ) : null}
      {open?.kind === 'place' && personId !== null && data.placement !== null ? (
        <PlaceDialog
          personId={personId}
          name={data.person.name}
          today={today}
          placement={data.placement}
          onClose={close}
          onDone={reload}
        />
      ) : null}
      {open?.kind === 'edit' ? (
        <EditSectionDialog
          personId={personId ?? undefined}
          sectionKey={open.sectionKey}
          onClose={() => {
            close();
            reload();
          }}
        />
      ) : null}
      {open?.kind === 'history' ? (
        <HistoryDialog
          personId={personId}
          name={data.person.name}
          onClose={close}
          onAsOf={() => {
            close();
            navigation.navigate('History', {
              ...(personId === null ? {} : { personId }),
              back: own ? 'Me' : firstName,
              asOf: today,
            });
          }}
        />
      ) : null}
      {open?.kind === 'docs' ? (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('people.profile.your_documents', 'Your documents')}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Documents personId={personId} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
      {open?.kind === 'ask' && personId !== null ? (
        <AskDialog
          personId={personId}
          name={data.person.name}
          fields={askable.map((f) => ({ key: f.key, label: f.label }))}
          onClose={close}
        />
      ) : null}
      {open?.kind === 'send' && personId !== null ? (
        <SendDocumentDialog personId={personId} name={data.person.name} onClose={close} />
      ) : null}
      {open?.kind === 'pdf' ? (
        <ReasonDialog
          title={t('people.profile.s_record_as_a_pdf', '{{name}}’s record as a PDF', {
            name: data.person.name,
          })}
          description={t(
            'people.profile.only_what_you_can_see_the',
            'Only what you can see. The link works once and expires.',
          )}
          action={t('people.profile.download_pdf', 'Download PDF')}
          busy={busy === 'RequestExport'}
          onClose={close}
          onSubmit={(reason) => {
            void act<{ links: { url: string }[] }>('RequestExport', {
              format: 'pdf',
              recordOf: personId,
              reason,
            }).then((made) => {
              const url = made?.links[0]?.url;
              close();
              if (url !== undefined) void WebBrowser.openBrowserAsync(url);
            });
          }}
        />
      ) : null}
      {open?.kind === 'view' && personId !== null ? (
        <ReasonDialog
          title={t('people.profile.view_kithena_as', 'View Kithena as {{firstName}}', {
            firstName,
          })}
          description={t(
            'people.profile.everything_as_sees_it_read_only',
            'Everything as {{firstName}} sees it, read-only, for thirty minutes. {{firstName}} is told.',
            { firstName },
          )}
          action={t('people.profile.view_as', 'View as {{firstName}}', { firstName })}
          busy={viewing}
          onClose={close}
          onSubmit={(reason) => {
            setViewing(true);
            void signed.viewAs(personId, reason).then((refused) => {
              setViewing(false);
              if (refused === null) close();
              else
                toast({
                  title: t('people.profile.that_did_not_work', 'That did not work'),
                  description: refused,
                  tone: 'danger',
                });
            });
          }}
        />
      ) : null}

      <Hero
        media={
          <View className="items-center gap-1">
            <PersonAvatar
              personId={personId ?? meId}
              name={data.person.name}
              avatarUrl={data.person.avatarUrl}
              size={96}
              {...(status === 'active' ? { status: 'success' as const } : {})}
            />
            {data.person.canChangePhoto === true ? (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button size="xs" variant="ghost" startIcon={<Icon icon={Camera} />}>
                    {data.person.avatarUrl === null
                      ? t('people.profile.add_a_photo', 'Add a photo')
                      : t('people.profile.change_photo', 'Change photo')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent label={t('people.profile.photo', 'Photo')}>
                  <DropdownMenuItem
                    icon={ImageIcon}
                    onSelect={() => {
                      void changePhoto(signed, personId).then((up) => {
                        if (up === null) return;
                        if (up.ok) {
                          toast({
                            title: t('people.profile.photo_saved', 'Photo saved'),
                            tone: 'success',
                          });
                          reload();
                        } else
                          toast({
                            title: t('people.profile.that_did_not_work', 'That did not work'),
                            description: up.message,
                            tone: 'danger',
                          });
                      });
                    }}
                  >
                    {t('people.profile.choose_a_photo', 'Choose a photo')}
                  </DropdownMenuItem>
                  {data.person.avatarUrl === null ? null : (
                    <DropdownMenuItem
                      icon={Trash2}
                      destructive
                      onSelect={() => {
                        void removePhoto(signed, personId).then((refused) => {
                          if (refused === null) reload();
                          else
                            toast({
                              title: t('people.profile.that_did_not_work', 'That did not work'),
                              description: refused,
                              tone: 'danger',
                            });
                        });
                      }}
                    >
                      {t('people.profile.remove_photo', 'Remove photo')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </View>
        }
        title={data.person.name}
        {...(data.person.summary === null ? {} : { subtitle: data.person.summary })}
        badges={
          <>
            {own && percent !== null ? (
              <Badge size="sm" tone="accent">
                {t('people.profile.complete', '{{String}}% complete', { String: String(percent) })}
              </Badge>
            ) : status === null ? null : (
              <Badge size="sm" dot tone={STATUS_TONE[STATUS()[status] ?? ''] ?? 'neutral'}>
                {STATUS()[status] ?? status}
              </Badge>
            )}
            {own || data.person.missing === null || data.person.missing === 0 ? null : (
              <Badge size="sm" tone="warning">
                {t('people.profile.missing', '{{String}} missing', {
                  String: String(data.person.missing),
                })}
              </Badge>
            )}
          </>
        }
        actions={
          own ? (
            <>
              {sections.find(editable) === undefined ? null : (
                <QuickAction
                  icon={Pencil}
                  label={t('people.profile.edit', 'Edit')}
                  onPress={() => {
                    const first = sections.find(editable);
                    if (first !== undefined) edit(first.key);
                  }}
                />
              )}
              {tabs?.timeOff === true ? (
                <QuickAction
                  icon={CalendarDays}
                  label={t('people.profile.time_off', 'Time off')}
                  onPress={() => {
                    tabs.open('timeoff');
                  }}
                />
              ) : null}
              <QuickAction
                icon={FileText}
                label={t('people.profile.documents', 'Documents')}
                onPress={() => {
                  setOpen({ kind: 'docs' });
                }}
              />
              <QuickAction
                icon={Settings}
                label={t('people.profile.settings', 'Settings')}
                onPress={() => {
                  navigation.navigate('Settings');
                }}
              />
            </>
          ) : (
            <>
              <QuickAction
                icon={MessageCircle}
                label={t('people.profile.message', 'Message')}
                disabled={phone === null}
                onPress={() => {
                  if (phone !== null) void Linking.openURL(`sms:${phone}`);
                }}
              />
              <QuickAction
                icon={Phone}
                label={t('people.profile.call', 'Call')}
                disabled={phone === null}
                onPress={() => {
                  if (phone !== null) void Linking.openURL(`tel:${phone}`);
                }}
              />
              <QuickAction
                icon={Mail}
                label={t('people.profile.email', 'Email')}
                disabled={email === null}
                onPress={() => {
                  if (email !== null) void Linking.openURL(`mailto:${email}`);
                }}
              />
              <QuickAction
                icon={Network}
                label={t('people.profile.org_chart', 'Org chart')}
                onPress={() => {
                  navigation.navigate('People', { view: 'org' });
                }}
              />
            </>
          )
        }
      />

      {facts.length === 0 ? null : (
        <View className="flex-row flex-wrap gap-2.5">
          {facts.map((f) => (
            <Pressable
              key={f.label}
              className="w-[48.5%]"
              disabled={f.onPress === undefined}
              accessibilityRole={f.onPress === undefined ? undefined : 'button'}
              onPress={f.onPress}
            >
              <Card className="gap-2">
                <Text variant="footnote" tone="subtle">
                  {f.label}
                </Text>
                {typeof f.value === 'string' ? <Text weight="semibold">{f.value}</Text> : f.value}
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      {own ? null : (
        // Two questions about this person, answered in place (v3 P11).
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          <Chip
            icon={Sparkles}
            onPress={() => {
              setOpen({ kind: 'summary' });
            }}
          >
            {t('people.profile.summarise', 'Summarise {{firstName}}', { firstName })}
          </Chip>
          <Chip
            icon={Sparkles}
            onPress={() => {
              setOpen({ kind: 'history' });
            }}
          >
            {t('people.profile.what_changed_this_year', 'What changed this year')}
          </Chip>
        </ScrollView>
      )}
      {open?.kind === 'summary' ? (
        <SummaryDialog
          question={`Summarise ${data.person.name}`}
          name={data.person.name}
          onClose={close}
        />
      ) : null}

      {!own ? null : corrections.length + yours.length === 0 ? null : (
        <Card padded={false} className="overflow-hidden">
          <View className="flex-row items-center gap-3 px-4 pb-1 pt-4">
            {percent === null ? null : (
              <CircularProgress
                value={percent}
                size={44}
                label={t('people.profile.complete', '{{String}}% complete', {
                  String: String(percent),
                })}
              />
            )}
            <View className="flex-1">
              <Text variant="headline">
                {t(
                  'people.profile.hr_needs',
                  { one: '{{count}} thing HR needs', other: '{{count}} things HR needs' },
                  { count: corrections.length + yours.length },
                )}
              </Text>
              <Text variant="subhead" tone="muted">
                {t('people.profile.each_saves_on_its_own', 'Each saves on its own.')}
              </Text>
            </View>
          </View>
          {corrections.map((c) => (
            <ListItem
              key={`c-${c.key}`}
              listitem={false}
              icon={TriangleAlert}
              iconTone={5}
              description={c.reason}
              trailing={
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => {
                    edit(c.sectionKey);
                  }}
                >
                  {t('people.profile.fix', 'Fix')}
                </Button>
              }
            >
              {t('people.profile.correct_your', 'Correct your {{label}}', { label: c.label })}
            </ListItem>
          ))}
          {yours.map((m) => (
            <ListItem
              key={m.key}
              listitem={false}
              icon={CircleDashed}
              trailing={
                <Button
                  size="sm"
                  onPress={() => {
                    edit(m.sectionKey);
                  }}
                >
                  {t('people.profile.add', 'Add')}
                </Button>
              }
            >
              {t('people.profile.add_your', 'Add your {{toLowerCase}}', {
                toLowerCase: m.label.toLowerCase(),
              })}
            </ListItem>
          ))}
        </Card>
      )}

      {sections.map((section) => (
        <Card key={section.key} padded={false} className="overflow-hidden pb-1">
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text variant="headline">{section.label}</Text>
            {editable(section) ? (
              <Button
                size="xs"
                variant="link"
                onPress={() => {
                  edit(section.key);
                }}
              >
                {t('people.profile.edit', 'Edit')}
              </Button>
            ) : null}
          </View>
          <KeyValues
            layout="detail"
            items={section.fields.map((field) => {
              const value = values[field.key];
              const empty = isEmpty(value);
              const waiting = data.pending?.find((p) => p.key === field.key);
              const file =
                FILE_TYPES.has(field.dataType) && typeof value === 'string' && value !== '';
              return {
                id: field.key,
                icon: iconFor(field),
                label: field.label,
                ...(field.sensitive === true
                  ? {
                      badge: (
                        <Badge size="sm" tone="warning" icon={Lock}>
                          {t('people.profile.sensitive', 'Sensitive')}
                        </Badge>
                      ),
                    }
                  : {}),
                empty: empty && !file,
                value: file ? (
                  <Button
                    size="sm"
                    startIcon={<Icon icon={Paperclip} />}
                    onPress={() => {
                      void openFile(signed, value).then((refused) => {
                        if (refused !== null)
                          toast({
                            title: t('people.profile.that_did_not_work', 'That did not work'),
                            description: refused,
                            tone: 'danger',
                          });
                      });
                    }}
                  >
                    {data.files?.find((f) => f.id === value)?.name ??
                      t('people.profile.open_the_file', 'Open the file')}
                  </Button>
                ) : empty ? (
                  t('people.profile.not_added_yet', 'Not added yet')
                ) : revealed[field.key] !== undefined ? (
                  <Text weight="semibold" className="font-mono text-[17px]">
                    {revealed[field.key]}
                  </Text>
                ) : (
                  <DisplayValue field={field} value={value} className="text-[17px] font-semibold" />
                ),
                ...(waiting === undefined
                  ? {}
                  : { below: <PendingNote field={field} pending={waiting} onDone={reload} /> }),
                // A masked identifier shows for a moment, and the look is logged (P12).
                ...(field.dataType === 'national_id' && !empty && personId !== null
                  ? {
                      trailing: (
                        <Button
                          size="sm"
                          variant="ghost"
                          accessibilityLabel={
                            revealed[field.key] === undefined
                              ? t('people.profile.show', 'Show {{label}}', { label: field.label })
                              : t('people.profile.hide', 'Hide {{label}}', { label: field.label })
                          }
                          startIcon={
                            <Icon icon={revealed[field.key] === undefined ? Eye : EyeOff} />
                          }
                          loading={busy === 'RevealIdentifier'}
                          onPress={() => {
                            if (revealed[field.key] !== undefined) {
                              setRevealed(({ [field.key]: _gone, ...rest }) => rest);
                              return;
                            }
                            void act<{ value: string }>('RevealIdentifier', {
                              personId,
                              attributeKey: field.key,
                            }).then((r) => {
                              if (r !== null)
                                setRevealed((was) => ({ ...was, [field.key]: r.value }));
                            });
                          }}
                        />
                      ),
                    }
                  : {}),
                // HR or a manager may ask the person to fill in what they own (P12).
                ...(field.askable === true && !own && empty
                  ? {
                      trailing: (
                        <Button
                          size="sm"
                          variant="tinted"
                          startIcon={<Icon icon={Send} tone="accent" />}
                          loading={busy === 'RequestDetails'}
                          onPress={() => {
                            void act<{ asked: number }>(
                              'RequestDetails',
                              { personId, keys: [field.key] },
                              t(
                                'people.profile.asked_for',
                                'Asked {{firstName}} for {{toLowerCase}}',
                                { firstName, toLowerCase: field.label.toLowerCase() },
                              ),
                            );
                          }}
                        >
                          {t('people.profile.ask', 'Ask')}
                        </Button>
                      ),
                    }
                  : {}),
              };
            })}
          />
        </Card>
      ))}

      <Documents
        personId={personId}
        {...(roles.hr && !own
          ? {
              onAdd: () => {
                setOpen({ kind: 'send' });
              },
            }
          : {})}
      />
      <EmploymentPeriods periods={data.employment?.periods ?? []} />
      <Card padded={false} className="overflow-hidden">
        <ListItem
          listitem={false}
          icon={HistoryIcon}
          description={t(
            'people.profile.every_change_with_the_value_before',
            'Every change, with the value before it',
          )}
          chevron
          onPress={() => {
            setOpen({ kind: 'history' });
          }}
        >
          {t('people.profile.history', 'History')}
        </ListItem>
      </Card>

      {/* Your own record, in the Me tab: where you are signed in, and the way out. */}
      {own && back === undefined ? (
        <Account
          onSettings={() => {
            navigation.navigate('Settings');
          }}
        />
      ) : null}
    </>,
    menu,
  );
}

/** "Summarise Adam": People's assistant answers as the viewer, in a modal (v3 P11). */
function SummaryDialog({
  question,
  name,
  onClose,
}: {
  question: string;
  name: string;
  onClose: () => void;
}): React.JSX.Element {
  const { load } = useRead<{ text: string; answered: boolean }>('Ask', { question, earlier: [] });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {load.status === 'loading' ? (
            <Loading label={t('people.profile.asking', 'Asking')} />
          ) : load.status === 'error' ? (
            <Text tone="muted">{load.message}</Text>
          ) : (
            <Text>
              {load.data.answered
                ? load.data.text
                : t(
                    'people.profile.there_is_nothing_to_summarise_that',
                    'There is nothing to summarise that you may see yet.',
                  )}
            </Text>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
