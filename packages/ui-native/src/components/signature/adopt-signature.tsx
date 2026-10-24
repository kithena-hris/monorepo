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
import { Field, FieldDescription, FieldLabel } from '../field/field.tsx';
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
import { t } from '../../lib/i18n';

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
  title = t('components.signature.adopt-signature.adopt_your_signature', 'Adopt your signature'),
  action = t('components.signature.adopt-signature.adopt', 'Adopt'),
  note = t(
    'components.signature.adopt-signature.by_adopting_it_you_agree_this',
    'By adopting it, you agree this electronic signature is the legal equivalent of your handwritten one.',
  ),
}: {
  readonly open: boolean;
  /** Their legal name: what a typed signature says. Empty when nobody knows it yet. */
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
  // A signature is the legal name: given one, it is shown and cannot be changed.
  const locked = name.trim() !== '';
  const [how, setHow] = useState<'type' | 'draw'>(value?.kind === 'drawn' ? 'draw' : 'type');
  const [typed, setTyped] = useState(locked || value?.kind !== 'typed' ? name : value.text);
  const [style, setStyle] = useState<SignatureStyle>(
    value?.kind === 'typed' ? (value.style ?? 'flowing') : 'flowing',
  );
  const [path, setPath] = useState(value?.kind === 'drawn' ? value.path : '');
  useEffect(() => {
    if (!open) return;
    setHow(value?.kind === 'drawn' ? 'draw' : 'type');
    setTyped(locked || value?.kind !== 'typed' ? name : value.text);
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
          <DialogDescription>
            {t(
              'components.signature.adopt-signature.choose_how_it_looks_or_draw',
              'Choose how it looks, or draw it.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SegmentedControl
            fullWidth
            value={how}
            accessibilityLabel={t(
              'components.signature.adopt-signature.how_you_sign',
              'How you sign',
            )}
            onValueChange={(v) => {
              setHow(v === 'draw' ? 'draw' : 'type');
            }}
          >
            <SegmentedControlItem value="type">
              {t('components.signature.adopt-signature.choose_a_style', 'Choose a style')}
            </SegmentedControlItem>
            <SegmentedControlItem value="draw">
              {t('components.signature.adopt-signature.draw', 'Draw')}
            </SegmentedControlItem>
          </SegmentedControl>
          {how === 'type' ? (
            <>
              <Field disabled={locked}>
                <FieldLabel>
                  {t('components.signature.adopt-signature.your_legal_name', 'Your legal name')}
                </FieldLabel>
                <Input value={typed} maxLength={120} readOnly={locked} onChange={setTyped} />
                {locked ? (
                  <FieldDescription>
                    {t(
                      'components.signature.adopt-signature.a_signature_is_your_legal_first',
                      'A signature is your legal first and last name, as your company keeps them.',
                    )}
                  </FieldDescription>
                ) : null}
              </Field>
              <RadioGroup
                accessibilityLabel={t('components.signature.adopt-signature.style', 'Style')}
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
                          label={t(
                            'components.signature.adopt-signature.in_the_style',
                            '{{shown}}, in the {{toLowerCase}} style',
                            { shown, toLowerCase: SIGNATURE_STYLE_LABEL[k].toLowerCase() },
                          )}
                        />
                      </View>
                    </View>
                  </RadioCard>
                ))}
              </RadioGroup>
            </>
          ) : (
            <SignaturePad
              label={t(
                'components.signature.adopt-signature.draw_your_signature',
                'Draw your signature',
              )}
              value={path}
              onValueChange={setPath}
            />
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
            {t('components.signature.adopt-signature.cancel', 'Cancel')}
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
          <CssText className="text-subhead text-fg-muted">
            {t('components.signature.adopt-signature.no_signature_yet', 'No signature yet')}
          </CssText>
        ) : (
          <Signature
            value={value}
            label={t('components.signature.adopt-signature.signature', '{{value}}: signature', {
              value: name || label,
            })}
          />
        )}
      </View>
      <Button
        size="sm"
        className="self-start"
        disabled={disabled}
        accessibilityLabel={
          value === null
            ? t(
                'components.signature.adopt-signature.adopt_a_signature',
                'Adopt a signature, {{label}}',
                { label },
              )
            : t('components.signature.adopt-signature.change_it', 'Change it, {{label}}', { label })
        }
        onPress={() => {
          setOpen(true);
        }}
      >
        {value === null
          ? t('components.signature.adopt-signature.adopt_a_signature_2', 'Adopt a signature')
          : t('components.signature.adopt-signature.change_it_2', 'Change it')}
      </Button>
      <AdoptSignatureDialog
        open={open}
        name={name}
        value={value}
        title={
          value === null
            ? t('components.signature.adopt-signature.adopt_your_signature', 'Adopt your signature')
            : t(
                'components.signature.adopt-signature.change_your_signature',
                'Change your signature',
              )
        }
        onOpenChange={setOpen}
        onAdopt={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </View>
  );
}
