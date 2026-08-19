'use client';

import { CharacterCount, Placeholder } from '@tiptap/extensions';
import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Input } from '../input/input';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';

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

const defaultToolbar: readonly RichTextGroup[] = [
  'history',
  'inline',
  'headings',
  'lists',
  'blocks',
  'link',
];

interface ToolbarButton {
  id: string;
  label: string;
  icon: ReactNode;
  run: (editor: Editor) => void;
  active?: (editor: Editor) => boolean;
  enabled?: (editor: Editor) => boolean;
}

const groups: Record<RichTextGroup, ToolbarButton[]> = {
  history: [
    {
      id: 'undo',
      label: 'Undo',
      icon: <Undo2 />,
      run: (editor) => editor.chain().focus().undo().run(),
      enabled: (editor) => editor.can().undo(),
    },
    {
      id: 'redo',
      label: 'Redo',
      icon: <Redo2 />,
      run: (editor) => editor.chain().focus().redo().run(),
      enabled: (editor) => editor.can().redo(),
    },
  ],
  inline: [
    {
      id: 'bold',
      label: 'Bold',
      icon: <Bold />,
      run: (editor) => editor.chain().focus().toggleBold().run(),
      active: (editor) => editor.isActive('bold'),
    },
    {
      id: 'italic',
      label: 'Italic',
      icon: <Italic />,
      run: (editor) => editor.chain().focus().toggleItalic().run(),
      active: (editor) => editor.isActive('italic'),
    },
    {
      id: 'underline',
      label: 'Underline',
      icon: <UnderlineIcon />,
      run: (editor) => editor.chain().focus().toggleUnderline().run(),
      active: (editor) => editor.isActive('underline'),
    },
    {
      id: 'strike',
      label: 'Strikethrough',
      icon: <Strikethrough />,
      run: (editor) => editor.chain().focus().toggleStrike().run(),
      active: (editor) => editor.isActive('strike'),
    },
    {
      id: 'code',
      label: 'Inline code',
      icon: <Code />,
      run: (editor) => editor.chain().focus().toggleCode().run(),
      active: (editor) => editor.isActive('code'),
    },
  ],
  headings: [
    {
      id: 'h2',
      label: 'Heading 2',
      icon: <Heading2 />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: (editor) => editor.isActive('heading', { level: 2 }),
    },
    {
      id: 'h3',
      label: 'Heading 3',
      icon: <Heading3 />,
      run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: (editor) => editor.isActive('heading', { level: 3 }),
    },
  ],
  lists: [
    {
      id: 'bullet',
      label: 'Bulleted list',
      icon: <List />,
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
      active: (editor) => editor.isActive('bulletList'),
    },
    {
      id: 'ordered',
      label: 'Numbered list',
      icon: <ListOrdered />,
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
      active: (editor) => editor.isActive('orderedList'),
    },
  ],
  blocks: [
    {
      id: 'quote',
      label: 'Quote',
      icon: <Quote />,
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
      active: (editor) => editor.isActive('blockquote'),
    },
    {
      id: 'rule',
      label: 'Horizontal rule',
      icon: <Minus />,
      run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
  ],
  align: [
    {
      id: 'align-left',
      label: 'Align left',
      icon: <AlignLeft />,
      run: (editor) => editor.chain().focus().setTextAlign('left').run(),
      active: (editor) => editor.isActive({ textAlign: 'left' }),
    },
    {
      id: 'align-center',
      label: 'Align centre',
      icon: <AlignCenter />,
      run: (editor) => editor.chain().focus().setTextAlign('center').run(),
      active: (editor) => editor.isActive({ textAlign: 'center' }),
    },
    {
      id: 'align-right',
      label: 'Align right',
      icon: <AlignRight />,
      run: (editor) => editor.chain().focus().setTextAlign('right').run(),
      active: (editor) => editor.isActive({ textAlign: 'right' }),
    },
  ],
  // Rendered by the component rather than from this table: adding a link needs
  // a URL, which needs a popover, which is not a single toggle.
  link: [],
};

export function RichTextEditor({
  value = '',
  onChange,
  onChangeJson,
  label,
  'aria-labelledby': ariaLabelledBy,
  hint,
  placeholder = 'Write something…',
  toolbar = defaultToolbar,
  characterLimit,
  showCount = false,
  readOnly = false,
  disabled = false,
  invalid = false,
  minHeight = '10rem',
  maxHeight,
  stickyToolbar = false,
  extensions = [],
  className,
  onBlur,
}: RichTextEditorProps): JSX.Element {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;

  const editor = useEditor({
    // SSR: ProseMirror measures the DOM, so it must not run during the server
    // render. Tiptap 3 requires this to be explicit rather than guessing.
    immediatelyRender: false,
    editable: !readOnly && !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          // A link in an employee-authored document is untrusted input.
          // `rel` is what stops a target window reaching back into this one.
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      ...(characterLimit === undefined
        ? [CharacterCount]
        : [CharacterCount.configure({ limit: characterLimit })]),
      ...extensions,
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getHTML());
      onChangeJson?.(instance.getJSON());
    },
    onBlur: () => {
      onBlur?.();
    },
    editorProps: {
      attributes: {
        // ProseMirror supplies `role="textbox"` and `aria-multiline`; the name
        // and the descriptions are ours.
        'aria-labelledby': ariaLabelledBy ?? (label ? labelId : ''),
        'aria-describedby': [hint ? hintId : '', characterLimit || showCount ? countId : '']
          .filter(Boolean)
          .join(' '),
        'aria-invalid': invalid ? 'true' : 'false',
        // Turning off `contenteditable` makes the region uneditable without
        // announcing anything, so somebody arriving here by keyboard finds a
        // textbox that silently refuses to take text. This is the state that
        // says why.
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        class: 'reach-prose focus-visible:outline-none',
      },
    },
  });

  // `editable` is a setting on the instance, not a prop, so a change to
  // `readOnly` after mount has to be pushed in.
  useEffect(() => {
    editor?.setEditable(!readOnly && !disabled);
  }, [editor, readOnly, disabled]);

  /*
   * No cast: `@tiptap/extensions` augments Tiptap's `Storage` interface with
   * `characterCount`, so the type is already correct and the old assertion was
   * re-describing, slightly differently, a shape the library had declared. The
   * extension is registered unconditionally above, both branches of the
   * `characterLimit` ternary include it, so the entry is always present.
   */
  const used = editor?.storage.characterCount.characters() ?? 0;
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
          className={cn('text-sm leading-none font-medium text-fg', disabled && 'text-fg-disabled')}
          // Clicking the label focuses the editable region. `htmlFor` cannot be
          // used: the target is a contenteditable div, not a form control.
          onClick={() => editor?.chain().focus().run()}
        >
          {label}
        </label>
      ) : null}

      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      <div
        className={cn(
          'overflow-hidden rounded-md border bg-surface',
          'transition-[border-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
          invalid ? 'border-danger' : 'border-border',
          // The ring goes on the wrapper, not on the editable region, so the
          // toolbar is visibly part of the focused control.
          'focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/30',
          disabled && 'pointer-events-none opacity-55',
        )}
        // Marks the whole group inactive, which is what makes the dimmed label
        // exempt from the contrast minimum rather than merely low-contrast.
        {...(disabled ? { 'aria-disabled': true } : {})}
      >
        {editor && !readOnly && toolbar.length > 0 ? (
          <RichTextToolbar
            editor={editor}
            groups={toolbar}
            sticky={stickyToolbar}
            label={label ? `${label} formatting` : 'Formatting'}
          />
        ) : null}

        <div style={{ minHeight, maxHeight }} className={cn(maxHeight && 'overflow-y-auto')}>
          <EditorContent editor={editor} className="h-full" />
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
            nearLimit ? 'font-medium text-warning-fg' : 'text-fg-subtle',
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

