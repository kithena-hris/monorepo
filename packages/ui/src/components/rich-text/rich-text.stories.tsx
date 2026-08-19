import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { CopyButton } from '../clipboard/clipboard';
import { RichTextContent, RichTextEditor } from './rich-text';

const jobDescription = [
  '<h2>About the role</h2>',
  '<p>You will own the payroll calculation engine end to end: the domain model, the retroactive delta logic, and the integrations with four national tax authorities.</p>',
  '<h3>What you will do</h3>',
  '<ul>',
  '<li>Design effective-dated aggregates that can explain any historical payslip</li>',
  '<li>Work with People Ops on <strong>real</strong> edge cases, not hypothetical ones</li>',
  '<li>Keep the calculation deterministic and the tests fast</li>',
  '</ul>',
  '<blockquote><p>Money is never a float. Not once, not anywhere.</p></blockquote>',
  '<p>Read the <a href="https://example.com/handbook">engineering handbook</a> before applying.</p>',
].join('');

const meta = {
  title: 'Forms/RichTextEditor',
  component: RichTextEditor,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A rich text field, on Tiptap.',
          '',
          '### Why a real editor',
          '',
          'Three fields in an HRIS genuinely need structure: a job description, a policy document, and a performance review. All three are written once and read hundreds of times, and all three lose meaning as plain text, a list of responsibilities that is not a list is a wall.',
          '',
          '### Why Tiptap and not a `contenteditable`',
          '',
          '`contenteditable` produces whatever markup the browser felt like: Safari emits `<b>`, Chrome emits `<span style>`, a paste from Word emits both plus forty class names. Tiptap sits on ProseMirror, which holds a **schema**, the document can only contain nodes you allowed, paste is coerced into that schema, and the output is identical on every browser. For content that is stored, versioned, exported to a PDF and eventually shown to a labour inspector, "identical on every browser" is the requirement, not a nicety.',
          '',
          '### Configuration',
          '',
          "The toolbar is a list of group names. A comment box gets `['history', 'inline']`; a policy document gets everything. Pass extra Tiptap extensions through `extensions` for mentions, tables or an emoji picker, the component does not need to know about them.",
          '',
          '### Accessibility',
          '',
          'ProseMirror supplies `role="textbox"` and `aria-multiline`. On top of that:',
          '',
          '- a real accessible name, from `label` or `aria-labelledby`;',
          '- `aria-describedby` wiring for the hint and the counter;',
          '- `role="toolbar"` with **roving tabindex**, one tab stop for the whole toolbar, arrow keys between the buttons. Without it, reaching the text costs fifteen tabs every time;',
          '- `aria-pressed` on every format button, so state is announced and not only coloured;',
          '- the counter is a polite live region that only speaks near the limit. Announcing a count on every keystroke makes an editor unusable with a screen reader.',
          '',
          '### Output',
          '',
          '`onChange` gives HTML; `onChangeJson` gives the ProseMirror document. **Store the JSON.** HTML is a rendering of the document, and a schema migration can rewrite JSON but cannot reliably re-parse a decade of hand-edited HTML.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description:
        'Initial HTML. Read once, at mount. This is not a controlled input, because re-setting the document on every keystroke destroys the selection and the undo history.',
      control: false,
      table: { type: { summary: 'string' }, category: 'Data' },
    },
    onChange: {
      description:
        'Fires with HTML on every change. **Debounce before writing**: this runs per keystroke, and an unthrottled mutation per character is exactly that.',
      control: false,
      table: { type: { summary: '(html: string) => void' }, category: 'Data' },
    },
    onChangeJson: {
      description: 'The same change as ProseMirror JSON. This is what belongs in the database.',
      control: false,
      table: { type: { summary: '(json: object) => void' }, category: 'Data' },
    },
    toolbar: {
      description:
        'Which groups to render, in order. `[]` hides the toolbar entirely: keyboard shortcuts and paste still work.',
      control: 'check',
      options: ['history', 'inline', 'headings', 'lists', 'blocks', 'align', 'link'],
      table: {
        type: {
          summary:
            "readonly ('history' | 'inline' | 'headings' | 'lists' | 'blocks' | 'align' | 'link')[]",
        },
        defaultValue: { summary: "['history','inline','headings','lists','blocks','link']" },
        category: 'Configuration',
      },
    },
    label: {
      description: 'Visible label. One of this or `aria-labelledby` is required.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    hint: {
      description: 'Help text under the label. Wired through `aria-describedby`.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    placeholder: {
      description:
        'Shown in the empty document. A placeholder is not a label, it disappears the moment someone types.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Write something…' },
        category: 'Content',
      },
    },
    characterLimit: {
      description:
        'Hard limit. The editor stops accepting input at it and the counter turns red. Prefer a limit the *domain* has, not a round number.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Configuration' },
    },
    showCount: {
      description: 'Shows the counter without imposing a limit.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Configuration',
      },
    },
    readOnly: {
      description:
        'No toolbar, no caret; content stays selectable and copyable. For rendering stored content in a form, prefer `RichTextContent`. It does not load ProseMirror at all.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    disabled: {
      description: 'Blocks interaction and drops the opacity.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    invalid: {
      description: 'Red border and `aria-invalid`. Pair it with a message the field points at.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    minHeight: {
      description: 'Minimum height of the editable area.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: '10rem' },
        category: 'Appearance',
      },
    },
    maxHeight: {
      description: 'Height at which the content starts scrolling. Pair with `stickyToolbar`.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Appearance' },
    },
    stickyToolbar: {
      description: 'Keeps the toolbar visible while a long document scrolls.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    extensions: {
      description: 'Extra Tiptap extensions, merged after the defaults.',
      control: false,
      table: { type: { summary: 'Extensions' }, category: 'Configuration' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Job description',
    hint: 'Shown on the careers site and in the offer letter.',
    placeholder: 'Describe the role…',
    minHeight: '12rem',
    readOnly: false,
    disabled: false,
    invalid: false,
    showCount: true,
  },
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-2xl">
      <RichTextEditor {...args} value={jobDescription} />
    </div>
  ),
};

