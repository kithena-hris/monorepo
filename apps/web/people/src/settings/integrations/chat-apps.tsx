import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  AppMark,
  Badge,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  PageSection,
  Stack,
  Switch,
  type ThirdPartyApp,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../../load';

/**
 * People in the company's chat apps (Slack today, others later): connect one,
 * choose which of People's notices go there, and see what the assistant may
 * answer about.
 *
 * Nothing here is Slack's: an app is a row with its own mark and name, and a
 * notice goes to whichever app is connected. The notices are the heart of it —
 * each says who receives it and what they can do without opening Kithena.
 */

export interface ChatAppView {
  readonly key: string;
  readonly name: string;
  readonly canConnect: boolean;
  readonly connection: { readonly workspace: string; readonly connectedAt: string } | null;
}

export interface ChatNoticeView {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly to: string;
  /** What the person can do from the message itself, or null for a notice only. */
  readonly action: string | null;
  readonly on: boolean;
}

export interface ChatAppsState {
  readonly apps: readonly ChatAppView[];
  readonly notices: readonly ChatNoticeView[];
  readonly fields: {
    readonly on: readonly { readonly key: string; readonly label: string }[];
    readonly shareable: number;
  };
}

export type ConnectOutcome =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string };

export interface ChatAppsProps {
  /** Where to send the administrator to connect it. */
  readonly onConnect: (app: string) => Promise<ConnectOutcome>;
  readonly onDisconnect: (app: string) => Promise<Outcome>;
  readonly onNotice: (key: string, on: boolean) => Promise<Outcome>;
  /** Where each field's assistant setting is chosen. */
  readonly fieldsHref: string;
  /** What the connection round trip came back with, said once. */
  readonly returned?: { readonly ok: boolean; readonly message: string } | null;
}

/** The apps Reach draws a mark for; another app is shown by name alone. */
const MARKED = new Set<string>(['slack']);
const markOf = (key: string) => (MARKED.has(key) ? (key as ThirdPartyApp) : null);

export function ChatApps({
  state,
  onConnect,
  onDisconnect,
  onNotice,
  fieldsHref,
  returned,
}: ChatAppsProps & { readonly state: ChatAppsState }): JSX.Element {
  const connected = state.apps.filter((a) => a.connection !== null);
  return (
    <PageSection
      title="Chat apps"
      description="Let people ask Kithena questions, approve changes and fill in their details without leaving their chat app. Everyone sees only what they could see in Kithena itself."
    >
      <Stack gap={4}>
        {returned === undefined || returned === null ? null : (
          <Alert tone={returned.ok ? 'success' : 'danger'} title={returned.message} />
        )}
        {state.apps.length === 0 ? (
          <Alert tone="info" title="No chat app is set up in this deployment">
            Ask whoever runs Kithena for you to add one.
          </Alert>
        ) : (
          state.apps.map((app) => (
            <AppRow key={app.key} app={app} onConnect={onConnect} onDisconnect={onDisconnect} />
          ))
        )}
        <Notices
          notices={state.notices}
          connected={connected.map((a) => a.name)}
          onNotice={onNotice}
        />
        <Answers fields={state.fields} fieldsHref={fieldsHref} />
      </Stack>
    </PageSection>
  );
}

