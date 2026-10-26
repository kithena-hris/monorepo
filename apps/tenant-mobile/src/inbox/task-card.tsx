import {
  ActionCard,
  Avatar,
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
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  Text,
  useToast,
} from '@reach/ui-native';
import { dateFormat } from '@reach/ui-native/words';
import { Contact, getPermissionsAsync } from 'expo-contacts';
import { BookUser, FileText, PenLine, Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ask, formInputs, useSigned } from '../people/api';
import { ScanIdButton } from '../people/attribute-input';
import { nifSuggestion } from '../people/checks';
import { ClashDialog } from '../timeoff/approvals';
import { shareBase64 } from '../people/media';
import { readInbox } from './api';
import { contactShaped, valuesFrom, type PickedContact } from './contact-fill';
import { d, FieldInput, openIn, str, type Field_, type Nav } from './item';
import { ModuleActions, useInboxWrite } from './module-actions';
import { ago, days, dueOf, firstName, iconOf, type Item } from './model';
import { t } from '../i18n';

/**
 * A task with its button on the card (design v3 I1, I5, I10, H1): most are
 * finished here, in a centred modal or with one tap, and the card leaves To
 * do. The card itself opens the item for the rest of the story.
 */

interface Short {
  readonly date: string;
  readonly in: number;
  readonly of: number;
  readonly required: number;
}

/** The days approving it would leave the team below its minimum (Time Off's `short`). */
export const shortOf = (item: Item): readonly Short[] =>
  ((d(item)['short'] ?? []) as readonly Short[]).filter((x) => x.in < x.required);