function RichTextToolbar({
  editor,
  groups: names,
  sticky,
  label,
}: {
  editor: Editor;
  groups: readonly RichTextGroup[];
  sticky: boolean;
  label: string;
}): JSX.Element {
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const buttons = names.flatMap((name) => groups[name]);
  const hasLink = names.includes('link');
  const total = buttons.length + (hasLink ? 2 : 0);

  /**
   * Roving tabindex: the toolbar is one tab stop and the arrow keys move
   * inside it. This is the ARIA toolbar pattern, and it is the difference
   * between reaching the text in one Tab and reaching it in fifteen.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();

      const next =
        event.key === 'ArrowRight'
          ? (focusIndex + 1) % total
          : event.key === 'ArrowLeft'
            ? (focusIndex - 1 + total) % total
            : event.key === 'Home'
              ? 0
              : total - 1;

      setFocusIndex(next);
      const nodes =
        containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]');
      nodes?.[next]?.focus();
    },
    [focusIndex, total],
  );

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn(
        'flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-sunken p-1',
        sticky && 'sticky top-0 z-10',
      )}
    >
      {buttons.map((button, index) => {
        const active = button.active?.(editor) ?? false;
        return (
          <button
            key={button.id}
            type="button"
            data-toolbar-item
            aria-label={button.label}
            aria-pressed={button.active ? active : undefined}
            disabled={button.enabled ? !button.enabled(editor) : false}
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => {
              setFocusIndex(index);
            }}
            onClick={() => {
              button.run(editor);
            }}
            className={cn(
              'grid size-8 place-items-center rounded-sm text-fg-muted',
              'transition-[background-color,color] duration-(--animate-duration-fast) ease-standard',
              'hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
              'disabled:pointer-events-none disabled:opacity-40',
              active && 'bg-accent-subtle text-accent-fg',
              '[&_svg]:size-4',
            )}
          >
            {button.icon}
          </button>
        );
      })}

      {hasLink ? (
        <LinkControls
          editor={editor}
          startIndex={buttons.length}
          focusIndex={focusIndex}
          onFocusIndex={setFocusIndex}
        />
      ) : null}
    </div>
  );
}

function LinkControls({
  editor,
  startIndex,
  focusIndex,
  onFocusIndex,
}: {
  editor: Editor;
  startIndex: number;
  focusIndex: number;
  onFocusIndex: (index: number) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const active = editor.isActive('link');

  const apply = (): void => {
    const trimmed = href.trim();
    if (trimmed === '') return;
    // Everything else (`javascript:`, `data:`) is dropped rather than
    // sanitised, because a "cleaned" scheme is still a scheme someone chose.
    const safe = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    setHref('');
    setOpen(false);
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            // `getAttributes` returns `Record<string, any>`, so the value
            // arrives as `any` and a cast only renames it. A runtime check is
            // what actually establishes the type.
            const existing: unknown = editor.getAttributes('link')['href'];
            setHref(typeof existing === 'string' ? existing : '');
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-toolbar-item
            aria-label="Add or edit link"
            aria-pressed={active}
            tabIndex={startIndex === focusIndex ? 0 : -1}
            onFocus={() => {
              onFocusIndex(startIndex);
            }}
            className={cn(
              'grid size-8 place-items-center rounded-sm text-fg-muted',
              'transition-[background-color,color] duration-(--animate-duration-fast)',
              'hover:bg-surface-hover hover:text-fg',
              'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
              active && 'bg-accent-subtle text-accent-fg',
              '[&_svg]:size-4',
            )}
          >
            <Link2 />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`${String(startIndex)}-link`} className="text-sm font-medium text-fg">
              Link address
            </label>
            <Input
              id={`${String(startIndex)}-link`}
              size="sm"
              value={href}
              placeholder="example.com"
              onChange={(event) => {
                setHref(event.target.value);
              }}
            />
            <p className="text-xs text-fg-muted">
              Opens in a new tab, with <code className="font-mono">rel=&quot;noopener&quot;</code>.
            </p>
            <Button type="submit" size="sm" variant="primary">
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        data-toolbar-item
        aria-label="Remove link"
        disabled={!active}
        tabIndex={startIndex + 1 === focusIndex ? 0 : -1}
        onFocus={() => {
          onFocusIndex(startIndex + 1);
        }}
        onClick={() => {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
        }}
        className={cn(
          'grid size-8 place-items-center rounded-sm text-fg-muted',
          'transition-[background-color,color] duration-(--animate-duration-fast)',
          'hover:bg-surface-hover hover:text-fg',
          'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
          'disabled:pointer-events-none disabled:opacity-40',
          '[&_svg]:size-4',
        )}
      >
        <Link2Off />
      </button>
    </>
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
