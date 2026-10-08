import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Inline,
  KeyValues,
  List,
  ListItem,
  Stack,
  Text,
  useToast,
} from '@reach/ui-native';
import * as WebBrowser from 'expo-web-browser';
import {
  CalendarCheck,
  Camera,
  Image as ImageIcon,
  Paperclip,
  CalendarX,
  Clock,
  Ellipsis,
  Eye,
  FileDown,
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
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Account } from '../account-card';
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
import { STATUS_TONE } from './directory';
import type { PeopleScreen } from './routes';

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
const STATUS: Record<string, string> = {
  provisional: 'Provisional',
  pre_hire: 'Starting soon',
  active: 'Active',
  on_leave: 'On leave',
  notice: 'On notice',
  terminated: 'Left',
  discarded: 'Discarded',
  merged: 'Merged into another record',
};

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

/** The History pill's value: never a section's key, which is a field key's shape. */
const HISTORY = '#history';

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
          {`From ${day(pending.effectiveFrom)}, asked by ${pending.requestedBy}. Waits until ${day(pending.expiresAt)}.`}
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
              Withdraw
            </Button>
          ) : null}
          {pending.canSelfApprove === true ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'DecidePendingChange'}
              onPress={() => void decide(true, true)}
            >
              Approve it yourself
            </Button>
          ) : pending.canDecide ? (
            <>
              <Button size="sm" onPress={() => void decide(false)}>
                Reject
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy === 'DecidePendingChange'}
                onPress={() => void decide(true)}
              >
                Approve
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

/**
 * A record (design D1, D2): the person centred at the top with Email and
 * Call, the sections as a row of pills, and each field's value with what
 * waits to replace it. The viewer's own when no person is named: the Me tab.
 *
 * Everything here is what People sent for this viewer: a field they may not
 * read is not in the answer to draw, and one they may not change has no
 * control in the editor.
 */