const weekday = dateFormat({
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * What a manager needs before approving (I5, T8): "Wed 21 would leave 4 of 7
 * in. Your minimum is 5." on a clash; "No clash. Omar has 14 days left." otherwise.
 */
export function approvalHint(item: Item): string | null {
  const detail = d(item);
  const who = firstName(str(detail['personName']));
  const short = shortOf(item)[0];
  if (short !== undefined)
    return `${weekday.format(new Date(`${short.date}T12:00:00Z`))} would leave ${String(short.in)} of ${String(short.of)} in. Your minimum is ${String(short.required)}.`;
  const week = (detail['week'] ?? []) as { date: string; out: string[] }[];
  const others = [...new Set(week.flatMap((w) => w.out))];
  const left = str(detail['balanceAfter']);
  const clash =
    others.length === 0
      ? t('inbox.task-card.no_clash', 'No clash.')
      : others.length === 1
        ? t(
            'inbox.task-card.no_clash_is_the_only_other',
            'No clash. {{firstName}} is the only other person out.',
            { firstName: firstName(others[0]) },
          )
        : t(
            'inbox.task-card.no_clash_with_others_out_that',
            'No clash, with {{String}} others out that week.',
            { String: String(others.length) },
          );
  return [clash, left === null ? null : `${who} has ${days(left)} left.`]
    .filter((x) => x !== null)
    .join(' ');
}

type Open = 'details' | 'correct' | 'sign' | 'clash' | null;

export function TaskCard({
  item,
  now,
  zone,
  navigation,
}: {
  item: Item;
  now: string;
  zone: string;
  navigation: Nav;
}): React.JSX.Element {
  const signed = useSigned();
  const { write, busy } = useInboxWrite();
  const [open, setOpen] = useState<Open>(null);
  const detail = d(item);
  const due = dueOf(item, now, zone);
  const person = item.kind === 'timeoff.approval' || item.kind === 'people.correct';
  const from = item.from?.name ?? null;
  const show = (): void => {
    navigation.navigate('InboxItem', { id: item.id });
  };

  const action = (label: string, onPress: () => void, primary = false): React.JSX.Element => (
    <Button size="sm" variant={primary ? 'primary' : 'secondary'} onPress={onPress}>
      {label}
    </Button>
  );

  let actions: React.JSX.Element | null = null;
  let hint: string | null = str(detail['hint']);
  switch (item.kind) {
    case 'people.details':
      actions = action('Add', () => {
        setOpen('details');
      });
      break;
    case 'people.correct':
      actions = action(
        'Fix',
        () => {
          setOpen('correct');
        },
        true,
      );
      break;
    case 'people.document': {
      const what = str(detail['action']);
      if (what === 'sign' || what === 'countersign')
        actions = action('Sign', () => {
          setOpen('sign');
        });
      else if (what === 'acknowledge')
        actions = action(t('inbox.task-card.ive_read_it', 'I’ve read it'), () => {
          void write(
            'people',
            'ActOnDocument',
            {
              id: str(detail['documentId']),
              action: 'acknowledge',
            },
            'Acknowledged',
          );
        });
      break;
    }
    case 'people.review':
      actions = action(t('inbox.task-card.open_in_people', 'Open in People'), () => {
        navigation.navigate('People');
      });
      break;
    case 'people.integration':
      actions = (
        <>
          {item.team?.mine === true
            ? null
            : action(
                item.team?.takenBy == null
                  ? t('inbox.task-card.take_it', 'Take it')
                  : t('inbox.task-card.take_over', 'Take over'),
                () => {
                  void write(
                    'people',
                    'TakeInboxTask',
                    { itemId: item.id, note: null },
                    t('inbox.task-card.its_yours', 'It’s yours'),
                  );
                },
              )}
          {action(
            'Fix',
            () => {
              navigation.navigate('Integrations');
            },
            true,
          )}
        </>
      );
      break;
    case 'timeoff.approval': {
      const requestId = str(detail['requestId']);
      const who = firstName(str(detail['personName']));
      hint = hint ?? approvalHint(item);
      const decide = (decision: 'approve' | 'decline'): void => {
        void write(
          'timeoff',
          'DecideTimeOffRequest',
          { requestId, input: { decision, reason: null } },
          decision === 'approve'
            ? t('inbox.task-card.approved_s_time_off', 'Approved {{who}}’s time off', { who })
            : t('inbox.task-card.declined_s_time_off', 'Declined {{who}}’s time off', { who }),
        );
      };
      actions = (
        <>
          {shortOf(item).length > 0
            ? action('Options', () => {
                setOpen('clash');
              })
            : null}
          <Button
            size="sm"
            accessibilityLabel={t(
              'inbox.task-card.decline_s_time_off',
              'Decline {{who}}’s time off',
              { who },
            )}
            loading={busy === 'DecideTimeOffRequest'}
            startIcon={<Icon icon={X} size={16} />}
            onPress={() => {
              decide('decline');
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onPress={() => {
              decide('approve');
            }}
          >
            {t('inbox.task-card.approve', 'Approve')}
          </Button>
        </>
      );
      break;
    }
    case 'timeoff.expiring':
      actions = action('Plan', () => {
        navigation.navigate('TimeOffRequest', {
          leaveTypeKey: str(detail['leaveTypeKey']) ?? '',
        });
      });
      break;
    case 'people.checklist':
      actions = action(
        'Continue',
        () => {
          openIn(signed, navigation, item);
        },
        true,
      );
      break;
    default:
      actions = (
        <ModuleActions
          item={item}
          navigation={navigation}
          open={() => {
            openIn(signed, navigation, item);
          }}
          fallback={action('Open', show)}
        />
      );
  }

  return (
    <>
      <ActionCard
        {...(person && from !== null
          ? { leading: <Avatar name={str(detail['personName']) ?? from} size={40} /> }
          : {
              icon: iconOf(item.icon),
              tone:
                item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : 'neutral',
            })}
        title={item.title}
        meta={ago(item.at, now)}
        {...(item.summary === null ? {} : { description: item.summary })}
        {...(hint === null ? {} : { hint })}
        {...(due === null
          ? item.team === null
            ? {}
            : {
                due: (
                  <Badge size="sm" tone={item.team.takenBy === null ? 'warning' : 'info'}>
                    {item.team.takenBy === null
                      ? t('inbox.task-card.nobody_has_it', 'Nobody has it')
                      : item.team.mine
                        ? t('inbox.task-card.you_have_it', 'You have it')
                        : t('inbox.task-card.has_it', '{{value}} has it', {
                            value: item.team.takenBy.name ?? 'Somebody',
                          })}
                  </Badge>
                ),
              }
          : {
              due: (
                <Badge size="sm" tone={due.tone}>
                  {due.label}
                </Badge>
              ),
            })}
        actions={actions}
        onPress={show}
        accessibilityLabel={t('inbox.task-card.open', '{{title}}: open', { title: item.title })}
      />
      {open === 'details' ? (
        <DetailsDialog
          item={item}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {open === 'correct' ? (
        <CorrectDialog
          item={item}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {open === 'clash' ? (
        <ClashDialog
          requestId={str(detail['requestId']) ?? ''}
          onClose={() => {
            setOpen(null);
          }}
          onDone={() => {
            setOpen(null);
            void readInbox(signed);
          }}
        />
      ) : null}
      {open === 'sign' ? (
        <SignTaskDialog
          item={item}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

function Shell({
  title,
  description,
  onClose,
  children,
  foot,
}: {
  title: string;
  description?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  foot: React.ReactNode;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description == null ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>{foot}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Someone from the phone's contacts, read only once chosen or allowed. */
async function contactOf(c: Contact): Promise<PickedContact> {
  const [name, phones, emails] = await Promise.all([c.getFullName(), c.getPhones(), c.getEmails()]);
  return { name, phone: phones[0]?.number ?? null, email: emails[0]?.address ?? null };
}

/**
 * I2's suggestion: when the contacts were already shared with the app, the
 * first person with your family name who isn't you; otherwise nothing is read
 * until you choose somebody in the system's own picker.
 */
function useSuggestion(enabled: boolean): PickedContact | null {
  const { person } = useSigned();
  const [found, setFound] = useState<PickedContact | null>(null);
  useEffect(() => {
    const family = person.name?.family ?? '';
    if (!enabled || family === '') return undefined;
    const run = { live: true };
    void (async () => {
      const allowed = await getPermissionsAsync().catch(() => null);
      if (allowed?.granted !== true) return;
      const matches = await Contact.getAll({ name: family, limit: 5 }).catch(() => []);
      const me = `${person.name?.given ?? ''} ${family}`.trim().toLowerCase();
      for (const c of matches) {
        const picked = await contactOf(c);
        if (picked.name.toLowerCase() !== me && picked.phone !== null) {
          if (run.live) setFound(picked);
          return;
        }
      }
    })();
    return () => {
      run.live = false;
    };
  }, [enabled, person]);
  return found;
}

/** I2: the details somebody asked for, added to the record from the card. */
function DetailsDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { write, busy } = useInboxWrite();
  const detail = d(item);
  const fields = (detail['fields'] ?? []) as Field_[];
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value ?? ''])),
  );
  const shaped = contactShaped(fields);
  const suggested = useSuggestion(shaped);
  const [used, setUsed] = useState(false);
  const pour = (c: PickedContact): void => {
    setValues((was) => ({ ...was, ...valuesFrom(fields, c) }));
    setUsed(true);
  };
  const filled = fields.every((f) => !f.required || (values[f.key] ?? '') !== '');
  return (
    <Shell
      title={item.title}
      description={item.message ?? item.summary}
      onClose={onClose}
      foot={
        <>
          <Button className="flex-1" onPress={onClose}>
            {t('inbox.task-card.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={!filled}
            loading={busy === 'CompleteAsk'}
            onPress={() => {
              void write(
                'people',
                'CompleteAsk',
                { id: str(detail['askId']), values: JSON.stringify(values) },
                t('inbox.task-card.added_to_your_record', 'Added to your record'),
              ).then((done) => {
                if (done) onClose();
              });
            }}
          >
            {t('inbox.task-card.add_to_my_record', 'Add to my record')}
          </Button>
        </>
      }
    >
      {!shaped || used ? null : suggested !== null ? (
        <Card variant="fill" padded={false}>
          <ListItem
            listitem={false}
            className="bg-transparent"
            leading={<Avatar name={suggested.name} size={36} />}
            description={t(
              'inbox.task-card.from_your_phones_contacts',
              'From your phone’s contacts',
            )}
            trailing={
              <Button
                size="sm"
                variant="link"
                onPress={() => {
                  pour(suggested);
                }}
              >
                {t('inbox.task-card.use', 'Use')}
              </Button>
            }
          >
            {t('inbox.task-card.use_2', 'Use {{name}}?', { name: suggested.name })}
          </ListItem>
        </Card>
      ) : (
        <Button
          variant="tinted"
          startIcon={<Icon icon={BookUser} tone="accent" />}
          onPress={() => {
            void Contact.presentPicker()
              .then(async (c) => {
                if (c !== null) pour(await contactOf(c));
              })
              .catch(() => undefined);
          }}
        >
          {t('inbox.task-card.choose_from_your_contacts', 'Choose from your contacts')}
        </Button>
      )}
      {fields.map((f) => (
        <FieldInput
          key={f.key}
          field={f}
          value={values[f.key]}
          disabled={false}
          onChange={(v) => {
            setValues((was) => ({ ...was, [f.key]: v }));
          }}
        />
      ))}
    </Shell>
  );
}

/** P15: a refused value, the right one worked out where it can be, sent back to HR. */
export function CorrectDialog({
  item,
  onClose,
}: {
  item: Item;
  onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { write, busy } = useInboxWrite();
  const field = d(item)['field'] as Field_ | undefined;
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  const to = firstName(item.from?.name) || 'HR';
  const suggestion = nifSuggestion(value);
  const type = (text: string): void => {
    setValue(text);
    if (field === undefined || text.trim().length < 4) {
      setCheck(null);
      return;
    }
    void ask<{ findings?: { message: string }[] }>(signed, 'IdentifierCheck', {
      personId: null,
      changed: formInputs({ [field.key]: text }),
    }).then((a) => {
      if (!a.ok) return;
      const found = (a.data.findings ?? []).map((f) => f.message);
      setCheck(found.length === 0 ? null : found.join(' '));
    });
  };
  return (
    <Shell
      title={item.title}
      description={item.summary}
      onClose={onClose}
      foot={
        <>
          <Button className="flex-1" onPress={onClose}>
            {t('inbox.task-card.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={value.trim() === '' || field === undefined}
            loading={busy === 'SaveOwnSection'}
            onPress={() => {
              if (field === undefined) return;
              void write(
                'people',
                'SaveOwnSection',
                { changed: formInputs({ [field.key]: value.trim() }) },
                t('inbox.task-card.sent_to', 'Sent to {{to}}', { to }),
              ).then((done) => {
                if (done) onClose();
              });
            }}
          >
            {t('inbox.task-card.send_to', 'Send to {{to}}', { to })}
          </Button>
        </>
      }
    >
      {field === undefined ? (
        <Text tone="muted">{item.summary ?? ''}</Text>
      ) : (
        <Field invalid={check !== null || suggestion !== null}>
          <FieldLabel>{field.label}</FieldLabel>
          <FieldControl>
            <Input value={value} onChange={type} autoCapitalize="characters" />
          </FieldControl>
          {suggestion !== null ? (
            <FieldError>
              {t(
                'inbox.task-card.for_the_letter_should_be',
                'For {{slice}} the letter should be {{value}}.',
                { slice: suggestion.slice(0, -1), value: suggestion.at(-1) ?? '' },
              )}
            </FieldError>
          ) : check !== null ? (
            <FieldError>{check}</FieldError>
          ) : (
            <FieldDescription>
              {t(
                'inbox.task-card.still_checks_it_against_your_document',
                '{{to}} still checks it against your document.',
                { to },
              )}
            </FieldDescription>
          )}
        </Field>
      )}
      {suggestion === null ? null : (
        <Button
          variant="tinted"
          fullWidth
          startIcon={<Icon icon={Sparkles} tone="accent" />}
          onPress={() => {
            type(suggestion);
          }}
        >
          {t('inbox.task-card.use_3', 'Use {{suggestion}}', { suggestion })}
        </Button>
      )}
      {field === undefined ? null : (
        <ScanIdButton
          onValue={(v) => {
            type(v);
          }}
        />
      )}
    </Shell>
  );
}

/** I3: the document, opened from the modal, and a typed signature. */
function SignTaskDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const signed = useSigned();
  const { toast } = useToast();
  const { write, busy } = useInboxWrite();
  const detail = d(item);
  const documentId = str(detail['documentId']) ?? '';
  const counter = str(detail['action']) === 'countersign';
  const changes = (detail['changes'] ?? []) as string[];
  const [name, setName] = useState('');
  const openFile = (): void => {
    void ask<string>(signed, 'PeopleDocumentFile', { id: documentId }).then(async (a) => {
      if (!a.ok) {
        toast({
          title: t('inbox.task-card.that_did_not_open', 'That did not open'),
          description: a.message,
          tone: 'danger',
        });
        return;
      }
      const file = JSON.parse(a.data) as { name: string; mediaType: string; data: string };
      await shareBase64(file.data, file.name, file.mediaType);
    });
  };
  return (
    <Shell
      title={item.title}
      description={
        item.from?.name == null
          ? null
          : t('inbox.task-card.from', 'From {{name}}', { name: item.from.name })
      }
      onClose={onClose}
      foot={
        <>
          <Button className="flex-1" onPress={onClose}>
            {t('inbox.task-card.not_now', 'Not now')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            startIcon={<Icon icon={PenLine} tone="on-accent" />}
            disabled={name.trim() === ''}
            loading={busy === 'ActOnDocument'}
            onPress={() => {
              void write(
                'people',
                'ActOnDocument',
                counter
                  ? {
                      id: documentId,
                      action: 'countersign',
                      name: name.trim(),
                    }
                  : {
                      id: documentId,
                      action: 'sign',
                      name: name.trim(),
                      how: 'typed',
                      mark: name.trim(),
                    },
                counter ? 'Countersigned' : 'Signed',
              ).then((done) => {
                if (done) onClose();
              });
            }}
          >
            {counter
              ? t('inbox.task-card.countersign_2', 'Countersign')
              : t('inbox.task-card.sign_2', 'Sign')}
          </Button>
        </>
      }
    >
      <List>
        <ListItem
          icon={FileText}
          description={t('inbox.task-card.read_it_before_you_sign', 'Read it before you sign')}
          trailing={
            <Button size="sm" variant="ghost" onPress={openFile}>
              {t('inbox.task-card.open_2', 'Open')}
            </Button>
          }
        >
          {str(detail['name']) ?? t('inbox.task-card.document', 'Document')}
        </ListItem>
      </List>
      {changes.length === 0 ? null : (
        <View className="gap-1.5">
          <Text weight="semibold">{t('inbox.task-card.what_it_changes', 'What it changes')}</Text>
          {changes.map((c) => (
            <Text key={c} variant="subhead" tone="muted">{`· ${c}`}</Text>
          ))}
        </View>
      )}
      <Field>
        <FieldLabel>
          {t('inbox.task-card.type_your_full_name_to_sign', 'Type your full name to sign')}
        </FieldLabel>
        <FieldControl>
          <Input value={name} onChange={setName} autoComplete="name" />
        </FieldControl>
      </Field>
    </Shell>
  );
}
