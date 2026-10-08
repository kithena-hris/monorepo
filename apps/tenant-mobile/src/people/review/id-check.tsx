import {
  Alert,
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
  FieldDescription,
  FieldError,
  FieldLabel,
  Icon,
  Inline,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { useRead } from '../api';
import type { PeopleScreen } from '../routes';
import type { IdItem, IdState } from './model';

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Accepting or sending back, confirmed, with what is wrong said when it goes back. */
function Decide({
  item,
  accept,
  onClose,
  onDone,
}: {
  item: IdItem;
  accept: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const [unexplained, setUnexplained] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${accept ? 'Accept' : 'Send back'} ${item.name}’s ${item.label}`}</DialogTitle>
          <DialogDescription>
            {accept
              ? item.held === true
                ? 'Final: this value will not be flagged again, and the change can now be approved.'
                : 'Final: this value will not be flagged again, whatever a later check says.'
              : item.held === true
                ? `The change is declined, and ${item.name} is asked to correct it. They see your reason on their record and by email.`
                : `${item.name} is asked to correct it, and their record shows it needs attention.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required={!accept} invalid={!accept && unexplained}>
            <FieldLabel>{accept ? 'Note' : 'What is wrong'}</FieldLabel>
            <Textarea
              value={note}
              onChange={(text) => {
                setNote(text);
                setUnexplained(false);
              }}
              maxLength={500}
            />
            <FieldDescription>
              {accept
                ? 'Optional; kept with the decision.'
                : `${item.name} sees it on their record, so they know what to correct.`}
            </FieldDescription>
            {!accept && unexplained ? (
              <FieldError>Say what is wrong, so they know what to correct.</FieldError>
            ) : null}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy !== null}
            onPress={() => {
              if (!accept && note.trim() === '') {
                setUnexplained(true);
                return;
              }
              void act(
                'ReviewIdentifier',
                {
                  personId: item.personId,
                  attributeKey: item.attributeKey,
                  decision: accept ? 'accept' : 'send_back',
                  ...(note.trim() === '' ? {} : { note: note.trim() }),
                },
                accept ? 'Accepted' : 'Sent back',
              ).then((done) => {
                if (done === null) return;
                onClose();
                onDone();
              });
            }}
          >
            {accept ? 'Accept' : 'Send back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An identifier the checks doubt (design E3): what was entered, masked until
 * revealed (revealing is logged), what the checks found, and the two
 * decisions, each confirmed. Whatever is decided is final.
 */
export function ReviewId({ navigation, route }: PeopleScreen<'ReviewId'>): React.JSX.Element {
  const { personId, attributeKey } = route.params;
  const { load, reload } = useRead<IdState>('IdentifierReviews', { person: personId });
  const { act, busy } = useAct();
  const [shown, setShown] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const back = { label: 'All items', onPress: navigation.goBack };

  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label="Loading the ID check" />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const item = load.data.items.find((i) => i.attributeKey === attributeKey);
  if (item === undefined) {
    return (
      <Page back={back}>
        <Alert tone="info" title="Already reviewed">
          This identifier is no longer waiting.
        </Alert>
      </Page>
    );
  }
  const first = item.name.split(' ')[0] ?? item.name;

  return (
    <Page
      back={back}
      foot={
        <>
          <Button
            className="flex-1"
            fullWidth
            onPress={() => {
              setDeciding(false);
            }}
          >
            {`Ask ${first}`}
          </Button>
          <Button
            className="flex-1"
            fullWidth
            variant="primary"
            onPress={() => {
              setDeciding(true);
            }}
          >
            Mark as correct
          </Button>
        </>
      }
    >
      <Inline gap={3} wrap={false} align="center">
        <Avatar name={item.name} size={44} decorative />
        <Stack gap={1} className="flex-1">
          <Text variant="title3">{`${item.name} · ${item.label}`}</Text>
          <Text variant="footnote" tone="muted">
            {`Entered ${item.enteredBy === null ? '' : `by ${item.enteredBy} `}on ${day(item.enteredAt)}`}
          </Text>
        </Stack>
        {item.held === true ? (
          <Badge size="sm" tone="warning">
            Waiting for approval
          </Badge>
        ) : null}
      </Inline>
      <Card>
        <Stack gap={2}>
          <Text variant="footnote" tone="muted">
            What they entered
          </Text>
          <Inline gap={2} justify="between" wrap={false}>
            <Text weight="medium" className="font-mono tracking-widest">
              {shown ?? (item.last4 === null ? '—' : `•••• ${item.last4}`)}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              startIcon={<Icon icon={shown === null ? Eye : EyeOff} />}
              loading={busy === 'RevealIdentifier'}
              onPress={() => {
                if (shown !== null) {
                  setShown(null);
                  return;
                }
                void act<{ value: string }>('RevealIdentifier', { personId, attributeKey }).then(
                  (revealed) => {
                    if (revealed !== null) setShown(revealed.value);
                  },
                );
              }}
            >
              {shown === null ? 'Reveal' : 'Hide'}
            </Button>
          </Inline>
        </Stack>
      </Card>
      <Card>
        <Stack gap={2}>
          <Text variant="footnote" tone="muted">
            What the checks found
          </Text>
          {item.findings.map((f) => (
            <Stack key={f.code} gap={1}>
              <Inline>
                <Badge size="sm" tone={f.level === 'mismatch' ? 'danger' : 'warning'}>
                  {f.level === 'mismatch' ? 'Does not compute' : 'Could not verify'}
                </Badge>
              </Inline>
              <Text>{f.message}</Text>
            </Stack>
          ))}
        </Stack>
      </Card>
      <Text variant="footnote" tone="muted">
        Revealing the value is logged. Whatever you decide is final.
      </Text>
      {deciding === null ? null : (
        <Decide
          item={item}
          accept={deciding}
          onClose={() => {
            setDeciding(null);
          }}
          onDone={navigation.goBack}
        />
      )}
    </Page>
  );
}
