import {
  ActionCard,
  Avatar,
  Badge,
  Button,
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
import { FileText, PenLine, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ask, formInputs, useSigned } from '../people/api';
import { nifSuggestion } from '../people/checks';
import { shareBase64 } from '../people/media';
import { readInbox } from './api';
import { d, FieldInput, openIn, str, type Field_, type Nav } from './item';
import { ago, days, dueOf, firstName, iconOf, type Item } from './model';

/**
 * A task with its button on the card (design v3 I1, I5, I10, H1): most are
 * finished here, in a centred modal or with one tap, and the card leaves To
 * do. The card itself opens the item for the rest of the story.
 */

/** A write from a card or its modal: said in a toast, the Inbox read again. */
export function useInboxWrite(): {
  write: (
    area: 'people' | 'timeoff',
    operation: string,
    variables: Record<string, unknown>,
    done: string,
  ) => Promise<boolean>;
  busy: string | null;
} {
  const signed = useSigned();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const write = async (
    area: 'people' | 'timeoff',
    operation: string,
    variables: Record<string, unknown>,
    done: string,
  ): Promise<boolean> => {
    setBusy(operation);
    const answer = await ask<unknown>(signed, operation, variables, area);
    setBusy(null);
    void readInbox(signed);
    if (!answer.ok) {
      toast({ title: 'That did not work', description: answer.message, tone: 'danger' });
      return false;
    }
    toast({ title: done, tone: 'success' });
    return true;
  };
  return { write, busy };
}

/** "No clash. Omar has 14 days left.": what a manager needs before approving (I5). */
export function approvalHint(item: Item): string | null {
  const detail = d(item);
  const who = firstName(str(detail['personName']));
  const week = (detail['week'] ?? []) as { date: string; out: string[] }[];
  const others = [...new Set(week.flatMap((w) => w.out))];
  const left = str(detail['balanceAfter']);
  const clash =
    others.length === 0
      ? 'No clash.'
      : others.length === 1
        ? `${firstName(others[0])} is the only other person out.`
        : `${String(others.length)} others are out that week.`;
  return [clash, left === null ? null : `${who} has ${days(left)} left.`]
    .filter((x) => x !== null)
    .join(' ');
}

type Open = 'details' | 'correct' | 'sign' | null;

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
        actions = action('I’ve read it', () => {
          void write(
            'people',
            'ActOnDocument',
            { id: str(detail['documentId']), action: 'acknowledge' },
            'Acknowledged',
          );
        });
      break;
    }
    case 'people.review':
      actions = action('Open in People', () => {
        navigation.navigate('People');
      });
      break;
    case 'people.integration':
      actions = (
        <>
          {item.team?.mine === true
            ? null
            : action(item.team?.takenBy == null ? 'Take it' : 'Take over', () => {
                void write(
                  'people',
                  'TakeInboxTask',
                  { itemId: item.id, note: null },
                  'It’s yours',
                );
              })}
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
          decision === 'approve' ? `Approved ${who}’s time off` : `Declined ${who}’s time off`,
        );
      };
      actions = (
        <>
          {detail['clash'] === true
            ? action('Options', () => {
                navigation.navigate('TimeOffDecision', {
                  requestId: requestId ?? '',
                  name: str(detail['personName']) ?? 'Request',
                });
              })
            : null}
          <Button
            size="sm"
            accessibilityLabel={`Decline ${who}’s time off`}
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
            Approve
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
      actions = action('Open', show);
  }

  return (
    <>
      <ActionCard
        {...(person && from !== null
          ? { leading: <Avatar name={str(detail['personName']) ?? from} size={40} /> }
          : {
              icon: iconOf(item.icon),
              tone:
                item.tone === 'danger'
                  ? 'danger'
                  : item.tone === 'warning'
                    ? 'warning'
                    : 'neutral',
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
                      ? 'Nobody has it'
                      : item.team.mine
                        ? 'You have it'
                        : `${item.team.takenBy.name ?? 'Somebody'} has it`}
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
        accessibilityLabel={`${item.title}: open`}
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

/** I2: the details somebody asked for, added to the record from the card. */
function DetailsDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { write, busy } = useInboxWrite();
  const detail = d(item);
  const fields = (detail['fields'] ?? []) as Field_[];
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value ?? ''])),
  );
  const filled = fields.every((f) => !f.required || (values[f.key] ?? '') !== '');
  return (
    <Shell
      title={item.title}
      description={item.message ?? item.summary}
      onClose={onClose}
      foot={
        <>
          <Button className="flex-1" onPress={onClose}>
            Cancel
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
                'Added to your record',
              ).then((done) => {
                if (done) onClose();
              });
            }}
          >
            Add to my record
          </Button>
        </>
      }
    >
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
export function CorrectDialog({ item, onClose }: { item: Item; onClose: () => void }) {
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
            Cancel
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
                `Sent to ${to}`,
              ).then((done) => {
                if (done) onClose();
              });
            }}
          >
            {`Send to ${to}`}
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
            <FieldError>{`For ${suggestion.slice(0, -1)} the letter should be ${suggestion.at(-1) ?? ''}.`}</FieldError>
          ) : check !== null ? (
            <FieldError>{check}</FieldError>
          ) : (
            <FieldDescription>{`${to} still checks it against your document.`}</FieldDescription>
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
          {`Use ${suggestion}`}
        </Button>
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
        toast({ title: 'That did not open', description: a.message, tone: 'danger' });
        return;
      }
      const file = JSON.parse(a.data) as { name: string; mediaType: string; data: string };
      await shareBase64(file.data, file.name, file.mediaType);
    });
  };
  return (
    <Shell
      title={item.title}
      description={item.from?.name == null ? null : `From ${item.from.name}`}
      onClose={onClose}
      foot={
        <>
          <Button className="flex-1" onPress={onClose}>
            Not now
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
                  ? { id: documentId, action: 'countersign', name: name.trim() }
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
            {counter ? 'Countersign' : 'Sign'}
          </Button>
        </>
      }
    >
      <List>
        <ListItem
          icon={FileText}
          description="Read it before you sign"
          trailing={
            <Button size="sm" variant="ghost" onPress={openFile}>
              Open
            </Button>
          }
        >
          {str(detail['name']) ?? 'Document'}
        </ListItem>
      </List>
      {changes.length === 0 ? null : (
        <View className="gap-1.5">
          <Text weight="semibold">What it changes</Text>
          {changes.map((c) => (
            <Text key={c} variant="subhead" tone="muted">{`· ${c}`}</Text>
          ))}
        </View>
      )}
      <Field>
        <FieldLabel>Type your full name to sign</FieldLabel>
        <FieldControl>
          <Input value={name} onChange={setName} autoComplete="name" />
        </FieldControl>
      </Field>
    </Shell>
  );
}
