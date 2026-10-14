import {
  AdoptSignatureDialog,
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
  Input,
  PdfPages,
  PinnedBar,
  PlacementLayer,
  Signature,
  icons,
  allRequiredFilled,
  isFilled,
  nextToFill,
  readingOrder,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { EnvelopeData, FieldKind, Mark } from '../types';

export type { EnvelopeData, Mark };
import { KIND_LABEL, toneOf } from './prepare';

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
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;

/** What a signer is told at Finish (K7): where it went next, and that their copy is on its way. */
export function doneMessage(completed: boolean, next: readonly string[]): string {
  if (completed) {
    return 'Everybody has signed. The sealed copy, with its certificate of completion, is on its way to your email.';
  }
  return next.length === 0
    ? 'Your signature is in. Your copy is on its way to your email.'
    : `Sent to ${andList(next)} for their signature. Your copy, as signed so far, is on its way to your email.`;
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
const ACT: Readonly<Record<FieldKind, string>> = {
  signature: 'Sign',
  initials: 'Initial',
  date: 'Sign and date',
  name: 'Add your name',
  title: 'Type it',
  text: 'Type it',
  checkbox: 'Tick',
};

export function DocumentToSign({
  env,
  url,
  signing,
  name,
  onFinish,
  finishing = false,
}: {
  readonly env: EnvelopeData;
  readonly url: string;
  /** Null for a viewer who is not signing now: the sender, or a signer whose turn it is not. */
  readonly signing: Signing | null;
  readonly name: string;
  /** Sign: shown on the bar, in Next's place, once every box is filled. */
  readonly onFinish?: () => void;
  readonly finishing?: boolean;
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
  const boxes =
    env.status === 'completed'
      ? []
      : signing === null
        ? env.fields.filter((f) => !signedBy.has(f.signerId))
        : signing.mine;

  return (
    <div className="flex flex-col gap-3">
      <PdfPages
        src={url}
        label={env.title}
        onLoad={() => {
          setShown(true);
        }}
        overlay={(page) => (
          <PlacementLayer
            focus={signing?.focus ?? null}
            boxes={boxes
              .filter((f) => f.page === page.number)
              .map((f) => {
                const done = isFilled(signing?.filled[f.id]);
                return {
                  id: f.id,
                  x: f.x,
                  y: f.y,
                  w: f.w,
                  h: f.h,
                  tone: toneOf(order.get(f.signerId) ?? 0),
                  label: done
                    ? `${KIND_LABEL[f.kind]}, filled`
                    : `${f.label ?? KIND_LABEL[f.kind]}${f.required ? '' : ', optional'}`,
                  hint:
                    signing === null
                      ? (env.signers.find((s) => s.id === f.signerId)?.name ?? '')
                      : HINT[f.kind],
                  done,
                };
              })}
            {...(signing === null ? {} : { onActivate: signing.apply })}
            render={(box) => {
              if (signing === null || box.done !== true) return null;
              const f = signing.mine.find((x) => x.id === box.id);
              const value = signing.filled[box.id] ?? '';
              if (f === undefined) return null;
              // Paper ink, from the box: the page is white in either theme.
              if (SIGNED.has(f.kind) && signing.mark !== null) {
                const mark = (
                  <Signature
                    value={signing.mark}
                    initials={f.kind === 'initials'}
                    label={`${name}’s ${f.kind === 'initials' ? 'initials' : 'signature'}`}
                  />
                );
                return f.kind === 'date' ? (
                  <span className="grid size-full grid-rows-[minmax(0,1fr)_auto]">
                    {mark}
                    <span className="truncate px-1 text-center text-2xs font-normal">{value}</span>
                  </span>
                ) : (
                  mark
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
              Apply
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
  const place = `${String(total)} ${total === 1 ? 'place' : 'places'}`;
  if (ready && onFinish !== undefined) {
    return (
      <PinnedBar message="Everything is filled in. Finish to sign.">
        <Button
          size="sm"
          variant="primary"
          loading={finishing}
          endIcon={<icons.success aria-hidden />}
          onClick={onFinish}
        >
          Finish
        </Button>
      </PinnedBar>
    );
  }
  if (focused === undefined) {
    return (
      <PinnedBar message={`${place} for you to fill in. Start takes you to each one.`}>
        <Button
          size="sm"
          variant="primary"
          endIcon={<icons.forward aria-hidden />}
          onClick={signing.goNext}
        >
          Start
        </Button>
      </PinnedBar>
    );
  }
  const step = `Step ${String(at + 1)} of ${String(total)} · ${focused.label ?? KIND_LABEL[focused.kind]}`;
  if (!isFilled(filled[focused.id])) {
    return (
      <PinnedBar message={step}>
        {focused.required ? null : (
          <Button size="sm" variant="on-invert" onClick={signing.goNext}>
            Skip
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
          {SIGNED.has(focused.kind) && mark === null ? 'Adopt and sign' : ACT[focused.kind]}
        </Button>
      </PinnedBar>
    );
  }
  return (
    <PinnedBar message={`${step} · done`}>
      <Button
        size="sm"
        variant="primary"
        endIcon={<icons.forward aria-hidden />}
        onClick={signing.goNext}
      >
        Next
      </Button>
    </PinnedBar>
  );
}

const HINT: Readonly<Record<FieldKind, string>> = {
  signature: 'Sign',
  initials: 'Initial',
  date: 'Sign and date',
  name: 'Name',
  title: 'Title',
  text: 'Text',
  checkbox: '',
};

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
      action="Adopt and sign"
      onOpenChange={onOpenChange}
      onAdopt={onAdopt}
    />
  );
}
