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
  PlacementLayer,
  Signature,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { EnvelopeData, FieldKind, Mark } from '../types';

export type { EnvelopeData, Mark };
import { KIND_LABEL, toneOf } from './prepare';

/**
 * K4–K6 as DocuSign does it: the signer's own boxes on the document itself,
 * and nothing of anybody else's. "Start", then "Next", takes them to each box
 * in page order; pressing a box, or "Apply", fills it — a signature with the
 * one they adopted, the date with today's, their name with their name. When
 * every box that must be filled is, "Finish" signs.
 */

type EnvelopeField = EnvelopeData['fields'][number];

export interface Signing {
  readonly mine: readonly EnvelopeField[];
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
  readonly goNext: () => void;
  /** Values as the server takes them: typed text and ticks; signatures and dates it fills. */
  readonly values: Readonly<Record<string, string>>;
  /** The box asking for something: a signature to adopt, or text to type. */
  readonly waiting: string | null;
}

const inPageOrder = (a: EnvelopeField, b: EnvelopeField) =>
  a.page - b.page || a.y - b.y || a.x - b.x;

const today = () => new Date().toISOString().slice(0, 10);

export function useSigning(
  env: EnvelopeData,
  name: string,
  /** Told of a signature adopted here, to keep it where People keeps one. */
  onAdopted?: (mark: Mark) => void,
): Signing {
  const me = env.me?.signerId ?? '';
  const mine = env.fields.filter((f) => f.signerId === me).toSorted(inPageOrder);
  // The one on file signs at once; adopting is for whoever has none.
  const [mark, setMark] = useState<Mark | null>(env.signature?.mark ?? null);
  const [filled, setFilled] = useState<Readonly<Record<string, string>>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);

  const done = (f: EnvelopeField) => (filled[f.id] ?? '') !== '' && filled[f.id] !== 'false';
  const next = mine.find((f) => !done(f) && (f.required || f.kind !== 'checkbox')) ?? null;
  const ready = mine.every((f) => !f.required || done(f));

  const fill = (f: EnvelopeField, m: Mark | null) => {
    switch (f.kind) {
      case 'signature':
      case 'initials':
        if (m === null) {
          setWaiting(f.id);
          setAdopting(true);
          return;
        }
        setFilled((was) => ({ ...was, [f.id]: 'signed' }));
        return;
      case 'date':
        setFilled((was) => ({ ...was, [f.id]: today() }));
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
      if (asked !== undefined) setFilled((was) => ({ ...was, [asked.id]: 'signed' }));
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
  };
}

export function DocumentToSign({
  env,
  url,
  signing,
  name,
}: {
  readonly env: EnvelopeData;
  readonly url: string;
  /** Null for a viewer who is not signing now: the sender, or a signer whose turn it is not. */
  readonly signing: Signing | null;
  readonly name: string;
}): JSX.Element {
  const order = new Map(env.signers.map((s, i) => [s.id, i]));
  const waiting = signing === null ? null : signing.waiting;
  const typing = signing?.mine.find(
    (f) => f.id === waiting && (f.kind === 'text' || f.kind === 'title'),
  );
  const [text, setText] = useState('');
  // A sealed copy carries its stamps: nothing is laid over it.
  const boxes = env.status === 'completed' ? [] : signing === null ? env.fields : signing.mine;
  const step = signing === null ? null : signing.ready ? 'finish' : signing.next;

  return (
    <div className="flex flex-col gap-3">
      {signing === null ? null : (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-raised p-2 shadow-md ring-1 ring-border">
          <p className="ps-2 text-sm font-medium" aria-live="polite">
            {signing.ready
              ? 'Every box is filled. Finish to sign.'
              : `${String(signing.mine.filter((f) => signing.filled[f.id] !== undefined && signing.filled[f.id] !== '' && signing.filled[f.id] !== 'false').length)} of ${String(signing.mine.length)} boxes filled`}
          </p>
          <div className="flex gap-2">
            {signing.focus !== null &&
            signing.mine.some(
              (f) =>
                f.id === signing.focus &&
                (f.kind === 'signature' || f.kind === 'initials') &&
                signing.filled[f.id] === undefined,
            ) ? (
              <Button
                variant="primary"
                size="sm"
                startIcon={<icons.edit aria-hidden />}
                onClick={() => {
                  if (signing.focus !== null) signing.apply(signing.focus);
                }}
              >
                {signing.mark === null ? 'Adopt and apply' : 'Apply'}
              </Button>
            ) : null}
            {step === 'finish' || step === null ? null : (
              <Button
                variant={signing.focus === null ? 'primary' : 'secondary'}
                size="sm"
                endIcon={<icons.forward aria-hidden />}
                onClick={signing.goNext}
              >
                {signing.focus === null ? 'Start' : 'Next'}
              </Button>
            )}
          </div>
        </div>
      )}
      <PdfPages
        src={url}
        label={env.title}
        overlay={(page) => (
          <PlacementLayer
            focus={signing?.focus ?? null}
            boxes={boxes
              .filter((f) => f.page === page.number)
              .map((f) => {
                const value = signing?.filled[f.id];
                const done = value !== undefined && value !== '' && value !== 'false';
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
              if ((f.kind === 'signature' || f.kind === 'initials') && signing.mark !== null) {
                return (
                  <Signature
                    value={signing.mark}
                    initials={f.kind === 'initials'}
                    label={`${name}’s ${f.kind === 'initials' ? 'initials' : 'signature'}`}
                  />
                );
              }
              return (
                <span className="truncate px-1 text-xs font-normal text-fg">
                  {f.kind === 'checkbox' ? '✓' : value}
                </span>
              );
            }}
          />
        )}
      />
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

const HINT: Readonly<Record<FieldKind, string>> = {
  signature: 'Sign',
  initials: 'Initial',
  date: 'Date',
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