export const Minimal: Story = {
  name: 'A comment box',
  args: {
    label: 'Note on this request',
    hint: 'Visible to the employee once the request is decided.',
    placeholder: 'Add a note…',
    toolbar: ['inline', 'lists'],
    minHeight: '6rem',
    characterLimit: 280,
    showCount: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Two groups and a limit. A comment on a leave request does not need headings, and a schema that cannot express a heading cannot receive one by paste either, the configuration removes the capability, not just the button.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-xl">
      <RichTextEditor {...args} />
    </div>
  ),
};

export const Everything: Story = {
  name: 'Every group',
  args: {
    toolbar: ['history', 'inline', 'headings', 'lists', 'blocks', 'align', 'link'],
    label: 'Policy document',
    hint: 'Versioned. Employees are notified when it changes.',
    minHeight: '18rem',
    maxHeight: '22rem',
    stickyToolbar: true,
    showCount: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'The full toolbar with a sticky header and a scroll ceiling. Try the keyboard: **Tab** lands on the toolbar as one stop, **→** and **←** move between the buttons, **Tab** again reaches the text. The link button opens a popover, and the URL it takes is forced to `https://` with `rel="noopener noreferrer nofollow"`, an employee-authored document is untrusted input.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-2xl">
      <RichTextEditor {...args} value={jobDescription} />
    </div>
  ),
};

export const NoToolbar: Story = {
  name: 'No toolbar',
  args: {
    toolbar: [],
    label: 'Quick note',
    minHeight: '5rem',
    placeholder: 'Markdown shortcuts still work: try "## " or "- "',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The toolbar is optional; the schema is not. Input rules still apply, so `## ` makes a heading, `- ` makes a list, and ⌘B still bolds. For a field where formatting is welcome but not the point. This is quieter than fourteen buttons.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-xl">
      <RichTextEditor {...args} />
    </div>
  ),
};

export const States: Story = {
  name: 'Invalid, disabled and read-only',
  parameters: {
    docs: {
      description: {
        story:
          'The invalid state pairs a red border with `aria-invalid` **and** a message, a colour alone is not a validation message. Read-only keeps the content selectable; disabled does not, which is why "you may not edit this" and "this field is not applicable" are different states.',
      },
    },
  },
  render: (args) => (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
      <div className="space-y-1.5">
        <RichTextEditor
          {...args}
          label="Invalid"
          hint="A job description is required before the requisition can be published."
          invalid
          minHeight="8rem"
          showCount={false}
        />
        <p role="alert" className="text-xs font-medium text-danger-fg">
          Add at least one responsibility.
        </p>
      </div>
      <RichTextEditor
        {...args}
        label="Disabled"
        hint="Locked while the requisition is in approval."
        disabled
        minHeight="8rem"
        showCount={false}
        value="<p>Owns the payroll calculation engine.</p>"
      />
      <RichTextEditor
        {...args}
        label="Read only"
        hint="Published. Edit through a new version."
        readOnly
        minHeight="8rem"
        showCount={false}
        value="<p>Owns the payroll calculation engine.</p><ul><li>Effective-dated aggregates</li></ul>"
      />
    </div>
  ),
};

export const Roundtrip: Story = {
  name: 'What it stores, and how it reads back',
  parameters: {
    docs: {
      description: {
        story:
          'Type on the left; the right pane is `RichTextContent` rendering the same HTML. That component is deliberately separate, a job description on a careers page has no reason to ship an editor, and this proves the two agree.',
      },
    },
  },
  render: function RoundtripStory(args) {
    const [html, setHtml] = useState(jobDescription);
    const [showSource, setShowSource] = useState(false);

    return (
      <div className="grid max-w-6xl gap-5 lg:grid-cols-2">
        <RichTextEditor
          {...args}
          label="Editing"
          hint="Changes appear on the right as they are typed."
          value={jobDescription}
          onChange={setHtml}
          minHeight="20rem"
        />
        <Card>
          <CardHeader>
            <CardTitle>Rendered</CardTitle>
            <div className="flex items-center gap-1">
              {showSource ? <CopyButton value={html} label="Copy the HTML" /> : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowSource((current) => !current);
                }}
              >
                {showSource ? 'Show rendered' : 'Show source'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showSource ? (
              <pre className="max-h-[20rem] overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-xs text-fg-muted">
                {html}
              </pre>
            ) : (
              <RichTextContent sanitisedHtml={html} className="max-h-[20rem] overflow-auto" />
            )}
          </CardContent>
        </Card>
      </div>
    );
  },
};
