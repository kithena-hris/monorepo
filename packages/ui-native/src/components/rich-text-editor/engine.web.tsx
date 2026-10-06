import TextAlign from '@tiptap/extension-text-align';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { View } from 'react-native-css/components';

import { LINK_ATTRIBUTES, type Command, type Engine, type EngineOptions } from './engine-types.ts';

/*
 * The editor on the web (the mobile Storybook, a web build of the app): Tiptap
 * itself, configured exactly as packages/ui's RichTextEditor is, so what it
 * stores is byte for byte what the web editor stores. On a device the same
 * Tiptap runs inside TenTap's web view (`engine.tsx`).
 */

const commands: Record<
  Command,
  { run: (e: Editor) => void; active?: (e: Editor) => boolean; can?: (e: Editor) => boolean }
> = {
  undo: { run: (e) => e.chain().focus().undo().run(), can: (e) => e.can().undo() },
  redo: { run: (e) => e.chain().focus().redo().run(), can: (e) => e.can().redo() },
  bold: { run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  italic: {
    run: (e) => e.chain().focus().toggleItalic().run(),
    active: (e) => e.isActive('italic'),
  },
  underline: {
    run: (e) => e.chain().focus().toggleUnderline().run(),
    active: (e) => e.isActive('underline'),
  },
  strike: {
    run: (e) => e.chain().focus().toggleStrike().run(),
    active: (e) => e.isActive('strike'),
  },
  code: { run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
  h2: {
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  h3: {
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (e) => e.isActive('heading', { level: 3 }),
  },
  bullet: {
    run: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  ordered: {
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  quote: {
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    active: (e) => e.isActive('blockquote'),
  },
  rule: { run: (e) => e.chain().focus().setHorizontalRule().run() },
  'align-left': {
    run: (e) => e.chain().focus().setTextAlign('left').run(),
    active: (e) => e.isActive({ textAlign: 'left' }),
  },
  'align-center': {
    run: (e) => e.chain().focus().setTextAlign('center').run(),
    active: (e) => e.isActive({ textAlign: 'center' }),
  },
  'align-right': {
    run: (e) => e.chain().focus().setTextAlign('right').run(),
    active: (e) => e.isActive({ textAlign: 'right' }),
  },
};

/** The prose inside the box: the design's 17pt at 1.55, lists, quotes and links in tokens. */
const prose = [
  'min-h-full px-3.5 py-3 text-[17px] leading-[1.55] text-fg outline-none',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1.5 [&_ol]:my-1.5',
  '[&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:leading-[1.3] [&_h3]:text-[17px] [&_h3]:font-semibold',
  '[&_blockquote]:border-l-[3px] [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted',
  '[&_a]:text-accent-fg [&_a]:underline [&_code]:rounded-[4px] [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-[15px]',
  '[&_hr]:my-3 [&_hr]:border-border',
  '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0',
  '[&_p.is-editor-empty:first-child]:before:text-fg-subtle [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ');

export function useRichTextEngine(options: EngineOptions): Engine {
  const {
    value,
    onChange,
    placeholder,
    editable,
    characterLimit,
    label,
    hint,
    invalid,
    disabled,
    minHeight,
    onFocusChange,
    onBlur,
  } = options;
  const editor = useEditor({
    immediatelyRender: true,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, HTMLAttributes: { ...LINK_ATTRIBUTES } },
      }),
      Placeholder.configure({ placeholder, showOnlyWhenEditable: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      characterLimit === undefined
        ? CharacterCount
        : CharacterCount.configure({ limit: characterLimit }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      onChange?.(instance.getHTML());
    },
    onFocus: () => {
      onFocusChange(true);
    },
    onBlur: () => {
      onFocusChange(false);
      onBlur?.();
    },
    editorProps: {
      attributes: {
        // Named here, so it must say what it is: ProseMirror's own role is not
        // always on the element, and a name on a plain div is not allowed.
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(hint ? { 'aria-description': hint } : {}),
        'aria-invalid': invalid ? 'true' : 'false',
        ...(disabled ? { 'aria-disabled': 'true' } : {}),
        ...(editable ? {} : { 'aria-readonly': 'true' }),
        class: prose,
      },
    },
  });

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  // Re-render the toolbar as the selection moves, not on every transaction.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: Object.fromEntries(
        (Object.keys(commands) as Command[]).map((c) => [c, commands[c].active?.(e) ?? false]),
      ) as Record<Command, boolean>,
      can: Object.fromEntries(
        (Object.keys(commands) as Command[]).map((c) => [c, commands[c].can?.(e) ?? true]),
      ) as Record<Command, boolean>,
      link: e.isActive('link') ? String(e.getAttributes('link')['href'] ?? '') : null,
      characters: e.storage.characterCount.characters(),
    }),
  });

  return {
    body: (
      <View style={{ minHeight }} className="flex-1">
        <EditorContent editor={editor} className="h-full" />
      </View>
    ),
    isActive: (c) => state.active[c],
    canRun: (c) => state.can[c],
    run: (c) => {
      commands[c].run(editor);
    },
    supports: () => true,
    link: state.link,
    setLink: (href) => {
      if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
      else editor.chain().focus().extendMarkRange('link').unsetLink().run();
    },
    characters: state.characters,
  };
}
