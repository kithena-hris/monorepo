'use client';

import { useEffect, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { RadioCard, RadioGroup } from '../radio-group/radio-group';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control';
import { SignaturePad } from '../signature-pad/signature-pad';
import {
  SIGNATURE_STYLE_LABEL,
  Signature,
  type SignatureStyle,
  type SignatureValue,
} from './signature';

/**
 * Adopting a signature, as DocuSign asks for one: the person's name already
 * typed and shown in each handwriting face to choose from, or drawn.
 *
 * The same dialog wherever a signature is adopted — signing a document, or
 * keeping one on a profile — so a person meets one way of doing it.
 */
export function AdoptSignatureDialog({
  open,
  name,
  value = null,
  onOpenChange,
  onAdopt,
  title = 'Adopt your signature',
  action = 'Adopt',
  note = 'By adopting it, you agree this electronic signature is the legal equivalent of your handwritten one.',
}: {
  readonly open: boolean;
  /** Their name, to start from. */
  readonly name: string;
  /** The one they have, to start from when they change it. */
  readonly value?: SignatureValue | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdopt: (value: SignatureValue) => void;
  readonly title?: string;
  /** The button: "Adopt and sign" where adopting also signs. */
  readonly action?: string;
  readonly note?: string;
}): JSX.Element {
  const [how, setHow] = useState<'type' | 'draw'>(value?.kind === 'drawn' ? 'draw' : 'type');
  const [typed, setTyped] = useState(value?.kind === 'typed' ? value.text : name);
  const [style, setStyle] = useState<SignatureStyle>(
    value?.kind === 'typed' ? (value.style ?? 'flowing') : 'flowing',
  );
  const [path, setPath] = useState(value?.kind === 'drawn' ? value.path : '');
  useEffect(() => {
    if (!open) return;
    setHow(value?.kind === 'drawn' ? 'draw' : 'type');
    setTyped(value?.kind === 'typed' ? value.text : name);
    setStyle(value?.kind === 'typed' ? (value.style ?? 'flowing') : 'flowing');
    setPath(value?.kind === 'drawn' ? value.path : '');
  }, [open, name, value]);
  const shown = typed.trim() || name;
  const ready = how === 'type' ? typed.trim() !== '' : path.trim() !== '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose how it looks, or draw it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="How you sign"
            fullWidth
            value={how}
            onValueChange={(v) => {
              setHow(v === 'draw' ? 'draw' : 'type');
            }}
          >
            <SegmentedControlItem value="type">Choose a style</SegmentedControlItem>
            <SegmentedControlItem value="draw">Draw</SegmentedControlItem>
          </SegmentedControl>
          {how === 'type' ? (
            <>
              <Field>
                <FieldLabel>Your name</FieldLabel>
                <FieldControl>
                  <Input
                    value={typed}
                    maxLength={120}
                    onChange={(e) => {
                      setTyped(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
              <RadioGroup
                aria-label="Style"
                value={style}
                onValueChange={(v) => {
                  setStyle(v as SignatureStyle);
                }}
                className="grid gap-2"
              >
                {(Object.keys(SIGNATURE_STYLE_LABEL) as SignatureStyle[]).map((k) => (
                  <RadioCard
                    key={k}
                    value={k}
                    description={
                      <span className="block h-14 w-full">
                        <Signature
                          value={{ kind: 'typed', text: shown, style: k }}
                          label={`${shown}, in the ${SIGNATURE_STYLE_LABEL[k].toLowerCase()} style`}
                        />
                      </span>
                    }
                  >
                    {SIGNATURE_STYLE_LABEL[k]}
                  </RadioCard>
                ))}
              </RadioGroup>
            </>
          ) : (
            <SignaturePad label="Draw your signature" value={path} onValueChange={setPath} />
          )}
          <p className="text-xs text-fg-muted">{note}</p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => {
              onAdopt(
                how === 'type'
                  ? { kind: 'typed', text: typed.trim(), style }
                  : { kind: 'drawn', path: path.trim() },
              );
            }}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A signature as a field's value: what is kept, and a button to adopt one or
 * change it. Inside a `Field`, its label names the button.
 */
export function SignatureInput({
  value,
  name,
  onChange,
  disabled = false,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  readonly value: SignatureValue | null;
  /** Their name, typed in for them when they adopt one. */
  readonly name: string;
  readonly onChange: (value: SignatureValue | null) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly id?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          'h-20 rounded-md bg-surface-sunken',
          invalid === true && 'ring-2 ring-danger ring-inset',
        )}
      >
        {value === null ? (
          <p className="grid size-full place-items-center text-sm text-fg-muted">
            No signature yet
          </p>
        ) : (
          <Signature value={value} label={`${name}’s signature`} />
        )}
      </div>
      <Button
        {...(id === undefined ? {} : { id })}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {value === null ? 'Adopt a signature' : 'Change it'}
      </Button>
      <AdoptSignatureDialog
        open={open}
        name={name}
        value={value}
        title={value === null ? 'Adopt your signature' : 'Change your signature'}
        onOpenChange={setOpen}
        onAdopt={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </div>
  );
}
