import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Toggle } from '../settings/shared';

/**
 * Nudging people to rest (T28, PRD §14.2): one click from the insight to a
 * personal message each, written for the person with dates that work for
 * them and **never anybody else's data**. What it includes is the address
 * (`balance`, `bridge`, `losing`), so the preview is Time Off's, exactly as
 * it would be sent. Sent through messaging now; each person once a day.
 *
 * Their managers are not written to: a manager's message would carry other
 * people's figures, which a nudge never does. They see who it is on
 * Insights, signed in.
 */

export interface NudgeInclude {
  readonly balance: boolean;
  readonly bridge: boolean;
  readonly losing: boolean;
}

export interface NudgeData {
  readonly include: NudgeInclude;
  readonly since: string | null;
  readonly recipients: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly reachable: boolean;
  }[];
  readonly preview: {
    readonly personId: string;
    readonly displayName: string;
    readonly heading: string;
    readonly lede: string;
  } | null;
}

type Sent =
  | {
      readonly ok: true;
      readonly sent: number;
      readonly unreachable: number;
      readonly failed: number;
    }
  | { readonly ok: false; readonly message: string };

export interface NudgeProps {
  readonly nudge: NudgeData;
  readonly onAsk: ((patch: Readonly<Record<string, string | null>>) => void) | undefined;
  readonly onSend: ((include: NudgeInclude) => Promise<Sent>) | undefined;
  readonly onClose: () => void;
}

const people = (n: number): string => (n === 1 ? '1 person' : `${String(n)} people`);

export function Nudge({ nudge, onAsk, onSend, onClose }: NudgeProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Sent | null>(null);
  const n = nudge.recipients.length;
  const unreachable = nudge.recipients.filter((r) => !r.reachable).length;
  const include = nudge.include;
  const flip = (key: keyof NudgeInclude, on: boolean): void => {
    setResult(null);
    onAsk?.({ [key]: on ? '1' : '0' });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{`Nudge ${people(n)} to take a break`}</DialogTitle>
          <DialogDescription>
            Each message is written for its person, with their own numbers and nobody else’s.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="@container/nudge">
          <div className="flex flex-col gap-5 @min-[40rem]/nudge:grid @min-[40rem]/nudge:grid-cols-[16rem_minmax(0,1fr)]">
            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Include</legend>
              <Toggle
                kind="checkbox"
                label="Their own balance"
                checked={include.balance}
                onChange={(on) => {
                  flip('balance', on);
                }}
              />
              <Toggle
                kind="checkbox"
                label="A bridge day for them"
                description="A day that joins a holiday where they work to a weekend"
                checked={include.bridge}
                onChange={(on) => {
                  flip('bridge', on);
                }}
              />
              <Toggle
                kind="checkbox"
                label="Days they’ll lose at the year end"
                checked={include.losing}
                onChange={(on) => {
                  flip('losing', on);
                }}
              />
              <Alert
                tone="info"
                icon={<icons.sensitive aria-hidden />}
                title="Personal, not public"
              >
                Each person only sees their own numbers. Their managers are not written to.
              </Alert>
            </fieldset>
            {nudge.preview === null ? (
              <p className="text-sm text-fg-muted">Nobody to nudge right now.</p>
            ) : (
              <Card padded>
                <div className="flex flex-col gap-2.5">
                  <span className="text-xs text-fg-muted">{`Preview for ${nudge.preview.displayName}`}</span>
                  <p className="font-semibold">{nudge.preview.heading}</p>
                  <p className="text-sm text-fg-muted">{nudge.preview.lede}</p>
                </div>
              </Card>
            )}
          </div>
        </DialogBody>
        {result === null ? null : result.ok ? (
          <Alert tone="success" title={`Sent to ${people(result.sent)}`}>
            {[
              result.unreachable === 0
                ? null
                : `${people(result.unreachable)} ${result.unreachable === 1 ? 'has' : 'have'} no work email Time Off knows.`,
              result.failed === 0 ? null : `${String(result.failed)} could not be sent; try again.`,
            ]
              .filter(Boolean)
              .join(' ') || 'Each sees only their own numbers.'}
          </Alert>
        ) : (
          <Alert tone="danger" title="Not sent">
            {result.message}
          </Alert>
        )}
        <DialogFooter>
          <p className="mr-auto text-sm text-fg-muted">
            {unreachable === 0
              ? 'Written per person from Time Off’s numbers.'
              : `${people(unreachable)} without a work email won’t get one.`}
          </p>
          <Button onClick={onClose}>{result?.ok === true ? 'Done' : 'Cancel'}</Button>
          {onSend === undefined || result?.ok === true ? null : (
            <Button
              variant="primary"
              startIcon={<icons.send aria-hidden />}
              disabled={n === unreachable}
              loading={busy}
              loadingLabel="Sending"
              onClick={() => {
                setBusy(true);
                void onSend(include).then((sent) => {
                  setBusy(false);
                  setResult(sent);
                });
              }}
            >
              Send now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
