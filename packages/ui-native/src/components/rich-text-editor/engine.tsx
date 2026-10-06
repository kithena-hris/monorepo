import {
  BlockquoteBridge,
  BoldBridge,
  BulletListBridge,
  CodeBridge,
  CoreBridge,
  DropCursorBridge,
  HardBreakBridge,
  HeadingBridge,
  HistoryBridge,
  ItalicBridge,
  LinkBridge,
  ListItemBridge,
  OrderedListBridge,
  PlaceholderBridge,
  RichText,
  StrikeBridge,
  UnderlineBridge,
  useBridgeState,
  useEditorBridge,
  useEditorContent,
} from '@10play/tentap-editor';
import { useEffect, useRef, useState } from 'react';
import { useCssElement } from 'react-native-css';
import { View } from 'react-native-css/components';

import { LINK_ATTRIBUTES, type Command, type Engine, type EngineOptions } from './engine-types.ts';
import { textOf } from './text.ts';

/*
 * The editor on a device: TenTap, which runs Tiptap in a web view and bridges
 * its commands and state to React Native. The bridges are the web editor's
 * schema and no more (no task lists, colours, highlights or images, which
 * TenTap's starter kit adds), configured as the web's StarterKit is: headings
 * 2 and 3, links that do not open on a tap and carry the web's `rel`. Tiptap
 * serialises them, so the HTML is the web editor's.
 *
 * Two of the web's commands have no TenTap bridge and are not offered here:
 * alignment and the horizontal rule. HTML carrying them reads back without
 * them once edited on a phone; a custom TenTap editor bundle can add both
 * (TenTap's "advanced setup") if a screen needs them.
 */

const mapping = { className: { target: false, nativeStyleMapping: { color: 'color' } } } as const;

/** Reports the colour a text class resolves to, for the web view's own CSS. */
function Reporter({
  color,
  onColor,
}: {
  color?: string;
  onColor: (color: string | undefined) => void;
}): null {
  useEffect(() => {
    onColor(color);
  }, [color, onColor]);
  return null;
}

function ColorProbe({
  className,
  onColor,
}: {
  className: string;
  onColor: (color: string | undefined) => void;
}): React.JSX.Element {
  return useCssElement(Reporter, { className, onColor }, mapping);
}

const SUPPORTED = new Set<Command>([
  'undo',
  'redo',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'h2',
  'h3',
  'bullet',
  'ordered',
  'quote',
]);

export function useRichTextEngine(options: EngineOptions): Engine {
  const { value, onChange, placeholder, editable, minHeight, onFocusChange, onBlur } = options;
  const [fg, setFg] = useState<string>();
  const [subtle, setSubtle] = useState<string>();
  const [accent, setAccent] = useState<string>();
  const [line, setLine] = useState<string>();

  const editor = useEditorBridge({
    initialContent: value,
    editable,
    avoidIosKeyboard: true,
    bridgeExtensions: [
      CoreBridge,
      BoldBridge,
      ItalicBridge,
      UnderlineBridge,
      StrikeBridge,
      CodeBridge,
      HeadingBridge.configureExtension({ levels: [2, 3] }),
      BulletListBridge,
      OrderedListBridge,
      ListItemBridge,
      BlockquoteBridge,
      LinkBridge.configureExtension({ openOnClick: false, HTMLAttributes: { ...LINK_ATTRIBUTES } }),
      HistoryBridge,
      HardBreakBridge,
      DropCursorBridge,
      PlaceholderBridge.configureExtension({ placeholder }),
    ],
  });
  const state = useBridgeState(editor);
  const html = useEditorContent(editor, { type: 'html' });

  // The latest callbacks, so only the content and the focus re-run these.
  const callbacks = useRef({ onChange, onFocusChange, onBlur });
  callbacks.current = { onChange, onFocusChange, onBlur };
  useEffect(() => {
    if (typeof html === 'string') callbacks.current.onChange?.(html);
  }, [html]);
  useEffect(() => {
    callbacks.current.onFocusChange(state.isFocused);
    if (!state.isFocused) callbacks.current.onBlur?.();
  }, [state.isFocused]);

  // The web view cannot read the app's tokens: hand it the resolved colours.
  useEffect(() => {
    if (!state.isReady || !fg) return;
    editor.injectCSS(
      `* { color: ${fg}; } body, .ProseMirror { background: transparent; font-family: -apple-system, system-ui, Roboto, sans-serif; font-size: 17px; line-height: 1.55; margin: 0; padding: 12px 14px; }
       a { color: ${accent ?? fg}; } blockquote { border-left: 3px solid ${line ?? fg}; margin-left: 0; padding-left: 12px; }
       .is-editor-empty:first-child::before { color: ${subtle ?? fg}; }`,
      'reach',
    );
  }, [editor, state.isReady, fg, subtle, accent, line]);

  const active: Record<Command, boolean> = {
    undo: false,
    redo: false,
    bold: state.isBoldActive,
    italic: state.isItalicActive,
    underline: state.isUnderlineActive,
    strike: state.isStrikeActive,
    code: state.isCodeActive,
    h2: state.headingLevel === 2,
    h3: state.headingLevel === 3,
    bullet: state.isBulletListActive,
    ordered: state.isOrderedListActive,
    quote: state.isBlockquoteActive,
    rule: false,
    'align-left': false,
    'align-center': false,
    'align-right': false,
  };

  const run = (command: Command): void => {
    switch (command) {
      case 'undo':
        editor.undo();
        break;
      case 'redo':
        editor.redo();
        break;
      case 'bold':
        editor.toggleBold();
        break;
      case 'italic':
        editor.toggleItalic();
        break;
      case 'underline':
        editor.toggleUnderline();
        break;
      case 'strike':
        editor.toggleStrike();
        break;
      case 'code':
        editor.toggleCode();
        break;
      case 'h2':
        editor.toggleHeading(2);
        break;
      case 'h3':
        editor.toggleHeading(3);
        break;
      case 'bullet':
        editor.toggleBulletList();
        break;
      case 'ordered':
        editor.toggleOrderedList();
        break;
      case 'quote':
        editor.toggleBlockquote();
        break;
      default:
        break;
    }
  };

  return {
    body: (
      <View style={{ height: minHeight }}>
        <RichText editor={editor} />
        <ColorProbe className="text-fg" onColor={setFg} />
        <ColorProbe className="text-fg-subtle" onColor={setSubtle} />
        <ColorProbe className="text-accent-fg" onColor={setAccent} />
        <ColorProbe className="text-border-strong" onColor={setLine} />
      </View>
    ),
    isActive: (c) => active[c],
    canRun: (c) => (c === 'undo' ? state.canUndo : c === 'redo' ? state.canRedo : true),
    run,
    supports: (c) => SUPPORTED.has(c),
    link: state.isLinkActive ? (state.activeLink ?? '') : null,
    setLink: (href) => {
      editor.setLink(href);
    },
    // TenTap reports no count; the frame counts the text of the HTML instead.
    characters: typeof html === 'string' ? textOf(html).length : 0,
  };
}
