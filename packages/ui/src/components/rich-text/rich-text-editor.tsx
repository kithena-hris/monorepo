'use client';

import { CharacterCount, Placeholder } from '@tiptap/extensions';
import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor, type Editor, type UseEditorOptions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
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
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import {
  Fragment,
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
import { fieldHintClass } from '../field/field-styles';
import { Button } from '../button/button';
import { Input } from '../input/input';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';

import { RichTextFrame, type RichTextEditorProps, type RichTextGroup } from './rich-text';

/*
 * The editor itself, on Tiptap: its own chunk, which `rich-text.tsx` loads
 * when an editor renders. Read that file for why it exists at all.
 */

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
      icon: <TextAlignStart />,
      run: (editor) => editor.chain().focus().setTextAlign('left').run(),
      active: (editor) => editor.isActive({ textAlign: 'left' }),
    },
    {
      id: 'align-center',
      label: 'Align centre',
      icon: <TextAlignCenter />,
      run: (editor) => editor.chain().focus().setTextAlign('center').run(),
      active: (editor) => editor.isActive({ textAlign: 'center' }),
    },
    {
      id: 'align-right',
      label: 'Align right',
      icon: <TextAlignEnd />,
      run: (editor) => editor.chain().focus().setTextAlign('right').run(),
      active: (editor) => editor.isActive({ textAlign: 'right' }),
    },
  ],
  // Rendered by the component rather than from this table: adding a link needs
  // a URL, which needs a popover, which is not a single toggle.
  link: [],
};

export function RichTextEditorBody(props: RichTextEditorProps): JSX.Element {
  const {
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
    stickyToolbar = false,
    extensions = [],
    onBlur,
  } = props;
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
  return (
    <RichTextFrame
      {...props}
      used={used}
      ids={{ label: labelId, hint: hintId, count: countId }}
      onLabelClick={() => editor?.chain().focus().run()}
      controls={
        editor && !readOnly && toolbar.length > 0 ? (
          <RichTextToolbar
            editor={editor}
            groups={toolbar}
            sticky={stickyToolbar}
            label={label ? `${label} formatting` : 'Formatting'}
          />
        ) : null
      }
      editable={<EditorContent editor={editor} className="h-full" />}
    />
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
  // Where each group after the first begins, for the rule drawn between them.
  const groupStarts = new Set<number>();
  names.reduce((start, name) => {
    if (start > 0 && groups[name].length > 0) groupStarts.add(start);
    return start + groups[name].length;
  }, 0);
  const hasLink = names.includes('link');
  const total = buttons.length + (hasLink ? 2 : 0);
  /*
   * The one tab stop has to be a button that can take focus. Undo comes first
   * and is disabled until there is something to undo, and a disabled button
   * cannot be tabbed to, so pointing the stop at it left the whole toolbar
   * unreachable from the keyboard. The first enabled item stands in for it.
   */
  const enabledAt = (index: number): boolean =>
    index >= buttons.length || (buttons[index]?.enabled?.(editor) ?? true);
  const tabStop = enabledAt(focusIndex)
    ? focusIndex
    : (Array.from({ length: total }, (_, index) => index).find(enabledAt) ?? focusIndex);

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
        'flex flex-wrap items-center gap-0.5 p-1.5 shadow-[inset_0_-1px_0_var(--reach-color-border)]',
        // Under a thumb the buttons are at the tap floor, and wrapped they
        // would stack three rows above the text. One row that scrolls.
        'touch:flex-nowrap touch:overflow-x-auto touch:[scrollbar-width:none] touch:[&>*]:shrink-0',
        sticky && 'sticky top-0 z-10 bg-inherit',
      )}
    >
      {buttons.map((button, index) => {
        const active = button.active?.(editor) ?? false;
        return (
          <Fragment key={button.id}>
            {groupStarts.has(index) ? (
              <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
            ) : null}
            <button
              type="button"
              data-toolbar-item
              aria-label={button.label}
              aria-pressed={button.active ? active : undefined}
              disabled={button.enabled ? !button.enabled(editor) : false}
              tabIndex={index === tabStop ? 0 : -1}
              onFocus={() => {
                setFocusIndex(index);
              }}
              onClick={() => {
                button.run(editor);
              }}
              className={cn(
                'grid size-7.5 touch:size-11 place-items-center rounded-[0.5rem] text-fg-muted',
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
          </Fragment>
        );
      })}

      {hasLink && buttons.length > 0 ? (
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
      ) : null}
      {hasLink ? (
        <LinkControls
          editor={editor}
          startIndex={buttons.length}
          focusIndex={tabStop}
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
              'grid size-7.5 touch:size-11 place-items-center rounded-[0.5rem] text-fg-muted',
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
            <p className={fieldHintClass}>
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
          'grid size-7.5 touch:size-11 place-items-center rounded-[0.5rem] text-fg-muted',
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
