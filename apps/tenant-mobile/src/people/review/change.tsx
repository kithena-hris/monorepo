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
  HorizontalBarChart,
  Icon,
  Inline,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Flag, MessageCircle, Sparkles, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { useRead, type RecordField } from '../api';
import { DisplayValue, longDate } from '../display';
import type { PeopleScreen } from '../routes';
import { approvalsOf } from './load';
import { daysLeft, firstName, isClosed, isFlagged, type ApprovalItem } from './model';

/** Enough of a field to draw a value: a pending value carries no options or type. */
const asField = (item: ApprovalItem): RecordField => ({
  key: item.key,
  label: item.label,
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  missing: null,
  readOnly: true,
  currency: null,
  ownedBy: null,
  keptIn: null,
  sensitive: true,
  askable: null,
});

/** "Ask Marco": a question to the requester, kept with the change. */
function AskDialog({
  item,
  onClose,
  onDone,
}: {
  item: ApprovalItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { act, busy } = useAct();
  const [question, setQuestion] = useState('');
  const to = firstName(item.requestedBy);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Ask ${to} about this change`}</DialogTitle>
          <DialogDescription>
            {`${to === 'the requester' ? 'They see' : `${to} sees`} your question on ${item.name}’s ${item.label.toLowerCase()} change, and answers there. Nothing is decided meanwhile.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Question</FieldLabel>
            <Textarea value={question} onChange={setQuestion} maxLength={500} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={question.trim() === ''}
            loading={busy !== null}
            onPress={() => {
              void act(
                'AskAboutPendingChange',
                { id: item.id, question: question.trim() },
                'Question sent',
              ).then((done) => {
                if (done === null) return;
                onClose();
                onDone();
              });
            }}
          >
            Send question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Questions about the change, and the requester's answer box (E6). */
function Questions({ item, onDone }: { item: ApprovalItem; onDone: () => void }) {
  const { act, busy } = useAct();
  const [answer, setAnswer] = useState('');
  const questions = item.questions ?? [];
  if (questions.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Questions
      </Text>
      {questions.map((q) => (
        <Card key={q.id}>
          <Stack gap={2}>
            <Inline gap={2}>
              <Icon icon={MessageCircle} size={16} tone="info" />
              <Text variant="subhead">{`${q.askedBy} asked: “${q.question}”`}</Text>
            </Inline>
            {q.answer === null ? (
              q.canAnswer ? (
                <>
                  <Textarea value={answer} onChange={setAnswer} maxLength={500} />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={answer.trim() === ''}
                    loading={busy !== null}
                    onPress={() => {
                      void act(
                        'AnswerApprovalQuestion',
                        { id: q.id, answer: answer.trim() },
                        'Answer sent',
                      ).then((done) => {
                        if (done !== null) onDone();
                      });
                    }}
                  >
                    Send answer
                  </Button>
                </>
              ) : (
                <Text variant="footnote" tone="muted">
                  Not answered yet.
                </Text>
              )
            ) : (
              <Text variant="subhead" tone="muted">
                {`${item.requestedBy === 'You' ? 'You' : item.requestedBy}: “${q.answer}”`}
              </Text>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

/**
 * One change (design E2, E6): who asked, the value in force beside the one
 * asked for, why it is flagged, the questions, and the decision pinned at
 * the foot — Reject and Approve for whoever decides (a note required to
 * approve something flagged), Withdraw for whoever asked.
 */
export function ReviewChange({
  navigation,
  route,
}: PeopleScreen<'ReviewChange'>): React.JSX.Element {
  const { load, reload } = useRead<Parameters<typeof approvalsOf>[0]>('Approvals', {
    change: route.params.id,
  });
  const { act, busy } = useAct();
  const [note, setNote] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [asking, setAsking] = useState(false);

  const back = { label: 'All items', onPress: navigation.goBack };
  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading label="Loading the change" />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const approvals = approvalsOf(load.data);
  const item =
    [...approvals.items, ...approvals.decided].find((i) => i.id === route.params.id) ?? null;
  if (item === null) {
    return (
      <Page back={back}>
        <Alert tone="info" title="Already decided">
          This change is no longer waiting.
        </Alert>
      </Page>
    );
  }

  const field = asField(item);
  const flagged = isFlagged(item);
  const decided = isClosed(item);
  const requester = firstName(item.requestedBy);
  const after = (done: unknown): void => {
    if (done !== null) navigation.goBack();
  };
  const decide = (approve: boolean): void => {
    const said = note.trim();
    if (approve && flagged && said === '') {
      setNeedsNote(true);
      return;
    }
    void act(
      'DecidePendingChange',
      { id: item.id, approve, note: said === '' ? null : said, soleApprover: false },
      approve ? 'Approved' : 'Rejected',
    ).then(after);
  };

  const foot = decided ? undefined : item.canSelfApprove === true &&
    item.awaitingReview !== true ? (
    <Button
      className="flex-1"
      fullWidth
      variant="primary"
      loading={busy !== null}
      onPress={() => {
        void act(
          'DecidePendingChange',
          {
            id: item.id,
            approve: true,
            note: note.trim() === '' ? null : note.trim(),
            soleApprover: true,
          },
          'Approved',
        ).then(after);
      }}
    >
      Approve it yourself
    </Button>
  ) : item.canDecide ? (
    <>
      <Button
        className="flex-1"
        fullWidth
        loading={busy !== null}
        onPress={() => {
          decide(false);
        }}
      >
        Reject
      </Button>
      {item.awaitingReview === true ? null : (
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          loading={busy !== null}
          onPress={() => {
            decide(true);
          }}
        >
          {/* The note field says it is required; a half-width button has no room to. */}
          Approve
        </Button>
      )}
    </>
  ) : item.mine ? (
    <Button
      className="flex-1"
      fullWidth
      loading={busy !== null}
      onPress={() => {
        void act('WithdrawPendingChange', { id: item.id }, 'Withdrawn').then(after);
      }}
    >
      Withdraw
    </Button>
  ) : undefined;

  return (
    <Page back={back} {...(foot === undefined ? {} : { foot })}>
      <Inline gap={3} wrap={false} align="center">
        <Avatar name={item.name} size={44} decorative />
        <Stack gap={1} className="flex-1">
          <Text variant="title3">{`${item.name} · ${item.label}`}</Text>
          <Text variant="footnote" tone="muted">
            {`Asked by ${item.requestedBy} · ${
              decided
                ? item.state === 'lapsed'
                  ? 'lapsed, nobody decided in 7 days'
                  : item.state === 'withdrawn'
                    ? 'withdrawn'
                    : `${item.state === 'approved' ? 'approved' : 'rejected'} by ${item.decidedBy ?? 'HR'}`
                : daysLeft(item.expiresAt, Date.now()).toLowerCase()
            }`}
          </Text>
        </Stack>
      </Inline>

      {item.readable ? (
        <Card>
          <Stack gap={2}>
            <Text variant="footnote" tone="muted">
              {item.kind === 'correction' ? `${item.label} (correction)` : item.label}
            </Text>
            {decided ? null : (
              <DisplayValue
                field={field}
                value={item.before ?? item.current}
                className="text-fg-subtle line-through"
              />
            )}
            <DisplayValue field={field} value={item.value} />
            <Text variant="footnote" tone="muted">
              {`Effective ${longDate(item.effectiveFrom)}`}
            </Text>
          </Stack>
        </Card>
      ) : (
        <Text tone="muted">
          {`You can’t view this field. Decide based on who asked and why. It takes effect from ${longDate(item.effectiveFrom)}.`}
        </Text>
      )}

      {item.reason === null ? null : <Text>{`“${item.reason}”`}</Text>}
      {item.awaitingReview === true ? (
        <Alert tone="warning" title="Check this ID under ID checks first">
          {(item.findings ?? []).map((f) => f.message).join(' ')}
        </Alert>
      ) : null}

      {flagged && !decided ? (
        <Card>
          <Stack gap={3}>
            <Inline gap={2} justify="between">
              <Inline gap={2}>
                <Icon icon={Sparkles} size={16} tone="accent" />
                <Text weight="semibold">Why this is flagged</Text>
              </Inline>
              <Badge size="sm" tone="assistant">
                AI
              </Badge>
            </Inline>
            {(item.flags ?? []).map((f) => (
              <Inline key={f.code} gap={3} wrap={false} align="start">
                <Icon icon={TriangleAlert} tone="warning" />
                <Stack gap={1} className="flex-1">
                  <Text weight="semibold">{f.title}</Text>
                  {f.detail === '' ? null : (
                    <Text variant="subhead" tone="muted">
                      {f.detail}
                    </Text>
                  )}
                </Stack>
              </Inline>
            ))}
            {(item.comparisons ?? []).length === 0 ? null : (
              <HorizontalBarChart
                label="This change against the raises it was compared with"
                data={(item.comparisons ?? []).map((c) => ({
                  label: c.label,
                  value: Number(c.percent),
                }))}
                format={(value) => `${String(value)}%`}
              />
            )}
            {item.flagNote === null ? null : (
              <Text variant="footnote" tone="muted">
                {item.flagNote}
              </Text>
            )}
            <Text variant="footnote" tone="muted">
              Flags never decide anything.
            </Text>
          </Stack>
        </Card>
      ) : null}
      {flagged && decided ? (
        <Inline gap={1}>
          <Icon icon={Flag} size={14} tone="warning" />
          <Text variant="footnote" tone="warning">
            {`Flagged when decided: ${item.flagSummary ?? ''}`}
          </Text>
        </Inline>
      ) : null}
      {decided && item.note !== null ? <Text>{`Note: “${item.note}”`}</Text> : null}

      <Questions item={item} onDone={reload} />

      {item.canDecide && !decided ? (
        <Field invalid={needsNote}>
          <FieldLabel>Note</FieldLabel>
          <Textarea
            value={note}
            onChange={(text) => {
              setNote(text);
              if (text.trim() !== '') setNeedsNote(false);
            }}
            maxLength={500}
            placeholder={flagged ? 'Required to approve something flagged' : 'Optional'}
          />
          <FieldDescription>
            {flagged ? 'Required when you approve something flagged.' : 'Kept with the decision.'}
          </FieldDescription>
          {needsNote ? <FieldError>Add a note to approve something flagged.</FieldError> : null}
        </Field>
      ) : null}

      {decided ? null : (
        <Inline gap={2}>
          {item.canMark === true ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'MarkPendingChangeNotUnusual'}
              onPress={() => {
                void act('MarkPendingChangeNotUnusual', { id: item.id }, 'Marked not unusual').then(
                  (done) => {
                    if (done !== null) reload();
                  },
                );
              }}
            >
              Not unusual
            </Button>
          ) : null}
          {item.canAsk === true ? (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setAsking(true);
              }}
            >
              {`Ask ${requester}`}
            </Button>
          ) : null}
          {!item.canDecide && !item.mine ? (
            <Text variant="footnote" tone="muted">
              This change is about you, so someone else decides.
            </Text>
          ) : null}
        </Inline>
      )}
      {asking ? (
        <AskDialog
          item={item}
          onClose={() => {
            setAsking(false);
          }}
          onDone={reload}
        />
      ) : null}
    </Page>
  );
}
