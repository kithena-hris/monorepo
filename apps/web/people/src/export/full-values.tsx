import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
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
  KeyValues,
  PageHeader,
  PageSection,
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

import { DATA_HEALTH } from '../data-health';
import { Loaded, type Loadable, type Outcome } from '../load';

/**
 * Full values, through somebody else's hands (PEO-088, PEO-121; PRD §15.2).
 *
 * Finance never downloads a masked value directly: it asks for named fields
 * and says why; HR approves or rejects within seven days; an approval issues
 * one file behind a link that works once and for 24 hours, handed to the
 * requester alone. This screen is both halves: finance's form and its own
 * requests, HR's queue. Which half is drawn is People's answer, not a guess.
 */

export interface FullValuesRequest {
  readonly id: string;
  /** pending, approved, rejected, expired, issued or downloaded. */
  readonly state: string;
  readonly mine: boolean;
  readonly requestedBy: string | null;
  readonly reason: string;
  readonly fields: readonly string[];
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly note: string | null;
  /** The one download, only the requester's, only while usable. */
  readonly link: string | null;
}

export interface FullValuesState {
  readonly canRequest: boolean;
  readonly canDecide: boolean;
  readonly fields: readonly { readonly key: string; readonly label: string }[];
  readonly requests: readonly FullValuesRequest[];
}

