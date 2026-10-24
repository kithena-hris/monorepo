import {
  AdoptSignatureDialog,
  allRequiredFilled,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldLabel,
  formatList,
  icons,
  Input,
  isFilled,
  nextToFill,
  PdfPages,
  PinnedBar,
  PlacementLayer,
  readingOrder,
  Signature,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { EnvelopeData, FieldKind, Mark } from '../types';

export type { EnvelopeData, Mark };
import { KIND_LABEL, toneOf } from './prepare';
import { t } from '../i18n';

/**
 * K4–K6 as DocuSign does it: the signer's own boxes on the document itself,
 * and nothing of anybody else's. A bar pinned under the document says where
 * they are — "Step 2 of 3 · Dated signature" — and holds the one thing to do
 * next: Start, Sign, Next, and Finish once every box is filled. Pressing a box
 * fills it too — a signature with the one they adopted, a dated signature
 * with it and the day, a name with their legal name (already there).
 */

type EnvelopeField = EnvelopeData['fields'][number];

/** The boxes a signature fills: a dated signature is one, with the day under it. */
export const SIGNED: ReadonlySet<FieldKind> = new Set(['signature', 'initials', 'date']);

/** "Lahari", "Lahari and Omar", "Lahari, Omar and Ada". */
const andList = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : formatList(names);

/** What a signer is told at Finish (K7): where it went next, and that their copy is on its way. */
export function doneMessage(completed: boolean, next: readonly string[]): string {
  if (completed) {
    return t(
      'envelopes.sign-view.everybody_has_signed_the_sealed_copy',
      'Everybody has signed. The sealed copy, with its certificate of completion, is on its way to your email.',
    );
  }
  return next.length === 0
    ? t(
        'envelopes.sign-view.your_signature_is_in_your_copy',
        'Your signature is in. Your copy is on its way to your email.',
      )
    : t(
        'envelopes.sign-view.sent_to_for_their_signature_your',
        'Sent to {{andList}} for their signature. Your copy, as signed so far, is on its way to your email.',
        { andList: andList(next) },
      );
}

export interface Signing {
  readonly mine: readonly EnvelopeField[];
  /** The boxes walked through, in reading order: every box but a name, which fills itself. */
  readonly steps: readonly EnvelopeField[];
  readonly mark: Mark | null;
  /** What each box holds so far, by its id: "signed" for a signature applied. */
  readonly filled: Readonly<Record<string, string>>;
  readonly focus: string | null;
  /** The next box still to fill, in page order; null when every one is. */
  readonly next: EnvelopeField | null;
  /** Every box that must be filled is. */
  readonly ready: boolean;
  readonly adopting: boolean;
  readonly setAdopting: (open: boolean) => void;
  readonly adopt: (mark: Mark) => void;
  /** Fill a box: a signature needs one adopted first, and asks for it. */
  readonly apply: (id: string) => void;
  readonly setText: (id: string, text: string) => void;
  /** To the next box still to fill. */
  readonly goNext: () => void;
  /** Values as the server takes them: typed text and ticks; signatures and dates it fills. */
  readonly values: Readonly<Record<string, string>>;
  /** The box asking for something: a signature to adopt, or text to type. */
  readonly waiting: string | null;
  /** The signer's own day, sent with the signature for the date boxes. */
  readonly day: string;
  /**
   * This signing's Signature ID (K7): printed under each box the moment it
   * is filled, and sent with the signature, which keeps it as the signed
   * event's id. What the screen shows is what the sealed file says.
   */
  readonly traceId: string;
}

/**
 * The document as this signer just signed it, drawn over the copy on screen
 * until the copy Kithena drew has loaded in its place: their signature in
 * every box, each with its print under it, the moment Finish succeeds.
 */
export interface Stamped {
  readonly signerId: string;
  readonly mark: Mark;
  readonly filled: Readonly<Record<string, string>>;
  readonly traceId: string;
  readonly at: Date;
}

/**
 * The page at the screen's own width, never left zoomed: iOS keeps a zoom
 * across loads (the reload after Finish among them), so a document opened
 * from a link could arrive magnified. Snapped back by pinning the scale for
 * a frame, then the viewport as it was, so pinching to read stays possible.
 */
function fitToScreen(): void {
  if (typeof window === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta === null || (window.visualViewport?.scale ?? 1) === 1) return;
  const was = meta.content;
  meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
  requestAnimationFrame(() => {
    meta.content = was;
  });
}

const MONTHS = () => [
  t('envelopes.sign-view.jan', 'Jan'),
  t('envelopes.sign-view.feb', 'Feb'),
  t('envelopes.sign-view.mar', 'Mar'),
  t('envelopes.sign-view.apr', 'Apr'),
  t('envelopes.sign-view.may', 'May'),
  t('envelopes.sign-view.jun', 'Jun'),
  t('envelopes.sign-view.jul', 'Jul'),
  t('envelopes.sign-view.aug', 'Aug'),
  t('envelopes.sign-view.sep', 'Sep'),
  t('envelopes.sign-view.oct', 'Oct'),
  t('envelopes.sign-view.nov', 'Nov'),
  t('envelopes.sign-view.dec', 'Dec'),
];

/**
 * The print under a signed box, worded and timed as the sealed file prints
 * it (`services/documents`, `traceLines`): signed electronically, when, in
 * UTC, then the Signature ID.
 */
export function traceCaption(traceId: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = t(
    'envelopes.sign-view.utc',
    '{{getUTCDate}} {{value}} {{getUTCFullYear}}, {{pad}}:{{pad2}} UTC',
    {
      getUTCDate: String(at.getUTCDate()),
      value: MONTHS().at(at.getUTCMonth()) ?? '',
      getUTCFullYear: String(at.getUTCFullYear()),
      pad: pad(at.getUTCHours()),
      pad2: pad(at.getUTCMinutes()),
    },
  );
  return t(
    'envelopes.sign-view.electronically_signed_via_kithena_on_signature',
    'Electronically signed via Kithena on {{when}}\nSignature ID: {{traceId}}',
    { when, traceId },
  );
}

/**
 * Today on the signer's own calendar, as their device has it: what a date box
 * shows and what the server records, within a day of its clock. Not UTC, which
 * is yesterday or tomorrow for much of the world around midnight.
 */
const today = (): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

/** What a box holds once a signature is applied to it: a dated one holds the day. */
const signedValue = (f: EnvelopeField): string => (f.kind === 'date' ? today() : 'signed');

export function useSigning(
  env: EnvelopeData,
  /** Their legal first and last name: what a name box and a typed signature say. */
  name: string,
  /** Told of a signature adopted here, to keep it where People keeps one. */
  onAdopted?: (mark: Mark) => void,
): Signing {
  const me = env.me?.signerId ?? '';
  const mine = env.fields.filter((f) => f.signerId === me).toSorted(readingOrder);
  // The one on file signs at once; adopting is for whoever has none.
  const [mark, setMark] = useState<Mark | null>(env.signature?.mark ?? null);
  // A name box is theirs already: filled with their legal name, never a step.
  const [filled, setFilled] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(mine.filter((f) => f.kind === 'name').map((f) => [f.id, name])),
  );
  const [focus, setFocus] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [traceId] = useState(() => crypto.randomUUID());
  const [waiting, setWaiting] = useState<string | null>(null);

  // Reach's model of which box is due, the phone's too: an optional tick box is never a step.
  const optional = (f: EnvelopeField) => f.kind === 'checkbox';
  const next = nextToFill(mine, filled, optional);
  const ready = allRequiredFilled(mine, filled);
  const steps = mine.filter((f) => f.kind !== 'name' && (f.required || !optional(f)));

  const fill = (f: EnvelopeField, m: Mark | null) => {
    switch (f.kind) {
      case 'signature':
      case 'initials':
      case 'date':
        if (m === null) {
          setWaiting(f.id);
          setAdopting(true);
          return;
        }
        setFilled((was) => ({ ...was, [f.id]: signedValue(f) }));
        return;
      case 'name':
        setFilled((was) => ({ ...was, [f.id]: name }));
        return;
      case 'checkbox':
        setFilled((was) => ({ ...was, [f.id]: was[f.id] === 'true' ? 'false' : 'true' }));
        return;
      case 'text':
      case 'title':
        setWaiting(f.id);
        return;
    }
  };

  const values = Object.fromEntries(
    mine.flatMap((f) =>
      f.kind === 'text' || f.kind === 'title' || f.kind === 'checkbox'
        ? [[f.id, filled[f.id] ?? '']]
        : [],
    ),
  );

  return {
    traceId,
    mine,
    steps,
    mark,
    filled,
    focus,
    next,
    ready,
    adopting,
    setAdopting: (open) => {
      setAdopting(open);
      if (!open) setWaiting((w) => (mine.find((f) => f.id === w)?.kind === 'text' ? w : null));
    },
    adopt: (m) => {
      setMark(m);
      setAdopting(false);
      if (env.signature?.canKeep === true) onAdopted?.(m);
      // The box that asked for it gets it at once.
      const asked = mine.find((f) => f.id === waiting);
      if (asked !== undefined) setFilled((was) => ({ ...was, [asked.id]: signedValue(asked) }));
      setWaiting(null);
    },
    apply: (id) => {
      const f = mine.find((x) => x.id === id);
      if (f === undefined) return;
      setFocus(id);
      fill(f, mark);
    },
    setText: (id, text) => {
      setFilled((was) => ({ ...was, [id]: text }));
      setWaiting(null);
    },
    goNext: () => {
      if (next !== null) setFocus(next.id);
    },
    values,
    waiting,
    day: today(),
  };
}

