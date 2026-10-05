'use client';

import type { UseEditorOptions } from '@tiptap/react';
import { useId, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { fieldHintClass, fieldLabelClass } from '../field/field-styles';

/*
 * What the rich text field and its editor share: the props, and the field
 * drawn around the editable region. Its own module so the editor's chunk and
 * `rich-text.tsx`, which loads it, both import it without importing each
 * other.
 */

export type RichTextGroup =
  'history' | 'inline' | 'headings' | 'lists' | 'blocks' | 'align' | 'link';

export interface RichTextEditorProps {
  /** HTML. Uncontrolled after mount: see `onChange`. */
  value?: string;
  /**
   * Fires with HTML on every change. Debounce it before writing: this runs on
   * every keystroke, and a mutation per character is a mutation per character.
   */
  onChange?: (html: string) => void;
  /** Also fires with the ProseMirror JSON, which is what you want to store. */
  onChangeJson?: (json: Record<string, unknown>) => void;
  /** Visible label. One of this or `aria-labelledby` is required. */
  label?: string;
  'aria-labelledby'?: string;
  /** Help text under the label. */
  hint?: ReactNode;
  placeholder?: string;
  /** Which toolbar groups to render, in order. `[]` hides the toolbar entirely. */
  toolbar?: readonly RichTextGroup[];
  /** Hard limit. The counter turns red as it approaches and the editor stops accepting input at it. */
  characterLimit?: number;
  /** Shows the counter even without a limit. */
  showCount?: boolean;
  /** Read-only rendering: no toolbar, no caret, content still selectable and copyable. */
  readOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Minimum height of the editable area. */
  minHeight?: string;
  /** Maximum height before the content scrolls, keeping the toolbar in view. */
  maxHeight?: string;
  /** Keeps the toolbar visible while a long document scrolls. */
  stickyToolbar?: boolean;
  /** Escape hatch for extra Tiptap extensions: mentions, tables, an emoji picker. */
  extensions?: UseEditorOptions['extensions'];
  className?: string;
  /** Called when the editor gains or loses focus, for a form's touched state. */
  onBlur?: () => void;
}

/**
 * The field around the editable region: label, hint, the box and the counter.
 * The editor fills `controls` (its toolbar) and `editable`; without them it
 * is the field as it stands before ProseMirror has mounted.
 */
export function RichTextFrame({
  label,
  'aria-labelledby': ariaLabelledBy,
  hint,
  characterLimit,
  showCount = false,
  readOnly = false,
  disabled = false,
  invalid = false,
  minHeight = '10rem',
  maxHeight,
  className,
  used,
  ids,
  onLabelClick,
  controls,
  editable,
}: RichTextEditorProps & {
  readonly used: number;
  /** The label's, the hint's and the counter's ids, which the editable region points at. */
  readonly ids?: { readonly label: string; readonly hint: string; readonly count: string };
  readonly onLabelClick?: () => void;
  readonly controls?: ReactNode;
  readonly editable?: ReactNode;
}): JSX.Element {
  const id = useId();
  const {
    label: labelId,
    hint: hintId,
    count: countId,
  } = ids ?? {
    label: `${id}-label`,
    hint: `${id}-hint`,
    count: `${id}-count`,
  };
  const nearLimit = characterLimit !== undefined && used >= characterLimit * 0.9;
  return (
    <div
      // The label, the hint, the editor and the counter are one control, so the
      // group is what goes inactive. `role="group"` is what makes
      // `aria-disabled` legal on a container rather than an invented attribute.
      role="group"
      aria-labelledby={ariaLabelledBy ?? (label ? labelId : undefined)}
      {...(disabled ? { 'aria-disabled': true } : {})}
      className={cn('flex flex-col gap-1.5', className)}
    >
      {label ? (
        <label
          id={labelId}
          className={cn(fieldLabelClass, disabled && 'text-fg-disabled')}
          // Clicking the label focuses the editable region. `htmlFor` cannot be
          // used: the target is a contenteditable div, not a form control.
          onClick={onLabelClick}
        >
          {label}
        </label>
      ) : null}

      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}

      <div
        className={cn(
          // Filled like every field. The ring goes on the wrapper, not on the
          // editable region, so the toolbar is visibly part of the control.
          'overflow-hidden rounded-md bg-surface-sunken touch:rounded-[1.125rem]',
          'transition-[background-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
          'focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent focus-within:ring-inset',
          invalid && 'ring-2 ring-danger ring-inset focus-within:ring-danger',
          readOnly && 'bg-transparent ring-1 ring-border ring-inset',
          disabled && 'pointer-events-none opacity-50',
        )}
        // Marks the whole group inactive, which is what makes the dimmed label
        // exempt from the contrast minimum rather than merely low-contrast.
        {...(disabled ? { 'aria-disabled': true } : {})}
      >
        {controls}

        <div style={{ minHeight, maxHeight }} className={cn(maxHeight && 'overflow-y-auto')}>
          {editable}
        </div>
      </div>

      {characterLimit !== undefined || showCount ? (
        <p
          id={countId}
          // Polite and only near the limit: announcing a count on every
          // keystroke makes the editor unusable with a screen reader.
          aria-live={nearLimit ? 'polite' : 'off'}
          className={cn(
            'self-end text-xs tabular-nums',
            nearLimit ? 'font-medium text-warning-fg' : 'text-fg-muted',
            characterLimit !== undefined && used >= characterLimit && 'text-danger-fg',
          )}
        >
          {characterLimit === undefined
            ? `${String(used)} characters`
            : `${String(used)} / ${String(characterLimit)}`}
        </p>
      ) : null}
    </div>
  );
}