export interface FullValuesProps {
  readonly load: Loadable<FullValuesState>;
  readonly onRequest: (fields: readonly string[], reason: string) => Promise<Outcome>;
  readonly onDecide: (id: string, approve: boolean, note: string | null) => Promise<Outcome>;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATE: Partial<Record<string, { readonly tone: Tone; readonly text: string }>> = {
  pending: { tone: 'warning', text: 'Waiting for HR' },
  approved: { tone: 'info', text: 'Approved, being prepared' },
  issued: { tone: 'success', text: 'Ready to download' },
  downloaded: { tone: 'neutral', text: 'Downloaded' },
  rejected: { tone: 'danger', text: 'Rejected' },
  expired: { tone: 'neutral', text: 'Expired' },
};

const day = (iso: string): string => iso.slice(0, 10);

export function FullValues(props: FullValuesProps): JSX.Element {
  return (
    <Loaded load={props.load} what="the requests for full values">
      {(state) => <Requests {...props} state={state} />}
    </Loaded>
  );
}

function Requests({
  state,
  onRequest,
  onDecide,
}: FullValuesProps & { readonly state: FullValuesState }): JSX.Element {
  const [deciding, setDeciding] = useState<{ request: FullValuesRequest; approve: boolean } | null>(
    null,
  );
  const waiting = state.requests.filter((r) => r.state === 'pending' && !r.mine);

  return (
    <Stack gap={6}>
      <PageHeader title={DATA_HEALTH.title} description={DATA_HEALTH.description} />
      <p className="text-sm text-fg-muted">
        Who can see unmasked values, for how long and why: one download, once, within 24 hours of
        HR’s approval. Every request is logged.
      </p>
      {state.canRequest ? <Ask state={state} onRequest={onRequest} /> : null}
      {state.canDecide ? (
        <PageSection title="Waiting for a decision">
          {waiting.length === 0 ? (
            <EmptyState
              title="Nothing to decide"
              description="A request appears here when finance asks."
            />
          ) : (
            // Each request as the decision it is (R11): who, what, why, and the two answers.
            <ul aria-label="Waiting for a decision" className="grid gap-4 @5xl/page:grid-cols-2">
              {waiting.map((r) => {
                const who = r.requestedBy ?? 'Somebody in finance';
                return (
                  <li key={r.id} className="flex">
                    <Card padded className="flex flex-1 flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <Avatar size="xl" name={who} />
                        <div className="min-w-0">
                          <h3 className="text-md font-bold">
                            {who} wants to see {r.fields.join(', ').toLowerCase()}
                          </h3>
                          <p className="text-sm text-fg-muted">Asked {day(r.requestedAt)}</p>
                        </div>
                      </div>
                      <KeyValues
                        layout="aligned"
                        labelWidth="7.5rem"
                        items={[
                          { label: 'Fields', value: r.fields.join(', ') },
                          { label: 'Reason', value: r.reason },
                          { label: 'Expires', value: `${day(r.expiresAt)} if nobody decides` },
                        ]}
                      />
                      <Alert tone="warning" title="These values are masked everywhere else">
                        Approving issues one download, once, within 24 hours. The people whose
                        values are read can see that it happened.
                      </Alert>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          aria-label={`Reject the request from ${who}`}
                          onClick={() => {
                            setDeciding({ request: r, approve: false });
                          }}
                        >
                          Decline
                        </Button>
                        <Button
                          variant="primary"
                          aria-label={`Approve the request from ${who}`}
                          onClick={() => {
                            setDeciding({ request: r, approve: true });
                          }}
                        >
                          Allow
                        </Button>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </PageSection>
      ) : null}
      <PageSection title={state.canDecide ? 'Every request' : 'Your requests'}>
        {state.requests.length === 0 ? (
          <EmptyState title="No requests yet" />
        ) : (
          <List label="Requests" requests={state.requests} />
        )}
      </PageSection>
      {deciding === null ? null : (
        <Decide
          request={deciding.request}
          approve={deciding.approve}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </Stack>
  );
}

function List({
  label,
  requests,
  onDecide,
}: {
  readonly label: string;
  readonly requests: readonly FullValuesRequest[];
  readonly onDecide?: (request: FullValuesRequest, approve: boolean) => void;
}): JSX.Element {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Asked</TableHead>
          <TableHead>Fields and reason</TableHead>
          <TableHead>State</TableHead>
          <TableHead>{onDecide === undefined ? 'File' : 'Decide'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((r) => {
          const shown = STATE[r.state] ?? { tone: 'neutral', text: r.state };
          const who = r.mine ? 'You' : (r.requestedBy ?? 'Somebody in finance');
          return (
            <TableRow key={r.id}>
              <TableCell>
                {who}
                <span className="block text-fg-muted text-sm">{day(r.requestedAt)}</span>
              </TableCell>
              <TableCell>
                <span className="font-medium">{r.fields.join(', ')}</span>
                <span className="block text-fg-muted text-sm">{r.reason}</span>
              </TableCell>
              <TableCell>
                <Badge tone={shown.tone}>{shown.text}</Badge>
                {r.note === null ? null : (
                  <span className="block text-fg-muted text-sm">{r.note}</span>
                )}
                {r.state === 'pending' ? (
                  <span className="block text-fg-muted text-sm">Expires {day(r.expiresAt)}</span>
                ) : null}
              </TableCell>
              <TableCell>
                {onDecide !== undefined ? (
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      aria-label={`Approve the request from ${who}`}
                      onClick={() => {
                        onDecide(r, true);
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`Reject the request from ${who}`}
                      onClick={() => {
                        onDecide(r, false);
                      }}
                    >
                      Reject
                    </Button>
                  </span>
                ) : r.link === null ? (
                  '—'
                ) : (
                  // A signed bearer link that carries its own authority and
                  // works once: a real link, so the browser downloads it.
                  <Button asChild size="sm" variant="primary">
                    <a href={r.link} download>
                      Download, once
                    </a>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Ask({
  state,
  onRequest,
}: {
  readonly state: FullValuesState;
  readonly onRequest: FullValuesProps['onRequest'];
}): JSX.Element {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (state.fields.length === 0) {
    return (
      <Alert tone="info">
        Nothing in the published fields is masked in an export, so there is nothing to ask for.
      </Alert>
    );
  }
  const problems = { fields: chosen.length === 0, reason: reason.trim() === '' };

  return (
    <PageSection title="Ask for full values">
      <form
        aria-label="Ask for full values"
        onSubmit={(event) => {
          event.preventDefault();
          setShown(true);
          if (problems.fields || problems.reason) return;
          setBusy(true);
          setOutcome(null);
          void onRequest(chosen, reason.trim()).then((result) => {
            setBusy(false);
            setOutcome(result);
            if (result.ok) {
              setChosen([]);
              setReason('');
              setShown(false);
            }
          });
        }}
      >
        <Stack gap={4}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Fields</legend>
            {state.fields.map((f) => (
              <Field key={f.key} orientation="horizontal">
                <FieldControl>
                  <Checkbox
                    checked={chosen.includes(f.key)}
                    onCheckedChange={(on) => {
                      setChosen((c) =>
                        on === true ? [...c, f.key] : c.filter((k) => k !== f.key),
                      );
                    }}
                  />
                </FieldControl>
                <FieldLabel>{f.label}</FieldLabel>
              </Field>
            ))}
            {shown && problems.fields ? (
              <p className="text-danger-fg text-xs">Choose at least one field.</p>
            ) : null}
          </fieldset>
          <Field required invalid={shown && problems.reason}>
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
            <FieldDescription>HR sees it, and it is kept with every step.</FieldDescription>
            <FieldError>Say why.</FieldError>
          </Field>
          {outcome === null ? null : outcome.ok ? (
            <Alert tone="success">Asked. HR has seven days to decide.</Alert>
          ) : (
            <Alert tone="danger" title="Not asked">
              {outcome.message}
            </Alert>
          )}
          <div>
            <Button type="submit" variant="primary" loading={busy} loadingLabel="Asking">
              Ask HR
            </Button>
          </div>
        </Stack>
      </form>
    </PageSection>
  );
}

function Decide({
  request,
  approve,
  onDecide,
  onClose,
}: {
  readonly request: FullValuesRequest;
  readonly approve: boolean;
  readonly onDecide: FullValuesProps['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const verb = approve ? 'Approve' : 'Reject';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{verb} the request</DialogTitle>
          <DialogDescription>
            {approve
              ? `${request.fields.join(', ')} in full, one download for the requester, within 24 hours.`
              : 'Nothing is issued. The requester sees your note.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <p className="text-sm">{request.reason}</p>
            <Field>
              <FieldLabel>Note</FieldLabel>
              <FieldControl>
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>Optional; kept with the decision.</FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not decided">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={approve ? 'primary' : 'destructive'}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setBusy(true);
              setRefused(null);
              void onDecide(request.id, approve, note.trim() === '' ? null : note.trim()).then(
                (outcome) => {
                  setBusy(false);
                  if (outcome.ok) onClose();
                  else setRefused(outcome.message);
                },
              );
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
