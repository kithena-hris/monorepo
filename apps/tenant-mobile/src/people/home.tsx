import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  CircularProgress,
  Icon,
  Inline,
  List,
  ListItem,
  Stack,
  Stat,
  Text,
  useToast,
} from '@reach/ui-native';
import {
  BellRing,
  Camera,
  CircleCheck,
  ClipboardList,
  CircleDashed,
  Clock,
  Copy,
  KeyRound,
  PencilLine,
  ScanFace,
  TriangleAlert,
  UserPlus,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { AddPersonDialog } from './add-person';
import { ask, useSigned } from './api';
import { longDate } from './display';
import { changePhoto, PersonAvatar, uploadFile } from './media';
import type { OnboardingData } from './onboarding';
import type { PeopleScreen } from './routes';

interface Overview {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  readonly now: string;
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly title: string | null;
    readonly department: string | null;
    readonly location: string | null;
    readonly timeZone: string;
    readonly startedOn: string | null;
    readonly status: string | null;
    readonly missing: number | null;
    readonly required: number;
  } | null;
  readonly reportingLine: {
    readonly managers: readonly {
      id: string;
      name: string;
      title: string | null;
      avatarUrl: string | null;
    }[];
    readonly peers: number | null;
    readonly reports: readonly {
      id: string;
      name: string;
      title: string | null;
      avatarUrl: string | null;
    }[];
    readonly reportsTotal: number;
  } | null;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly flagged: number;
    readonly flagReason: string | null;
    readonly items: readonly {
      id: string;
      label: string;
      requestedAt: string;
      requestedBy: string;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly section: string;
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
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
  readonly setup: {
    readonly photo: 'required' | 'optional' | null;
    readonly fields: readonly {
      key: string;
      sectionKey: string;
      label: string;
      description: string | null;
      dataType: string;
      required: boolean;
    }[];
  } | null;
}

interface HrFigures {
  readonly headcount: { value: number; change: number | null } | null;
  readonly complete: { percent: number; incomplete: number } | null;
  readonly expiring: number | null;
  readonly waiting: {
    identifiers: number | null;
    duplicates: number | null;
    accessRequests: number | null;
    identifiersBy: string[] | null;
    duplicatesBy: string[] | null;
    accessRequestsBy: string[] | null;
  } | null;
  readonly starting: readonly {
    id: string;
    name: string;
    avatarUrl: string | null;
    detail: string;
    missing: number | null;
  }[];
}

/** "2 hours ago", "yesterday", "3 days ago": how long something has waited. */
function waited(since: string, now: string): string {
  const hours = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 3_600_000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${String(days)} days ago`;
}

const counted = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** HR's figures, read beside the overview, each People's own; one refused is left out. */
async function readHr(signed: ReturnType<typeof useSigned>): Promise<HrFigures> {
  const [analytics, waiting, starting] = await Promise.all([
    ask<{
      headcount: { value: number; change: number | null };
      complete: { percent: number; incomplete: number } | null;
      expiringIn90Days: number | null;
    }>(signed, 'Analytics', { segment: null }),
    ask<HrFigures['waiting']>(signed, 'Waiting'),
    ask<{
      people: {
        id: string;
        name: string;
        avatarUrl: string | null;
        values: { key: string; value: string }[];
        missing: number | null;
      }[];
    }>(signed, 'Directory', {
      conditions: [{ key: 'status', op: 'is', values: ['pre_hire'] }],
      sort: 'hire_date:asc',
    }),
  ]);
  return {
    headcount: analytics.ok ? analytics.data.headcount : null,
    complete: analytics.ok ? analytics.data.complete : null,
    expiring: analytics.ok ? analytics.data.expiringIn90Days : null,
    waiting: waiting.ok ? waiting.data : null,
    starting: starting.ok
      ? starting.data.people.slice(0, 5).map((p) => ({
          id: p.id,
          name: p.name,
          avatarUrl: p.avatarUrl,
          missing: p.missing,
          // "Data analyst · 1 Nov": what they will do, and when they start.
          detail: p.values
            .filter((v) => v.key !== 'status' && v.value !== '')
            .map((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.value) ? longDate(v.value) : v.value))
            .slice(0, 2)
            .join(' · '),
        }))
      : [],
  };
}

/** A row of the To do or Needs HR list: a tile, what, why, and the one way onward. */
function Todo({
  icon,
  tone,
  title,
  description,
  word,
  primary = false,
  onPress,
}: {
  icon: typeof Clock;
  tone?: 'danger' | 'warning' | 'info' | 'accent';
  title: string;
  description: string;
  word: string | null;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <ListItem
      icon={icon}
      {...(tone === undefined
        ? {}
        : { iconTone: tone === 'danger' ? 5 : tone === 'warning' ? 4 : 1 })}
      description={description}
      onPress={onPress}
      {...(word === null
        ? { chevron: true }
        : {
            trailing: (
              <Button size="sm" variant={primary ? 'primary' : 'secondary'} onPress={onPress}>
                {word}
              </Button>
            ),
          })}
    >
      {title}
    </ListItem>
  );
}

/**
 * People's home (design B1, B2): "Hi", then for anybody their one To do list
 * (corrections, details to add, changes waiting on HR) and their reporting
 * line; for HR the figures and one "Needs HR" list, each row opening Review
 * with its chip chosen, and who is starting. Signing up's last asks (a photo,
 * a file) come first.
 */
export function PeopleHome({ navigation }: PeopleScreen<'Home'>): React.JSX.Element {
  const signed = useSigned();
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [hr, setHr] = useState<HrFigures | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(0);
  const round = useRef(0);

  const load = async (): Promise<void> => {
    const mine = ++round.current;
    const read = await ask<Overview>(signed, 'Overview');
    if (mine !== round.current) return;
    if (!read.ok) {
      setFailed(read.message);
      return;
    }
    setFailed(null);
    setOverview(read.data);
    // What onboarding still asks: a row on Home until every section is saved.
    void ask<OnboardingData>(signed, 'Onboarding').then((onboarding) => {
      if (mine !== round.current || !onboarding.ok) return;
      setOnboarding(
        onboarding.data.sections.filter((x) => !onboarding.data.saved.includes(x.key)).length,
      );
    });
    if (read.data.roles.hr) setHr(await readHr(signed));
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  const first = (name: string): string => name.split(' ')[0] ?? name;
  if (failed !== null)
    return (
      <Page large="Home">
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  if (overview === null)
    return (
      <Page large="Home">
        <Loading label="Loading your home" />
      </Page>
    );

  const { me, reportingLine, approvals, team, setup } = overview;
  const hrHome = overview.roles.hr ? hr : null;
  const when =
    me === null
      ? ''
      : `${me.location === null ? '' : `${me.location} · `}${new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: me.timeZone }).format(new Date(overview.now))}`;
  const review = (kind: string): void => {
    navigation.navigate('Review', { kind });
  };
  const edit = (sectionKey: string): void => {
    navigation.navigate('EditSection', { sectionKey, back: 'Home' });
  };

  // Their own: corrections, details only they add, and their changes with HR.
  const corrections = overview.corrections ?? [];
  const yours = overview.missing.filter((m) => m.ownedBy === null);
  const theirs = overview.missing.filter((m) => m.ownedBy !== null);
  const changes = approvals !== null && !approvals.isHr ? approvals.items : [];
  const percent =
    me === null || me.required === 0
      ? 100
      : Math.round(((me.required - overview.missing.length) / me.required) * 100);

  // HR's: one Needs HR list across every queue.
  const needs: React.JSX.Element[] = [];
  if (hrHome !== null) {
    if ((approvals?.total ?? 0) > 0) {
      needs.push(
        <Todo
          key="changes"
          icon={PencilLine}
          title={counted(approvals?.total ?? 0, 'change to approve', 'changes to approve')}
          description={
            (approvals?.flagged ?? 0) > 0
              ? `${String(approvals?.flagged)} ${approvals?.flagged === 1 ? 'looks' : 'look'} unusual`
              : 'Waiting for your decision'
          }
          word={null}
          onPress={() => {
            review('changes');
          }}
        />,
      );
    }
    const w = hrHome.waiting;
    if ((w?.identifiers ?? 0) > 0)
      needs.push(
        <Todo
          key="ids"
          icon={ScanFace}
          title={counted(w?.identifiers ?? 0, 'identifier to check', 'identifiers to check')}
          description="Failed a check, or couldn’t be verified"
          word={null}
          onPress={() => {
            review('ids');
          }}
        />,
      );
    if ((w?.duplicates ?? 0) > 0)
      needs.push(
        <Todo
          key="dups"
          icon={Copy}
          title={counted(w?.duplicates ?? 0, 'possible duplicate', 'possible duplicates')}
          description="Same work email, or name and birth date"
          word={null}
          onPress={() => {
            review('duplicates');
          }}
        />,
      );
    if ((w?.accessRequests ?? 0) > 0)
      needs.push(
        <Todo
          key="access"
          icon={KeyRound}
          title={counted(
            w?.accessRequests ?? 0,
            'request for full values',
            'requests for full values',
          )}
          description={`${(w?.accessRequestsBy ?? []).join(' and ') || 'Somebody'} asked to see unmasked values`}
          word={null}
          onPress={() => {
            review('access');
          }}
        />,
      );
    if (team !== null && team.toFill > 0)
      needs.push(
        <Todo
          key="fill"
          icon={CircleDashed}
          title={counted(team.toFill, 'detail for HR', 'details for HR')}
          description="Missing details only HR keeps"
          word={null}
          onPress={() => {
            review('missing');
          }}
        />,
      );
    if (team !== null && team.waiting > 0)
      needs.push(
        <Todo
          key="remind"
          icon={BellRing}
          title={`${counted(team.waiting, 'person has', 'people have')} details to add`}
          description="Reminded by email once a week"
          word={null}
          onPress={() => {
            review('missing');
          }}
        />,
      );
  }

  const setupShown =
    me !== null &&
    setup !== null &&
    (setup.photo !== null || setup.fields.length > 0) &&
    (!later || setup.photo === 'required' || setup.fields.some((f) => f.required));

  return (
    <Page
      large={me === null ? 'Home' : `Hi ${first(me.name)}`}
      {...(hrHome === null
        ? {}
        : {
            trailing: (
              <Button
                size="sm"
                startIcon={<Icon icon={UserPlus} />}
                accessibilityLabel="Add a person"
                onPress={() => {
                  setAdding(true);
                }}
              />
            ),
          })}
    >
      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(personId, name) => {
          navigation.navigate('Profile', { personId, name, back: 'Home' });
        }}
      />
      {when === '' ? null : <Text tone="muted">{when}</Text>}

      {onboarding === 0 ? null : (
        <List>
          <Todo
            icon={ClipboardList}
            tone="accent"
            title="Finish your onboarding"
            description={`${String(onboarding)} ${onboarding === 1 ? 'section' : 'sections'} to go. Each saves on its own.`}
            word="Continue"
            primary
            onPress={() => {
              navigation.navigate('Onboarding');
            }}
          />
        </List>
      )}

      {setupShown ? (
        <Card>
          <CardTitle>Finish setting up your account</CardTitle>
          <CardDescription>
            Your company asks for these. Each is saved as soon as you choose it.
          </CardDescription>
          <Stack gap={2} className="pt-2">
            {setup.photo === null ? null : (
              <Button
                startIcon={<Icon icon={Camera} />}
                loading={busy === 'photo'}
                onPress={() => {
                  setBusy('photo');
                  void changePhoto(signed, null).then((up) => {
                    setBusy(null);
                    if (up === null) return;
                    if (up.ok) void load();
                    else
                      toast({
                        title: 'That did not work',
                        description: up.message,
                        tone: 'danger',
                      });
                  });
                }}
              >
                {setup.photo === 'required' ? 'Add your photo (required)' : 'Add your photo'}
              </Button>
            )}
            {setup.fields.map((f) => (
              <Button
                key={f.key}
                loading={busy === f.key}
                onPress={() => {
                  setBusy(f.key);
                  void uploadFile(
                    signed,
                    null,
                    f.key,
                    f.dataType === 'image' ? 'image' : 'document',
                  ).then(async (up) => {
                    if (up === null || !up.ok) {
                      setBusy(null);
                      if (up !== null)
                        toast({
                          title: 'That did not work',
                          description: up.message,
                          tone: 'danger',
                        });
                      return;
                    }
                    await ask(signed, 'SaveOwnSection', {
                      changed: [{ key: f.key, text: up.value.id }],
                    });
                    setBusy(null);
                    void load();
                  });
                }}
              >
                {f.required ? `${f.label} (required)` : f.label}
              </Button>
            ))}
            {setup.photo === 'required' || setup.fields.some((f) => f.required) ? null : (
              <Button
                variant="ghost"
                onPress={() => {
                  setLater(true);
                }}
              >
                Later
              </Button>
            )}
          </Stack>
        </Card>
      ) : null}

      {hrHome === null ? null : (
        <>
          <Inline gap={2} wrap={false}>
            {hrHome.headcount === null ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Headcount ${String(hrHome.headcount.value)}: open the Directory`}
                className="flex-1"
                onPress={() => {
                  navigation.navigate('Directory');
                }}
              >
                <Stat label="Headcount" value={hrHome.headcount.value.toLocaleString('en-GB')} />
              </Pressable>
            )}
            {hrHome.complete === null ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${String(hrHome.complete.percent)}% complete: open missing details`}
                className="flex-1"
                onPress={() => {
                  review('missing');
                }}
              >
                <Stat label="Complete" value={hrHome.complete.percent} unit="%" />
              </Pressable>
            )}
          </Inline>
          <Stack gap={2}>
            <Inline justify="between" className="px-1">
              <Text variant="footnote" weight="semibold" tone="muted">
                Needs HR
              </Text>
              <Button
                size="xs"
                variant="link"
                onPress={() => {
                  navigation.navigate('Review');
                }}
              >
                Review
              </Button>
            </Inline>
            {needs.length === 0 ? (
              <Card>
                <Inline gap={2}>
                  <Icon icon={CircleCheck} tone="success" />
                  <Text>Nothing needs HR. Records are complete and nothing is flagged.</Text>
                </Inline>
              </Card>
            ) : (
              <List>{needs}</List>
            )}
          </Stack>
          {hrHome.starting.length === 0 ? null : (
            <Stack gap={2}>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                Starting soon
              </Text>
              <List>
                {hrHome.starting.map((p) => (
                  <ListItem
                    key={p.id}
                    leading={
                      <PersonAvatar
                        personId={p.id}
                        name={p.name}
                        avatarUrl={p.avatarUrl}
                        size={40}
                      />
                    }
                    description={p.detail}
                    trailing={
                      p.missing === null || p.missing === 0 ? (
                        <Badge size="sm" tone="success">
                          Ready
                        </Badge>
                      ) : (
                        <Badge size="sm" tone="warning">{`${String(p.missing)} missing`}</Badge>
                      )
                    }
                    onPress={() => {
                      navigation.navigate('Profile', {
                        personId: p.id,
                        name: p.name,
                        back: 'Home',
                      });
                    }}
                  >
                    {p.name}
                  </ListItem>
                ))}
              </List>
            </Stack>
          )}
        </>
      )}

      {me === null || hrHome !== null ? null : (
        <>
          <Card
            onPress={() => {
              navigation.navigate('Profile', { back: 'Home' });
            }}
          >
            <Inline gap={3} wrap={false}>
              <PersonAvatar personId={me.id} name={me.name} avatarUrl={me.avatarUrl} size={56} />
              <Stack gap={1} className="flex-1">
                <Text variant="title3">{me.name}</Text>
                <Text variant="subhead" tone="muted">
                  {[me.title, me.department].filter((x) => x !== null).join(' · ')}
                </Text>
              </Stack>
            </Inline>
          </Card>
          <Card>
            <Inline gap={3} wrap={false}>
              <CircularProgress
                value={percent}
                size={44}
                label={`${String(overview.missing.length)} of ${String(me.required)} required details missing`}
              />
              <Stack gap={1} className="flex-1">
                <Text weight="semibold">{`${String(percent)}% of your record`}</Text>
                <Text variant="subhead" tone="muted">
                  {corrections.length + yours.length + changes.length === 0
                    ? overview.missing.length === 0
                      ? 'Your record is complete'
                      : 'Nothing for you to do'
                    : counted(
                        corrections.length + yours.length + changes.length,
                        'thing to do',
                        'things to do',
                      )}
                </Text>
              </Stack>
            </Inline>
            {corrections.length + yours.length + changes.length === 0 ? null : (
              <List className="mt-2">
                {corrections.map((c) => (
                  <Todo
                    key={`c-${c.key}`}
                    icon={TriangleAlert}
                    tone="danger"
                    title={`Correct your ${c.label}`}
                    description={`HR couldn’t accept it: ${c.reason}`}
                    word="Fix"
                    primary
                    onPress={() => {
                      edit(c.sectionKey);
                    }}
                  />
                ))}
                {yours.map((m) => (
                  <Todo
                    key={m.key}
                    icon={CircleDashed}
                    title={`Add your ${m.label.toLowerCase()}`}
                    description={m.section}
                    word="Add"
                    onPress={() => {
                      edit(m.sectionKey);
                    }}
                  />
                ))}
                {changes.map((c) => (
                  <Todo
                    key={c.id}
                    icon={Clock}
                    title={`Your new ${c.label.toLowerCase()} is with HR`}
                    description={`Sent ${waited(c.requestedAt, overview.now)} · nothing changes until HR approves`}
                    word={null}
                    onPress={() => {
                      navigation.navigate('ReviewChange', { id: c.id });
                    }}
                  />
                ))}
              </List>
            )}
            {theirs.length === 0 ? null : (
              <Text variant="footnote" tone="muted" className="pt-2">
                {`Waiting on ${[...new Set(theirs.map((m) => m.ownedBy))].join(' and ')}: ${theirs.map((m) => m.label).join(', ')}.`}
              </Text>
            )}
          </Card>
        </>
      )}

      {reportingLine === null || reportingLine.managers.length === 0 ? null : (
        <Stack gap={2}>
          <Inline justify="between" className="px-1">
            <Text variant="footnote" weight="semibold" tone="muted">
              Your reporting line
            </Text>
            <Button
              size="xs"
              variant="link"
              onPress={() => {
                navigation.navigate('OrgChart');
              }}
            >
              Org chart
            </Button>
          </Inline>
          <List>
            {reportingLine.managers.slice(0, 1).map((m) => (
              <ListItem
                key={m.id}
                leading={
                  <PersonAvatar personId={m.id} name={m.name} avatarUrl={m.avatarUrl} size={40} />
                }
                description={
                  reportingLine.peers === null
                    ? 'Your manager'
                    : `Your manager · ${reportingLine.peers === 0 ? 'nobody else reports to them' : `${String(reportingLine.peers)} ${reportingLine.peers === 1 ? 'other reports' : 'others report'} to ${first(m.name)}`}`
                }
                chevron
                onPress={() => {
                  navigation.navigate('Profile', { personId: m.id, name: m.name, back: 'Home' });
                }}
              >
                {m.name}
              </ListItem>
            ))}
          </List>
        </Stack>
      )}

      {reportingLine === null || reportingLine.reports.length === 0 ? null : (
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            {`Your direct reports · ${String(reportingLine.reportsTotal)}`}
          </Text>
          <List>
            {reportingLine.reports.map((r) => (
              <ListItem
                key={r.id}
                leading={
                  <PersonAvatar personId={r.id} name={r.name} avatarUrl={r.avatarUrl} size={40} />
                }
                {...(r.title === null ? {} : { description: r.title })}
                chevron
                onPress={() => {
                  navigation.navigate('Profile', { personId: r.id, name: r.name, back: 'Home' });
                }}
              >
                {r.name}
              </ListItem>
            ))}
          </List>
        </Stack>
      )}
    </Page>
  );
}
