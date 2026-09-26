import {
  Alert,
  AutoGrid,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Stack,
  Stat,
  type IsoDate,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import type { Outcome } from '../load';
import type { PublishPreview } from './model';

/**
 * The change markers, each a glyph and a word (§9.3, screen 4).
 *
 * The glyph is the scan, the word is the meaning, and the tone is the least of
 * the three: colour alone never tells an added field from an archived one.
 */
const MARKER = {
  added: { glyph: '+', word: 'Added', tone: 'success' },
  tightened: { glyph: '~', word: 'Tightened', tone: 'warning' },
  loosened: { glyph: '~', word: 'Loosened', tone: 'info' },
  // Who may read it, or the conditions it is required under (PEO-065, PEO-066).
  changed: { glyph: '~', word: 'Changed', tone: 'warning' },
  archived: { glyph: '−', word: 'Archived', tone: 'neutral' },
} as const;

export interface PublishDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Today in the tenant's calendar, the earliest `requiredFrom` there is. */
  readonly today: IsoDate;
  /** The diff and the impact for a candidate `requiredFrom`. */
  readonly preview: (requiredFrom: IsoDate) => Promise<PublishPreview>;
  readonly onPublish: (requiredFrom: IsoDate) => Promise<Outcome>;
}

type Previewed =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly preview: PublishPreview };

/**
 * Publishing, after seeing what it does (PRD §9.3, §8.4).
 *
 * Publishing never blocks anybody, so the only protection against a
 * Friday-afternoon mistake is seeing the consequence first. The numbers are
 * re-asked for whenever `requiredFrom` moves, because moving it is the lever an
 * admin pulls when the numbers are bad.
 */
export function PublishDialog({
  open,
  onOpenChange,
  today,
  preview,
  onPublish,
}: PublishDialogProps): JSX.Element {
  const [requiredFrom, setRequiredFrom] = useState<IsoDate>(today);
  const [previewed, setPreviewed] = useState<Previewed>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    if (!open) return;
    const question = ++asked.current;
    setPreviewed({ status: 'loading' });
    preview(requiredFrom).then(
      (answer) => {
        if (question === asked.current) setPreviewed({ status: 'ready', preview: answer });
      },
      () => {
        if (question === asked.current) setPreviewed({ status: 'error' });
      },
    );
  }, [open, requiredFrom, preview, attempt]);

  const publish = async (): Promise<void> => {
    setPublishing(true);
    setRefused(null);
    const outcome = await onPublish(requiredFrom);
    setPublishing(false);
    if (outcome.ok) onOpenChange(false);
    else setRefused(outcome.message);
  };

  const ready = previewed.status === 'ready' ? previewed.preview : null;
  const version = ready === null ? '' : ` version ${String(ready.nextVersion)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish{version}</DialogTitle>
          <DialogDescription>
            Takes effect immediately for everyone. Nothing already saved is changed or lost.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {previewed.status === 'loading' ? (
            <Spinner label="Working out what this changes" />
          ) : previewed.status === 'error' ? (
            <Alert
              tone="danger"
              title="Could not work out what this changes"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
              }
            >
              Nothing has been published.
            </Alert>
          ) : previewed.preview.unchanged ? (
            <Alert tone="info" title="Nothing to publish">
              The draft is the same as the published version.
            </Alert>
          ) : (
            <Stack gap={5}>
              <section aria-labelledby="publish-changes">
                <h3 id="publish-changes" className="mb-2 text-sm font-semibold">
                  Changes
                </h3>
                <ul className="flex flex-col gap-2">
                  {previewed.preview.changes.map((change) => {
                    const marker = MARKER[change.kind];
                    return (
                      <li
                        key={`${change.kind}:${change.key}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <Badge tone={marker.tone} size="sm">
                          <span aria-hidden>{marker.glyph}</span> {marker.word}
                        </Badge>
                        <span className="min-w-0 flex-1">{change.summary}</span>
                        {change.specialCategory ? (
                          <Badge tone="danger" size="sm">
                            Special category
                          </Badge>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section aria-labelledby="publish-impact">
                <h3 id="publish-impact" className="mb-2 text-sm font-semibold">
                  Impact on {previewed.preview.impact.evaluated} people
                </h3>
                <AutoGrid minItemWidth="9rem" gap={3}>
                  <Stat
                    label="Become incomplete"
                    value={previewed.preview.impact.becomingIncomplete}
                  />
                  <Stat
                    label="For employees to fill"
                    value={previewed.preview.impact.forEmployees}
                  />
                  <Stat label="For you to fill" value={previewed.preview.impact.forStaff} />
                  <Stat
                    label="Integrations notified"
                    value={previewed.preview.integrationsNotified}
                  />
                </AutoGrid>
              </section>

              {previewed.preview.impact.becomingComplete > 0 ? (
                <Alert tone="success">
                  {previewed.preview.impact.becomingComplete} people who are incomplete today will
                  be complete.
                </Alert>
              ) : null}
              {previewed.preview.impact.forEmployees > 0 ? (
                <Alert tone="info">
                  Employees with something to fill in get one reminder email, never more than one a
                  week however many fields they are missing. What is yours to fill arrives as a
                  single grid.
                </Alert>
              ) : null}
            </Stack>
          )}

          <div className="mt-5">
            <DatePicker
              label="Required from"
              value={requiredFrom}
              min={today}
              onChange={(next) => {
                if (next !== null) setRequiredFrom(next);
              }}
            />
            <p className="mt-1 text-xs text-fg-muted">
              Records completed before this date are not counted as incomplete.
            </p>
          </div>

          {refused === null ? null : (
            <Alert tone="danger" title="Not published" className="mt-4">
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={publishing}
            loadingLabel="Publishing"
            disabled={ready === null || ready.unchanged}
            onClick={() => {
              void publish();
            }}
          >
            Publish{version}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
