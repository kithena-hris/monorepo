import type { ReactNode } from 'react';

/*
 * What the editor's frame and toolbar need from whatever edits the text:
 * TenTap on a device (`engine.tsx`), Tiptap itself on the web
 * (`engine.web.tsx`). Both are Tiptap underneath, configured as the web
 * editor is, so both store the same HTML.
 */

export type Command =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'quote'
  | 'rule'
  | 'align-left'
  | 'align-center'
  | 'align-right';

export type EngineOptions = {
  /** HTML, read once as it mounts. */
  value: string;
  onChange?: ((html: string) => void) | undefined;
  placeholder: string;
  editable: boolean;
  characterLimit?: number | undefined;
  /** The text box's accessible name and hint. */
  label: string;
  hint?: string | undefined;
  invalid: boolean;
  disabled: boolean;
  /** The editable area's height, in points. */
  minHeight: number;
  onFocusChange: (focused: boolean) => void;
  onBlur?: (() => void) | undefined;
};

export type Engine = {
  /** The editable region, to place in the frame. */
  body: ReactNode;
  isActive: (command: Command) => boolean;
  canRun: (command: Command) => boolean;
  run: (command: Command) => void;
  /** Whether this engine stores what the command makes (TenTap has no alignment). */
  supports: (command: Command) => boolean;
  /** The link under the caret, if any. */
  link: string | null;
  setLink: (href: string | null) => void;
  /** Characters typed, for the counter. */
  characters: number;
};

/** The web editor's link attributes: a link in an employee-written document is untrusted. */
export const LINK_ATTRIBUTES = { rel: 'noopener noreferrer nofollow', target: '_blank' } as const;
