import { useRef, useState } from 'react';
import type { TextInput as RNTextInput, TextInputKeyPressEvent } from 'react-native';
import { Pressable, Text as CssText, TextInput, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Chip } from '../chip/chip.tsx';
import { useField } from '../field/field.tsx';
import { fieldText } from '../input/input.tsx';

/**
 * A free list of short values: skills, email addresses, locations.
 *
 * The web's contract, under a thumb. Return, or a comma or semicolon from the
 * keyboard, adds what was typed; a paste splits on them and on new lines, so a
 * column out of a spreadsheet arrives as tags. Backspace in an empty field
 * selects the last tag, and a second Backspace removes it, so one stray press
 * never costs someone the address typed a minute ago. Each tag has its own
 * remove button naming what it removes.
 *
 * A refused value is reported, never dropped in silence: a duplicate lights
 * the tag it repeats, and `validate` says what is wrong in words. Tags are
 * drawn as text, so markup in one is shown, not run.
 */

export type TagsInputProps = {
  value: readonly string[];
  onChange: (value: readonly string[]) => void;
  /** The field's name. A `Field`'s label wins, and then this draws nothing. */
  label: string;
  hideLabel?: boolean;
  /** Under the field until something goes wrong. */
  hint?: string;
  placeholder?: string;
  max?: number;
  /** Why a value cannot be a tag, or `null`. */
  validate?: (value: string) => string | null;
  /** Tidies a value before it is checked: trimmed by default. */
  transform?: (value: string) => string;
  /** `sm` 44pt; `md` 56. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  invalid?: boolean;
  className?: string | undefined;
};

export function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

const SPLIT = /[,;\n\t]+/;

export function TagsInput({
  value,
  onChange,
  label,
  hideLabel = false,
  hint,
  placeholder = 'Add a tag',
  max,
  validate,
  transform = (input) => input.trim(),
  size = 'md',
  disabled: disabledProp,
  invalid: invalidProp,
  className,
}: TagsInputProps): React.JSX.Element {
  const field = useField();
  const disabled = disabledProp ?? field?.disabled ?? false;
  const input = useRef<RNTextInput>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [repeated, setRepeated] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const full = max !== undefined && value.length >= max;
  // A value handed in that `validate` would refuse stays, marked, so an
  // imported list shows what needs fixing instead of quietly losing it.
  const failures = value.map((tag) => validate?.(tag) ?? null);
  const failing = failures.find((f) => f !== null) ?? null;
  const invalid = invalidProp ?? field?.invalid ?? Boolean(error ?? failing);
  const name = field?.parts.label ?? label;

  /** Adds each value it can, in order; returns what it could not take. */
  const add = (raws: readonly string[]): string => {
    const next = [...value];
    const refused: string[] = [];
    let problem: string | null = null;
    let duplicate: string | null = null;
    for (const raw of raws) {
      const candidate = transform(raw);
      if (candidate === '') continue;
      if (max !== undefined && next.length >= max) {
        problem ??= `At most ${String(max)} allowed.`;
        refused.push(candidate);
      } else if (next.includes(candidate)) {
        problem ??= `${candidate} is already on the list.`;
        duplicate = candidate;
      } else {
        const failure = validate?.(candidate) ?? null;
        if (failure) {
          problem ??= failure;
          refused.push(candidate);
        } else next.push(candidate);
      }
    }
    setError(problem);
    setRepeated(duplicate);
    if (next.length !== value.length) {
      onChange(next);
      const added = next.slice(value.length);
      setSaid(`${added.join(', ')} added. ${String(next.length)} in total.`);
    } else if (problem) setSaid(problem);
    return refused.join(', ');
  };

  const remove = (index: number): void => {
    const gone = value[index] ?? 'Tag';
    onChange(value.filter((_, i) => i !== index));
    setSaid(`${gone} removed. ${String(value.length - 1)} remaining.`);
    setSelected(null);
    setRepeated(null);
    input.current?.focus();
  };

  const onKeyPress = (event: TextInputKeyPressEvent): void => {
    const key = event.nativeEvent.key;
    if (key === 'Backspace' && draft === '') {
      if (selected !== null) remove(selected);
      else if (value.length) setSelected(value.length - 1);
      return;
    }
    if (key === 'ArrowLeft' && draft === '' && value.length) {
      setSelected(selected === null ? value.length - 1 : Math.max(0, selected - 1));
      return;
    }
    if (key === 'ArrowRight' && selected !== null) {
      setSelected(selected >= value.length - 1 ? null : selected + 1);
      return;
    }
    setSelected(null);
  };

  const problem = error ?? failing;
  const messageTone = problem ? 'text-danger-fg' : 'text-fg-muted';
  const message = problem ?? hint;

  return (
    <View className={cn('gap-1.5', className)}>
      {hideLabel || field?.parts.label ? null : (
        <CssText aria-hidden className="text-subhead font-semibold text-fg">
          {label}
        </CssText>
      )}
      <Pressable
        // A press anywhere on the box, between the tags, goes to the field.
        accessible={false}
        onPress={() => input.current?.focus()}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={cn(
          'flex-row flex-wrap items-center gap-1.5 rounded-[16px] px-2 py-1.5',
          size === 'sm' ? 'min-h-11' : 'min-h-m-field',
          focused ? 'bg-surface' : 'bg-surface-sunken',
          disabled && 'opacity-50',
        )}
      >
        {value.map((tag, index) => (
          <Chip
            key={tag}
            selected={index === selected || tag === repeated}
            invalid={failures[index] !== null}
            {...(failures[index] ? { accessibilityLabel: `${tag}, ${failures[index]}` } : {})}
            {...(disabled
              ? {}
              : {
                  onRemove: () => {
                    remove(index);
                  },
                })}
            removeLabel={`Remove ${tag}`}
          >
            {tag}
          </Chip>
        ))}
        {full ? null : (
          <TextInput
            ref={input}
            value={draft}
            editable={!disabled}
            placeholder={placeholder}
            accessibilityLabel={`${name}, add a tag`}
            {...(message ? { accessibilityHint: message } : {})}
            aria-invalid={invalid || undefined}
            autoCapitalize="none"
            autoCorrect={false}
            enterKeyHint="done"
            submitBehavior="submit"
            onChangeText={(text) => {
              setSelected(null);
              if (!SPLIT.test(text)) {
                setDraft(text);
                return;
              }
              // A comma typed or a list pasted: everything before the last
              // separator becomes tags; what follows it is still being typed.
              const parts = text.split(SPLIT);
              const rest = parts.pop() ?? '';
              const refused = add(parts);
              setDraft(refused ? `${refused}${rest}` : rest);
            }}
            onSubmitEditing={() => {
              const refused = add([draft]);
              setDraft(refused);
            }}
            onKeyPress={onKeyPress}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
              setSelected(null);
            }}
            className={cn(fieldText, 'min-w-20 flex-1 px-1 py-1.5')}
          />
        )}
        {focused || invalid ? (
          <View
            style={{ pointerEvents: 'none' }}
            className={cn(
              'absolute inset-0 rounded-[16px] border-2',
              focused ? 'border-accent' : 'border-danger',
            )}
          />
        ) : null}
      </Pressable>
      {message ? (
        <CssText className={cn('text-subhead leading-[1.4]', messageTone)}>{message}</CssText>
      ) : null}
      {/* Heard as tags come and go; never drawn. */}
      <View className="absolute h-px w-px overflow-hidden opacity-0">
        <CssText accessibilityLiveRegion="polite" aria-live="polite">
          {said}
        </CssText>
      </View>
    </View>
  );
}
