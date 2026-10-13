import { useEffect, useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Input } from '../input/input.tsx';
import { RadioCard, RadioGroup } from '../radio-group/radio-group.tsx';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control.tsx';
import { SignaturePad } from '../signature-pad/signature-pad.tsx';
import {
  SIGNATURE_STYLE_LABEL,
  Signature,
  type SignatureStyle,
  type SignatureValue,
} from './signature.tsx';

/**
 * Adopting a signature, the web's `AdoptSignatureDialog`: the person's name
 * already typed and shown in each handwriting face to choose from, or drawn
 * with a finger. The same dialog wherever a signature is adopted.
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
}): React.JSX.Element {
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
        <DialogBody>
          <SegmentedControl
            fullWidth
            value={how}
            accessibilityLabel="How you sign"
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
                <Input value={typed} maxLength={120} onChange={setTyped} />
              </Field>
              <RadioGroup
                accessibilityLabel="Style"
                value={style}
                onValueChange={(v) => {
                  setStyle(v as SignatureStyle);
                }}
              >
                {(Object.keys(SIGNATURE_STYLE_LABEL) as SignatureStyle[]).map((k) => (
                  <RadioCard key={k} value={k}>
                    <View className="w-full gap-1">
                      <CssText className="text-subhead text-fg-muted">
                        {SIGNATURE_STYLE_LABEL[k]}
                      </CssText>
                      <View className="h-14 w-full">
                        <Signature
                          value={{ kind: 'typed', text: shown, style: k }}
                          label={`${shown}, in the ${SIGNATURE_STYLE_LABEL[k].toLowerCase()} style`}
                        />
                      </View>
                    </View>
                  </RadioCard>
                ))}
              </RadioGroup>
            </>
          ) : (
            <SignaturePad label="Draw your signature" value={path} onValueChange={setPath} />
          )}
          <CssText className="text-footnote text-fg-muted">{note}</CssText>
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={!ready}
            onPress={() => {
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
 * A signature as a field's value, the web's `SignatureInput`: what is kept,
 * and a button to adopt one or change it.
 */
export function SignatureInput({
  value,
  name,
  label,
  onChange,
  disabled = false,
  invalid = false,
  className,
}: {
  readonly value: SignatureValue | null;
  /** Their name, typed in for them when they adopt one. */
  readonly name: string;
  /** What the field is called: names the button for a screen reader. */
  readonly label: string;
  readonly onChange: (value: SignatureValue | null) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly className?: string | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <View className={cn('gap-2', className)}>
      <View
        className={cn(
          'h-20 items-center justify-center rounded-lg bg-surface-sunken',
          invalid && 'border-2 border-danger',
        )}
      >
        {value === null ? (
          <CssText className="text-subhead text-fg-muted">No signature yet</CssText>
        ) : (
          <Signature value={value} label={`${name || label}: signature`} />
        )}
      </View>
      <Button
        size="sm"
        className="self-start"
        disabled={disabled}
        accessibilityLabel={value === null ? `Adopt a signature, ${label}` : `Change it, ${label}`}
        onPress={() => {
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
    </View>
  );
}
