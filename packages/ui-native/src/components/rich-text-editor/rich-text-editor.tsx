import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { Fragment, useState, type ReactNode } from 'react';
import { ScrollView, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog.tsx';
import { Field, FieldLabel, useField } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { Toggle } from '../toggle/toggle.tsx';
// Extensionless on purpose: Metro takes `engine.tsx` (TenTap) on a device, and
// react-native-web's bundlers take `engine.web.tsx` (Tiptap itself).
import { useRichTextEngine } from './engine';
import type { Command } from './engine-types.ts';

/**
 * Formatted text for policies, notes and comments. It stores safe HTML, the
 * same HTML the web editor stores, and reads it back the same way: Tiptap on
 * both, through TenTap's web view on a device.
 *
 * The toolbar sits above the text in groups, every button a 44pt target; the
 * marks are toggles, read as pressed or not. A link opens a centred dialog
 * for its address.
 */

export type RichTextGroup =
  'history' | 'inline' | 'headings' | 'lists' | 'blocks' | 'align' | 'link';

export type RichTextEditorProps = {
  /** HTML, read as it mounts. */
  value?: string;
  /** HTML on every change. Debounce it before writing. */
  onChange?: (html: string) => void;
  /** The field's name. A `Field`'s label wins. */
  label?: string;
  hint?: string;
  placeholder?: string;
  /** Which groups, in order. `[]` hides the toolbar. */
  toolbar?: readonly RichTextGroup[];
  characterLimit?: number;
  showCount?: boolean;
  /** Text to read: no toolbar, no fill, a hairline. */
  readOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** The text area's height in points. 96 by default. */
  minHeight?: number;
  /** Under the text, inside the box: a comment box's attachments and its button. */
  footer?: ReactNode;
  onBlur?: () => void;
  className?: string | undefined;
};

const DEFAULT_TOOLBAR: readonly RichTextGroup[] = ['inline', 'headings', 'lists', 'link'];

type Tool = { command: Command; label: string; icon: LucideIcon; toggle: boolean };

const tools: Record<Exclude<RichTextGroup, 'link'>, readonly Tool[]> = {
  history: [
    { command: 'undo', label: 'Undo', icon: Undo2, toggle: false },
    { command: 'redo', label: 'Redo', icon: Redo2, toggle: false },
  ],
  inline: [
    { command: 'bold', label: 'Bold', icon: Bold, toggle: true },
    { command: 'italic', label: 'Italic', icon: Italic, toggle: true },
    { command: 'underline', label: 'Underline', icon: Underline, toggle: true },
    { command: 'strike', label: 'Strikethrough', icon: Strikethrough, toggle: true },
  ],
  headings: [
    { command: 'h2', label: 'Heading 2', icon: Heading2, toggle: true },
    { command: 'h3', label: 'Heading 3', icon: Heading3, toggle: true },
  ],
  lists: [
    { command: 'bullet', label: 'Bulleted list', icon: List, toggle: true },
    { command: 'ordered', label: 'Numbered list', icon: ListOrdered, toggle: true },
    { command: 'quote', label: 'Quote', icon: Quote, toggle: true },
  ],
  blocks: [
    { command: 'code', label: 'Inline code', icon: Code, toggle: true },
    { command: 'rule', label: 'Horizontal rule', icon: Minus, toggle: false },
  ],
  align: [
    { command: 'align-left', label: 'Align left', icon: TextAlignStart, toggle: true },
    { command: 'align-center', label: 'Align centre', icon: TextAlignCenter, toggle: true },
    { command: 'align-right', label: 'Align right', icon: TextAlignEnd, toggle: true },
  ],
};

export function RichTextEditor({
  value = '',
  onChange,
  label,
  hint,
  placeholder = 'Write something…',
  toolbar = DEFAULT_TOOLBAR,
  characterLimit,
  showCount = false,
  readOnly = false,
  disabled: disabledProp,
  invalid: invalidProp,
  minHeight = 96,
  footer,
  onBlur,
  className,
}: RichTextEditorProps): React.JSX.Element {
  const field = useField();
  const disabled = disabledProp ?? field?.disabled ?? false;
  const invalid = invalidProp ?? field?.invalid ?? false;
  const name = field?.parts.label ?? label ?? 'Text';
  const [focused, setFocused] = useState(false);
  const engine = useRichTextEngine({
    value,
    onChange,
    placeholder,
    editable: !readOnly && !disabled,
    characterLimit,
    label: name,
    hint: hint ?? field?.parts.description,
    invalid,
    disabled,
    minHeight,
    onFocusChange: setFocused,
    onBlur,
  });
  const showBar = !readOnly && toolbar.length > 0;
  const counting = characterLimit !== undefined || showCount;
  const near = characterLimit !== undefined && engine.characters >= characterLimit * 0.9;

  return (
    <View
      role="group"
      aria-label={name}
      aria-disabled={disabled || undefined}
      className={cn('gap-1.5', className)}
    >
      {label && !field?.parts.label ? (
        <CssText
          aria-hidden
          className={cn('text-subhead font-semibold', disabled ? 'text-fg-disabled' : 'text-fg')}
        >
          {label}
        </CssText>
      ) : null}
      <View
        className={cn(
          'overflow-hidden rounded-[18px]',
          readOnly ? 'border border-border bg-transparent' : 'bg-surface-sunken',
          disabled && 'opacity-50',
        )}
      >
        {showBar ? (
          <Toolbar
            groups={toolbar}
            engine={engine}
            disabled={disabled}
            label={`${name} formatting`}
          />
        ) : null}
        {engine.body}
        {footer ? (
          <View className="flex-row items-center justify-between gap-2 py-2 pr-2 pl-3.5">
            {footer}
          </View>
        ) : null}
        {(focused && !readOnly) || invalid ? (
          <View
            style={{ pointerEvents: 'none' }}
            className={cn(
              'absolute inset-0 rounded-[18px] border-2',
              focused && !readOnly ? 'border-accent' : 'border-danger',
            )}
          />
        ) : null}
      </View>
      {hint && !field ? <CssText className="text-subhead text-fg-muted">{hint}</CssText> : null}
      {counting ? (
        <CssText
          accessibilityLiveRegion={near ? 'polite' : 'none'}
          className={cn(
            'self-end text-footnote tabular-nums',
            near ? 'text-danger-fg' : 'text-fg-muted',
          )}
        >
          {characterLimit === undefined
            ? `${String(engine.characters)} characters`
            : `${String(engine.characters)} / ${String(characterLimit)}`}
        </CssText>
      ) : null}
    </View>
  );
}

function Toolbar({
  groups,
  engine,
  disabled,
  label,
}: {
  groups: readonly RichTextGroup[];
  engine: ReturnType<typeof useRichTextEngine>;
  disabled: boolean;
  label: string;
}): React.JSX.Element {
  const shown = groups
    .map((group) =>
      group === 'link'
        ? { group, tools: [] as Tool[] }
        : { group, tools: tools[group].filter((t) => engine.supports(t.command)) },
    )
    .filter((g) => g.group === 'link' || g.tools.length > 0);
  return (
    // One row that scrolls sideways, as a phone's formatting bar does, rather
    // than a second row pushing the text down.
    <ScrollView
      // Nothing in it can take focus while disabled, so it does not scroll then.
      scrollEnabled={!disabled}
      {...(disabled ? { style: { overflow: 'hidden' as const } } : {})}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="border-b border-border"
      contentContainerClassName="items-center gap-0.5 p-1.5"
    >
      <View role="toolbar" aria-label={label} className="flex-row items-center gap-0.5">
        {shown.map(({ group, tools: list }, index) => (
          <Fragment key={group}>
            {index > 0 ? <View aria-hidden className="mx-1 h-5 w-px bg-border" /> : null}
            {group === 'link' ? (
              <LinkTool engine={engine} disabled={disabled} />
            ) : (
              list.map((tool) =>
                tool.toggle ? (
                  <Toggle
                    key={tool.command}
                    variant="ghost"
                    shape="square"
                    size="sm"
                    icon={tool.icon}
                    accessibilityLabel={tool.label}
                    pressed={engine.isActive(tool.command)}
                    disabled={disabled}
                    onPressedChange={() => {
                      engine.run(tool.command);
                    }}
                  />
                ) : (
                  <Button
                    key={tool.command}
                    variant="ghost"
                    size="xs"
                    accessibilityLabel={tool.label}
                    disabled={disabled || !engine.canRun(tool.command)}
                    startIcon={<Icon icon={tool.icon} size={17} tone="muted" />}
                    onPress={() => {
                      engine.run(tool.command);
                    }}
                  />
                ),
              )
            )}
          </Fragment>
        ))}
      </View>
    </ScrollView>
  );
}

/** A link needs an address: a short task, so a centred dialog. */
function LinkTool({
  engine,
  disabled,
}: {
  engine: ReturnType<typeof useRichTextEngine>;
  disabled: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Toggle
        variant="ghost"
        shape="square"
        size="sm"
        icon={Link2}
        accessibilityLabel={engine.link === null ? 'Add a link' : 'Edit the link'}
        pressed={engine.link !== null}
        disabled={disabled}
        onPressedChange={() => {
          setHref(engine.link ?? 'https://');
          setOpen(true);
        }}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{engine.link === null ? 'Add a link' : 'Edit the link'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Address</FieldLabel>
            <Input type="url" value={href} onChange={setHref} autoFocus />
          </Field>
        </DialogBody>
        <DialogFooter>
          {engine.link === null ? (
            <Button
              onPress={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="danger-soft"
              onPress={() => {
                engine.setLink(null);
                setOpen(false);
              }}
            >
              Remove
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!/^(https?:\/\/|mailto:)\S+/.test(href.trim())}
            onPress={() => {
              engine.setLink(href.trim());
              setOpen(false);
            }}
          >
            {engine.link === null ? 'Add' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
