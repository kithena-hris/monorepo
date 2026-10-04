'use client';

import type { UseEditorOptions } from '@tiptap/react';
import { lazy, Suspense, useId, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { fieldHintClass, fieldLabelClass } from '../field/field-styles';

/**
 * A rich text field, on Tiptap.
 *
 * ### Why a real editor and not a textarea
 *
 * Three fields in an HRIS genuinely need structure: a job description, a
 * policy document, and a performance review. All three are written once and
 * read hundreds of times, and all three lose meaning as plain text, a list of
 * responsibilities that is not a list is a wall.
 *
 * ### Why Tiptap and not a `contenteditable`
 *
 * `contenteditable` produces whatever markup the browser felt like: Safari
 * emits `<b>`, Chrome emits `<span style>`, a paste from Word emits both plus
 * forty class names. Tiptap sits on ProseMirror, which holds a **schema**,
 * the document can only ever contain nodes you allowed, paste is coerced into
 * that schema, and the output is the same on every browser. For a field whose
 * content is stored, versioned, exported to a PDF and shown to a labour
 * inspector, "the same on every browser" is the requirement.
 *
 * ### Configuration
 *
 * The toolbar is a list of group names, so a comment box gets
 * `['history', 'inline']` and a policy document gets everything. Anything not
 * in the toolbar is also not in the schema where that is possible, so a
 * disabled feature cannot arrive by paste or by keyboard shortcut either.
 *
 * ### Accessibility
 *
 * ProseMirror gives the editable region `role="textbox"` and `aria-multiline`.
 * On top of that this component adds:
 *
 * - a real accessible name, from `label` or `aria-labelledby`;
 * - `aria-describedby` wiring for the hint and the character counter;
 * - a `role="toolbar"` with **roving tabindex**, one tab stop for the whole
 *   toolbar, arrow keys between the buttons. Without it, reaching the editor
 *   from the keyboard means tabbing past fourteen buttons every time;
 * - `aria-pressed` on every format button, so state is announced rather than
 *   only coloured;
 * - the character counter as a polite live region, announced on the way past
 *   the limit rather than on every keystroke.
 *
 * ### Loaded when used
 *
 * Tiptap and ProseMirror are most of this design system's weight, and few
 * screens hold an editor. So the editor is its own chunk, fetched when one
 * renders (or earlier, from `preloadRichTextEditor`, on whatever opens it).
 * Until it arrives the field is drawn as the editor draws itself before
 * ProseMirror mounts, which it never does on the server anyway: the label,
 * the hint, an empty box at its height and the counter. Nothing moves when
 * the editor lands in it.
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

/** Starts fetching the editor, for whatever is about to show one: on hover, on focus. */
export const preloadRichTextEditor = (): Promise<unknown> => import('./rich-text-editor');

const Editor = lazy(() =>
  import('./rich-text-editor').then((m) => ({ default: m.RichTextEditorBody })),
);

export function RichTextEditor(props: RichTextEditorProps): JSX.Element {
  return (
    <Suspense fallback={<RichTextFrame {...props} used={0} />}>
      <Editor {...props} />
    </Suspense>
  );
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
  const { label: labelId, hint: hintId, count: countId } = ids ?? {
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

/**
 * Renders stored rich text for reading.
 *
 * Separate from the editor on purpose: a read-only Tiptap instance still loads
 * ProseMirror, and a job description shown on a careers page has no reason to
 * ship an editor. The markup this renders is the same markup the editor
 * produces, styled by the same `reach-prose` rules.
 *
 * `sanitisedHtml` is inserted directly. It must have been produced by this editor, or
 * sanitised on the server, this component cannot know which, and a sanitiser
 * that runs in the browser is a sanitiser an attacker controls.
 */
/**
 * Markup that no sanitiser would have left behind.
 *
 * This is a tripwire, not a filter. It is deliberately not exhaustive and it is
 * deliberately not a fix: anything it catches means unsanitised input reached
 * this component, and the bug is upstream on the server. Trying to strip these
 * here instead would produce a component that looks safe while an attacker
 * chooses the input to the stripper.
 */
const OBVIOUSLY_UNSANITISED = /<script|\son\w+\s*=|javascript:|<iframe|<object|srcdoc\s*=/i;

export function RichTextContent({
  sanitisedHtml,
  className,
}: {
  /**
   * Markup this editor produced, or markup a server sanitised. The name is the
   * contract: a reviewer reading `sanitisedHtml={x}` at a call site asks
   * whether it is, and `html={x}` gives them nothing to ask about.
   */
  sanitisedHtml: string;
  className?: string;
}): JSX.Element {
  // Not guarded by `NODE_ENV`. This package ships TypeScript source and is
  // compiled by whatever the consuming app uses, and a library that reads
  // `process` is a library that throws "process is not defined" in the one
  // bundler that does not define it. A single regex over a string that is about
  // to be handed to the HTML parser costs nothing next to the parse, and if
  // this ever fires in production it is something the error monitor should see.
  if (OBVIOUSLY_UNSANITISED.test(sanitisedHtml)) {
    console.error(
      'RichTextContent: `sanitisedHtml` contains markup a sanitiser would have removed ' +
        '(a script tag, an inline event handler, a javascript: URL or an embedded frame). ' +
        'This prop is inserted verbatim. Sanitise it on the server.',
    );
  }

  return (
    <div
      className={cn('reach-prose', className)}
      // See the docblock: the caller owns sanitisation, and it has to happen on
      // the server. A sanitiser that runs here is a sanitiser an attacker
      // controls.
      dangerouslySetInnerHTML={{ __html: sanitisedHtml }}
    />
  );
}