/** What pressing the focused box does, said on the bar's main button. */
const ACT = (): Readonly<Record<FieldKind, string>> => ({
  get signature(): string {
    return t('envelopes.sign-view.sign', 'Sign');
  },
  get initials(): string {
    return t('envelopes.sign-view.initial', 'Initial');
  },
  get date(): string {
    return t('envelopes.sign-view.sign_and_date', 'Sign and date');
  },
  name: t('envelopes.sign-view.add_your_name', 'Add your name'),
  get title(): string {
    return t('envelopes.sign-view.type_it', 'Type it');
  },
  get text(): string {
    return t('envelopes.sign-view.type_it', 'Type it');
  },
  get checkbox(): string {
    return t('envelopes.sign-view.tick', 'Tick');
  },
});

export function DocumentToSign({
  env,
  url,
  signing,
  name,
  onFinish,
  finishing = false,
  stamped = null,
}: {
  readonly env: EnvelopeData;
  readonly url: string;
  /** Null for a viewer who is not signing now: the sender, or a signer whose turn it is not. */
  readonly signing: Signing | null;
  readonly name: string;
  /** Sign: shown on the bar, in Next's place, once every box is filled. */
  readonly onFinish?: () => void;
  readonly finishing?: boolean;
  /**
   * What this signer just signed, drawn over the copy on screen until the
   * copy Kithena drew (`url`, fetched again) has loaded in its place.
   */
  readonly stamped?: Stamped | null;
}): JSX.Element {
  const order = new Map(env.signers.map((s, i) => [s.id, i]));
  const waiting = signing === null ? null : signing.waiting;
  const typing = signing?.mine.find(
    (f) => f.id === waiting && (f.kind === 'text' || f.kind === 'title'),
  );
  const [text, setText] = useState('');
  // The bar waits for the pages: Start before them would have nowhere to go.
  const [shown, setShown] = useState(false);
  // A signed field is drawn into the copy shown (K7), its trace under it:
  // nothing is laid over it. A sealed copy carries every stamp.
  const signedBy = new Set(env.signers.filter((s) => s.status === 'signed').map((s) => s.id));
  // The copy on screen when Finish succeeded: what was just signed is drawn
  // over it until the copy Kithena drew has loaded in its place.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [stampedOver, setStampedOver] = useState<string | null>(null);
  if (stamped !== null && stampedOver === null) setStampedOver(loaded ?? url);
  if (stamped === null && stampedOver !== null) setStampedOver(null);
  const showStamped = stamped !== null && (loaded === null || loaded === (stampedOver ?? url));
  // Whatever is being filled or was just filled: its boxes, values, mark and print.
  const live =
    signing !== null
      ? {
          fields: signing.mine,
          filled: signing.filled,
          mark: signing.mark,
          traceId: signing.traceId,
          at: new Date(),
        }
      : stamped !== null && showStamped
        ? {
            fields: env.fields.filter((f) => f.signerId === stamped.signerId),
            filled: stamped.filled,
            mark: stamped.mark as Mark | null,
            traceId: stamped.traceId,
            at: stamped.at,
          }
        : null;
  const others = env.fields.filter(
    (f) => !signedBy.has(f.signerId) && f.signerId !== stamped?.signerId,
  );
  const boxes =
    signing !== null
      ? signing.mine
      : env.status === 'completed'
        ? (live?.fields ?? [])
        : [...others, ...(live?.fields ?? [])];

  // Every document, the first and each one drawn after Finish, opens fitted to the screen.
  useEffect(() => {
    fitToScreen();
  }, [url]);

  return (
    // A double tap on the page fills a box; it never zooms the page.
    <div className="flex touch-manipulation flex-col gap-3">
      {/* The reader scrolls in a box of its own, the window's height at most,
          so the step bar and everything after the document stay in reach. */}
      <PdfPages
        src={url}
        label={env.title}
        className="max-h-[80dvh] overflow-y-auto overscroll-y-contain rounded-md bg-surface-sunken p-3"
        onLoad={() => {
          setShown(true);
          setLoaded(url);
        }}
        overlay={(page) => (
          <PlacementLayer
            focus={signing?.focus ?? null}
            boxes={boxes
              .filter((f) => f.page === page.number)
              .map((f) => {
                const done = isFilled(live?.filled[f.id]) && live?.fields.includes(f) === true;
                return {
                  id: f.id,
                  x: f.x,
                  y: f.y,
                  w: f.w,
                  h: f.h,
                  tone: toneOf(order.get(f.signerId) ?? 0),
                  label: done
                    ? t('envelopes.sign-view.filled', '{{KIND_LABEL}}, filled', {
                        KIND_LABEL: KIND_LABEL[f.kind],
                      })
                    : `${f.label ?? KIND_LABEL[f.kind]}${f.required ? '' : t('envelopes.sign-view.optional', ', optional')}`,
                  hint:
                    signing === null
                      ? (env.signers.find((s) => s.id === f.signerId)?.name ?? '')
                      : HINT()[f.kind],
                  done,
                  // Printed the moment it is filled, as the sealed file prints it.
                  ...(live === null || !done
                    ? {}
                    : { caption: traceCaption(live.traceId, live.at) }),
                };
              })}
            {...(signing === null ? {} : { onActivate: signing.apply })}
            render={(box) => {
              if (live === null || box.done !== true) return null;
              const f = live.fields.find((x) => x.id === box.id);
              const value = live.filled[box.id] ?? '';
              if (f === undefined) return null;
              // Paper ink, from the box: the page is white in either theme.
              if (SIGNED.has(f.kind) && live.mark !== null) {
                const mark = (
                  <Signature
                    value={live.mark}
                    initials={f.kind === 'initials'}
                    label={
                      f.kind === 'initials'
                        ? t('envelopes.sign-view.persons_initials', '{{name}}’s initials', { name })
                        : t('envelopes.sign-view.persons_signature', '{{name}}’s signature', {
                            name,
                          })
                    }
                  />
                );
                // Framed as the sealed file stamps it: a thin rule, "Signed by"
                // and the name along the top, the ink under, the day under
                // that on a dated one; the print follows under the box.
                return (
                  <span className="grid size-full grid-rows-[auto_minmax(0,1fr)_auto] rounded-[2px] bg-white/80 ring-1 ring-[var(--reach-neutral-400)]">
                    <span
                      className="truncate px-0.5 text-left text-[max(6px,0.75cqw)] leading-none text-[var(--reach-neutral-600)]"
                      aria-hidden
                    >
                      {t('envelopes.sign-view.signed_by', 'Signed by')} {name}
                    </span>
                    {mark}
                    {f.kind === 'date' ? (
                      <span className="truncate px-1 text-center text-2xs font-normal">
                        {value}
                      </span>
                    ) : (
                      <span />
                    )}
                  </span>
                );
              }
              return (
                <span className="truncate px-1 text-xs font-normal">
                  {f.kind === 'checkbox' ? '✓' : value}
                </span>
              );
            }}
          />
        )}
      />
      {signing === null || !shown ? null : (
        <StepBar signing={signing} onFinish={onFinish} finishing={finishing} />
      )}
      <Dialog
        open={typing !== undefined}
        onOpenChange={(open) => {
          if (!open && typing !== undefined)
            signing?.setText(typing.id, signing.filled[typing.id] ?? '');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typing?.label ?? KIND_LABEL[typing?.kind ?? 'text']}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel>{typing?.label ?? KIND_LABEL[typing?.kind ?? 'text']}</FieldLabel>
              <FieldControl>
                <Input
                  value={text}
                  maxLength={200}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="primary"
              disabled={text.trim() === ''}
              onClick={() => {
                if (typing !== undefined) signing?.setText(typing.id, text.trim());
                setText('');
              }}
            >
              {t('envelopes.sign-view.apply', 'Apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Where the signer is, pinned under the document wherever they scroll, and
 * the one thing to do next: Start, the focused box's own action, Next, then
 * Finish in Next's place.
 */
function StepBar({
  signing,
  onFinish,
  finishing,
}: {
  readonly signing: Signing;
  readonly onFinish: (() => void) | undefined;
  readonly finishing: boolean;
}): JSX.Element {
  const { steps, focus, filled, ready, mark } = signing;
  const at = steps.findIndex((f) => f.id === focus);
  const focused = at === -1 ? undefined : steps[at];
  const total = steps.length;
  const place = t(
    'envelopes.sign-view.text',
    { one: '{{count}} place', other: '{{count}} places' },
    { count: total },
  );
  // How far through they are, said and drawn on the bar: "1 of 4 done".
  const doneCount = steps.filter((f) => isFilled(filled[f.id])).length;
  const progress = { value: doneCount, max: total };
  const count = t('envelopes.sign-view.of_done', '{{doneCount}} of {{total}} done', {
    doneCount: String(doneCount),
    total: String(total),
  });
  if (ready && onFinish !== undefined) {
    return (
      <PinnedBar
        message={t(
          'envelopes.sign-view.all_done_finish_to_sign',
          'All {{total}} done. Finish to sign.',
          { total: String(total) },
        )}
        progress={progress}
      >
        <Button
          size="sm"
          variant="primary"
          loading={finishing}
          endIcon={<icons.success aria-hidden />}
          onClick={onFinish}
        >
          {t('envelopes.sign-view.finish', 'Finish')}
        </Button>
      </PinnedBar>
    );
  }
  if (focused === undefined) {
    return (
      <PinnedBar
        message={t(
          'envelopes.sign-view.for_you_to_fill_in_start',
          '{{place}} for you to fill in. Start takes you to each one.',
          { place },
        )}
        progress={progress}
      >
        <Button
          size="sm"
          variant="primary"
          endIcon={<icons.forward aria-hidden />}
          onClick={signing.goNext}
        >
          {t('envelopes.sign-view.start', 'Start')}
        </Button>
      </PinnedBar>
    );
  }
  const step = t('envelopes.sign-view.step_of', 'Step {{value}} of {{total}} · {{value2}}', {
    value: String(at + 1),
    total: String(total),
    value2: focused.label ?? KIND_LABEL[focused.kind],
  });
  if (!isFilled(filled[focused.id])) {
    return (
      <PinnedBar
        message={t('envelopes.sign-view.text_2', '{{step}} · {{count}}', { step, count })}
        progress={progress}
      >
        {focused.required ? null : (
          <Button size="sm" variant="on-invert" onClick={signing.goNext}>
            {t('envelopes.sign-view.skip', 'Skip')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          startIcon={<icons.edit aria-hidden />}
          onClick={() => {
            signing.apply(focused.id);
          }}
        >
          {SIGNED.has(focused.kind) && mark === null
            ? t('envelopes.sign-view.adopt_and_sign', 'Adopt and sign')
            : ACT()[focused.kind]}
        </Button>
      </PinnedBar>
    );
  }
  return (
    <PinnedBar
      message={t('envelopes.sign-view.text_2', '{{step}} · {{count}}', { step, count })}
      progress={progress}
    >
      <Button
        size="sm"
        variant="primary"
        endIcon={<icons.forward aria-hidden />}
        onClick={signing.goNext}
      >
        {t('envelopes.sign-view.next', 'Next')}
      </Button>
    </PinnedBar>
  );
}

const HINT = (): Readonly<Record<FieldKind, string>> => ({
  get signature(): string {
    return t('envelopes.sign-view.sign', 'Sign');
  },
  get initials(): string {
    return t('envelopes.sign-view.initial', 'Initial');
  },
  get date(): string {
    return t('envelopes.sign-view.sign_and_date', 'Sign and date');
  },
  name: t('envelopes.sign-view.name', 'Name'),
  get title(): string {
    return t('envelopes.sign-view.title', 'Title');
  },
  get text(): string {
    return t('envelopes.sign-view.text_3', 'Text');
  },
  checkbox: '',
});

/** K5: Reach's adopt dialog, where adopting also signs the box that asked. */
export function AdoptDialog({
  open,
  name,
  onOpenChange,
  onAdopt,
}: {
  readonly open: boolean;
  readonly name: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdopt: (mark: Mark) => void;
}): JSX.Element {
  return (
    <AdoptSignatureDialog
      open={open}
      name={name}
      action={t('envelopes.sign-view.adopt_and_sign', 'Adopt and sign')}
      onOpenChange={onOpenChange}
      onAdopt={onAdopt}
    />
  );
}