function AppRow({
  app,
  onConnect,
  onDisconnect,
}: {
  readonly app: ChatAppView;
  readonly onConnect: ChatAppsProps['onConnect'];
  readonly onDisconnect: ChatAppsProps['onDisconnect'];
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mark = markOf(app.key);
  const since =
    app.connection === null
      ? null
      : new Date(app.connection.connectedAt).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });

  const connect = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const answer = await onConnect(app.key);
    if (answer.ok) {
      window.location.assign(answer.url);
      return;
    }
    setBusy(false);
    setProblem(answer.message);
  };

  return (
    <PageSection
      surface
      aria-label={app.name}
      title={
        <span className="flex items-center gap-2.5">
          {mark === null ? null : <AppMark app={mark} className="size-6" />}
          {app.name}
        </span>
      }
      description={
        app.connection === null
          ? app.canConnect
            ? `Connect your ${app.name} workspace. You approve it in ${app.name}, then come straight back here.`
            : `${app.name} is not set up in this deployment yet.`
          : `Connected to ${app.connection.workspace} since ${since ?? ''}. People can mention Kithena or message it directly to ask a question.`
      }
      actions={
        <span className="flex items-center gap-3">
          <Badge tone={app.connection === null ? 'neutral' : 'success'}>
            {app.connection === null ? 'Not connected' : 'Connected'}
          </Badge>
          {app.connection === null ? (
            <Button
              variant="primary"
              disabled={!app.canConnect}
              loading={busy}
              loadingLabel="Opening"
              startIcon={mark === null ? undefined : <AppMark app={mark} tone="mono" />}
              onClick={() => {
                void connect();
              }}
            >
              Add to {app.name}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" loading={busy} loadingLabel="Disconnecting">
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Disconnect {app.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Kithena leaves {app.connection.workspace}. Nobody can ask it questions there, and
                  notices go by email only. Buttons on messages already sent stop working. You can
                  connect it again at any time.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button>Keep it connected</Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setBusy(true);
                        setProblem(null);
                        void onDisconnect(app.key).then((outcome) => {
                          setBusy(false);
                          if (!outcome.ok) setProblem(outcome.message);
                        });
                      }}
                    >
                      Disconnect
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </span>
      }
    >
      {problem === null ? null : <Alert tone="danger" title={problem} />}
    </PageSection>
  );
}

function Notices({
  notices,
  connected,
  onNotice,
}: {
  readonly notices: readonly ChatNoticeView[];
  readonly connected: readonly string[];
  readonly onNotice: ChatAppsProps['onNotice'];
}): JSX.Element {
  const [on, setOn] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(notices.map((n) => [n.key, n.on])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const count = [...on.values()].filter(Boolean).length;

  const toggle = async (key: string, next: boolean): Promise<void> => {
    setBusy(key);
    setProblem(null);
    setOn((m) => new Map(m).set(key, next));
    const outcome = await onNotice(key, next);
    setBusy(null);
    if (!outcome.ok) {
      setOn((m) => new Map(m).set(key, !next));
      setProblem(outcome.message);
    }
  };

  return (
    <PageSection
      surface
      title="Notices"
      description={
        connected.length === 0
          ? 'Choose what People sends to chat. Nothing is sent until a chat app is connected; email carries on as it does now.'
          : `${String(count)} of ${String(notices.length)} sent to ${connected.join(' and ')}, as well as by email. Each goes to the person it is for, as a direct message.`
      }
    >
      <Stack gap={4}>
        {problem === null ? null : <Alert tone="danger" title={problem} />}
        <ul className="flex flex-col divide-y divide-border">
          {notices.map((n) => (
            <li key={n.key} className="py-3 first:pt-0 last:pb-0">
              <Field orientation="horizontal" className="items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <FieldLabel>{n.label}</FieldLabel>
                  <FieldDescription>{n.description}</FieldDescription>
                  <span className="flex flex-wrap gap-1.5 pt-1">
                    <Badge tone="neutral">To: {n.to}</Badge>
                    {n.action === null ? null : <Badge tone="info">In chat: {n.action}</Badge>}
                  </span>
                </div>
                <FieldControl>
                  <Switch
                    checked={on.get(n.key) === true}
                    disabled={busy === n.key}
                    onCheckedChange={(next) => {
                      void toggle(n.key, next);
                    }}
                  />
                </FieldControl>
              </Field>
            </li>
          ))}
        </ul>
      </Stack>
    </PageSection>
  );
}

function Answers({
  fields,
  fieldsHref,
}: {
  readonly fields: ChatAppsState['fields'];
  readonly fieldsHref: string;
}): JSX.Element {
  const shown = fields.on.slice(0, 12);
  const more = fields.on.length - shown.length;
  return (
    <PageSection
      surface
      title="What the assistant can answer"
      description={`${String(fields.on.length)} of ${String(fields.shareable)} fields that may be shared are. The assistant learns a field’s name and options, never anybody’s value, and answers each person only with what they could see in Kithena.`}
      actions={
        <Button asChild variant="secondary">
          <a href={fieldsHref}>Choose fields</a>
        </Button>
      }
    >
      {fields.on.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No field is shared yet, so the assistant can only say who is who. Choose fields in
          Employee fields, under Assistant.
        </p>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {shown.map((f) => (
            <Badge key={f.key} tone="neutral">
              {f.label}
            </Badge>
          ))}
          {more > 0 ? <Badge tone="neutral">and {String(more)} more</Badge> : null}
        </span>
      )}
    </PageSection>
  );
}