export function Profile({ navigation, route }: PeopleScreen<'Profile'>): React.JSX.Element {
  const personId = route.params?.personId ?? null;
  const { load, reload } = useRead<ProfileData>('Profile', { personId });
  const [chosen, setChosen] = useState<string | null>(null);
  const back = route.params?.back;
  const { act, busy } = useAct();
  const signed = useSigned();
  const { toast } = useToast();
  const [open, setOpen] = useState<
    { kind: 'move'; move: MoveKind } | { kind: 'place' } | { kind: 'pdf' } | { kind: 'view' } | null
  >(null);
  const close = (): void => {
    setOpen(null);
  };
  const [viewing, setViewing] = useState(false);

  // Back from editing, or from anywhere a change could have been made: read it again.
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
      {...(back === undefined
        ? { large: load.status === 'ready' ? load.data.person.name : (route.params?.name ?? 'Me') }
        : { back: { label: back, onPress: navigation.goBack } })}
      {...(trailing === undefined ? {} : { trailing })}
    >
      {children}
    </Page>
  );

  if (load.status === 'loading') return frame(<Loading label="Loading the record" />);
  if (load.status === 'error') return frame(<Failed message={load.message} onRetry={reload} />);

  const data = load.data;
  const values = valuesOf(data.values);
  const status = data.employment?.status ?? null;
  const missingIn = (fields: readonly RecordField[]): number =>
    fields.filter((f) => f.missing === true || (f.required && isEmpty(values[f.key]))).length;
  const sections = data.sections.filter((s) => s.fields.length > 0);
  const section = sections.find((s) => s.key === chosen) ?? sections[0];
  // Nobody emails or calls themselves: the Me tab's record offers neither.
  const own = personId === null;
  // Profile names nobody's id for the viewer's own record; their photo's address does.
  const meId = /photos\/([0-9a-f-]{36})/i.exec(data.person.avatarUrl ?? '')?.[1] ?? null;
  const email = own ? null : contactOf(data, values, 'email');
  const phone = own ? null : contactOf(data, values, 'phone');
  // The chain runs from the top of the organisation down: the manager is its last.
  const manager = data.reportingLine?.chain.at(-1);
  const editable =
    section !== undefined && section.fields.some((f) => !f.readOnly && f.keptIn === null);
  const firstName = data.person.name.split(' ')[0] ?? data.person.name;
  const edit =
    section === undefined || !editable ? undefined : (
      <Button
        size="sm"
        variant="primary"
        startIcon={<Icon icon={Pencil} />}
        accessibilityLabel={`Edit ${section.label}`}
        onPress={() => {
          navigation.navigate('EditSection', {
            ...(personId === null ? {} : { personId }),
            sectionKey: section.key,
            back: own ? 'Me' : firstName,
          });
        }}
      />
    );

  // What the viewer may ask the person to fill in, all at once (design D4).
  const askable = data.sections
    .flatMap((x) => x.fields)
    .filter((f) => f.askable === true && isEmpty(values[f.key]));
  const moves = own ? [] : offeredMoves(status);
  const menu = own ? null : (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="sm" startIcon={<Icon icon={Ellipsis} />} accessibilityLabel="Actions" />
      </DropdownMenuTrigger>
      <DropdownMenuContent label={`Actions for ${data.person.name}`}>
        {moves.length === 0 && data.placement === null ? null : (
          <DropdownMenuLabel>Employment</DropdownMenuLabel>
        )}
        {moves.map((kind) => (
          <DropdownMenuItem
            key={kind}
            icon={MOVE_ICON[kind]}
            destructive={isDestructive(kind)}
            onSelect={() => {
              setOpen({ kind: 'move', move: kind });
            }}
          >
            {MOVE_LABEL[kind]}
          </DropdownMenuItem>
        ))}
        {data.placement === null ? null : (
          <DropdownMenuItem
            icon={MapPin}
            onSelect={() => {
              setOpen({ kind: 'place' });
            }}
          >
            Change placement
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Record</DropdownMenuLabel>
        {askable.length === 0 ? null : (
          <DropdownMenuItem
            icon={Send}
            onSelect={() => {
              void act(
                'RequestDetails',
                { personId, keys: askable.map((f) => f.key) },
                `Asked ${firstName} for ${String(askable.length)} details`,
              );
            }}
          >
            {`Ask ${firstName} for ${String(askable.length)} ${askable.length === 1 ? 'detail' : 'details'}`}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          icon={HistoryIcon}
          onSelect={() => {
            navigation.navigate('History', { personId, back: firstName });
          }}
        >
          History
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={FileDown}
          onSelect={() => {
            setOpen({ kind: 'pdf' });
          }}
        >
          Download PDF
        </DropdownMenuItem>
        {data.person.canViewAs === true ? (
          <DropdownMenuItem
            icon={Eye}
            onSelect={() => {
              setOpen({ kind: 'view' });
            }}
          >
            {`View as ${firstName}`}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const today = data.calendar?.today ?? new Date().toISOString().slice(0, 10);

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
      {open?.kind === 'pdf' ? (
        <ReasonDialog
          title={`${data.person.name}’s record as a PDF`}
          description="Only what you can see. The link works once and expires."
          action="Download PDF"
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
          title={`View Kithena as ${firstName}`}
          description={`Everything as ${firstName} sees it, read-only, for thirty minutes. ${firstName} is told.`}
          action={`View as ${firstName}`}
          busy={viewing}
          onClose={close}
          onSubmit={(reason) => {
            setViewing(true);
            void signed.viewAs(personId, reason).then((refused) => {
              setViewing(false);
              if (refused === null) close();
              else toast({ title: 'That did not work', description: refused, tone: 'danger' });
            });
          }}
        />
      ) : null}
      <Stack gap={2} align="center" className="pt-2">
        <PersonAvatar
          personId={personId ?? meId}
          name={data.person.name}
          avatarUrl={data.person.avatarUrl}
          size="3xl"
          {...(status === 'active' ? { status: 'success' as const } : {})}
        />
        {data.person.canChangePhoto === true ? (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button size="xs" variant="ghost" startIcon={<Icon icon={Camera} />}>
                {data.person.avatarUrl === null ? 'Add a photo' : 'Change photo'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent label="Photo">
              <DropdownMenuItem
                icon={ImageIcon}
                onSelect={() => {
                  void changePhoto(signed, personId).then((up) => {
                    if (up === null) return;
                    if (up.ok) {
                      toast({ title: 'Photo saved', tone: 'success' });
                      reload();
                    } else
                      toast({
                        title: 'That did not work',
                        description: up.message,
                        tone: 'danger',
                      });
                  });
                }}
              >
                Choose a photo
              </DropdownMenuItem>
              {data.person.avatarUrl === null ? null : (
                <DropdownMenuItem
                  icon={Trash2}
                  destructive
                  onSelect={() => {
                    void removePhoto(signed, personId).then((refused) => {
                      if (refused === null) reload();
                      else
                        toast({ title: 'That did not work', description: refused, tone: 'danger' });
                    });
                  }}
                >
                  Remove photo
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {back === undefined ? null : (
          <Text accessibilityRole="header" variant="title2" weight="bold" className="text-center">
            {data.person.name}
          </Text>
        )}
        {data.person.summary === null ? null : (
          <Text tone="muted" className="text-center">
            {data.person.summary}
          </Text>
        )}
        <Inline gap={2} justify="center">
          {status === null ? null : (
            <Badge size="sm" dot tone={STATUS_TONE[STATUS[status] ?? ''] ?? 'neutral'}>
              {STATUS[status] ?? status}
            </Badge>
          )}
          {data.person.missing === null || data.person.missing === 0 ? null : (
            <Badge size="sm" tone="warning">{`${String(data.person.missing)} missing`}</Badge>
          )}
        </Inline>
        {email === null && phone === null ? null : (
          <Inline gap={2} justify="center" className="pt-1">
            {email === null ? null : (
              <Button size="sm" startIcon={<Icon icon={Mail} />} href={`mailto:${email}`}>
                Email
              </Button>
            )}
            {phone === null ? null : (
              <Button size="sm" startIcon={<Icon icon={Phone} />} href={`tel:${phone}`}>
                Call
              </Button>
            )}
          </Inline>
        )}
      </Stack>

      {sections.length > 1 ? (
        <ChipGroup
          type="single"
          value={section?.key ?? ''}
          onValueChange={(key) => {
            // History is the last pill, as in the design, and a screen of its own.
            if (key === HISTORY) {
              navigation.navigate('History', {
                ...(personId === null ? {} : { personId }),
                back: own ? 'Me' : firstName,
              });
              return;
            }
            setChosen(key);
          }}
          accessibilityLabel="Sections"
          scroll
        >
          {sections.map((s) => {
            const missing = missingIn(s.fields);
            return (
              <ChipGroupItem key={s.key} value={s.key} variant="view">
                {missing === 0 ? s.label : `${s.label} · ${String(missing)}`}
              </ChipGroupItem>
            );
          })}
          <ChipGroupItem value={HISTORY} variant="view" icon={HistoryIcon}>
            History
          </ChipGroupItem>
        </ChipGroup>
      ) : null}

      {section === undefined ? null : (
        <Card>
          <KeyValues
            layout="stacked"
            items={section.fields.map((field) => {
              const waiting = data.pending?.find((p) => p.key === field.key);
              return {
                id: field.key,
                label: (
                  <Inline gap={2}>
                    <Text variant="subhead" tone="muted">
                      {field.label}
                    </Text>
                    {field.sensitive === true ? (
                      <Badge size="sm" tone="warning" icon={Lock}>
                        Sensitive
                      </Badge>
                    ) : null}
                    {/* HR or a manager may ask the person to fill in what they own (design D1). */}
                    {field.askable === true && !own && isEmpty(values[field.key]) ? (
                      <Button
                        size="xs"
                        startIcon={<Icon icon={Send} />}
                        loading={busy === 'RequestDetails'}
                        onPress={() => {
                          void act<{ asked: number }>(
                            'RequestDetails',
                            { personId, keys: [field.key] },
                            `Asked ${firstName} for ${field.label.toLowerCase()}`,
                          );
                        }}
                      >
                        Ask
                      </Button>
                    ) : null}
                  </Inline>
                ),
                value: (
                  <Stack gap={2} className="w-full">
                    {FILE_TYPES.has(field.dataType) &&
                    typeof values[field.key] === 'string' &&
                    values[field.key] !== '' ? (
                      <Button
                        size="sm"
                        startIcon={<Icon icon={Paperclip} />}
                        onPress={() => {
                          const id = values[field.key] as string;
                          void openFile(signed, id).then((refused) => {
                            if (refused !== null)
                              toast({
                                title: 'That did not work',
                                description: refused,
                                tone: 'danger',
                              });
                          });
                        }}
                      >
                        {data.files?.find((f) => f.id === values[field.key])?.name ??
                          'Open the file'}
                      </Button>
                    ) : (
                      <DisplayValue field={field} value={values[field.key]} />
                    )}
                    {waiting === undefined ? null : (
                      <PendingNote field={field} pending={waiting} onDone={reload} />
                    )}
                  </Stack>
                ),
              };
            })}
          />
        </Card>
      )}

      {manager === undefined ? null : (
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            Reporting line
          </Text>
          <List>
            <ListItem
              leading={<Avatar name={manager.name} size={40} decorative />}
              description={manager.title === null ? 'Manager' : `Manager · ${manager.title}`}
              chevron
              onPress={() => {
                navigation.push('Profile', {
                  personId: manager.id,
                  name: manager.name,
                  back: data.person.name.split(' ')[0] ?? data.person.name,
                });
              }}
            >
              {manager.name}
            </ListItem>
          </List>
        </Stack>
      )}

      <EmploymentPeriods periods={data.employment?.periods ?? []} />

      {/* Your own record, in the Me tab: where you are signed in, and the way out. */}
      {own && back === undefined ? <Account /> : null}
    </>,
    <Inline gap={2} wrap={false}>
      {menu}
      {edit}
    </Inline>,
  );
}
