'use client';

import { lazy, Suspense, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { RichTextFrame, type RichTextEditorProps } from './rich-text-frame';

export type { RichTextEditorProps, RichTextGroup } from './rich-text-frame';

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
