import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { CopyButton } from '../clipboard/clipboard';
import { Alert } from '../feedback/feedback';
import { Input } from '../input/input';
import { PasswordField, defaultPasswordRequirements } from './password-field';

const meta = {
  title: 'Forms/PasswordField',
  component: PasswordField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A password field, with the security decisions made rather than left open.',
          '',
          '### Paste is never blocked',
          '',
          'The single most common anti-pattern here, and it makes things strictly worse: blocking paste defeats password managers, which pushes people onto passwords they can type, which means short and reused ones. **NCSC** and **NIST SP 800-63B** both say so in as many words. There is no prop to turn it off, because there is no case for it.',
          '',
          '### `autoComplete` is required and has no default',
          '',
          '`current-password` when signing in, `new-password` when setting one. Get it wrong and the manager either fails to offer a saved credential or silently overwrites one, a failure nobody notices until the support tickets arrive. A wrong default would be worse than a compile error, so there is no default.',
          '',
          'The reveal toggle **never** changes it. A field that becomes `type="text"` with `autoComplete="off"` mid-edit is a saved credential that quietly stops being offered.',
          '',
          '### No maximum length, no character-class rules',
          '',
          'Both push entropy down. The strength meter measures length and variety and says so in words. It is advice, never a gate. The real check belongs on the server, against a breached-password list.',
          '',
          '### Reveal is a toggle, not a mode',
          '',
          '`aria-pressed`, so the state is announced rather than implied by which of two similar glyphs is showing. It is also the accessible answer for anyone who cannot touch-type a 24-character passphrase.',
          '',
          '### Nothing is logged',
          '',
          'The value leaves the component only through `onChange`. There is no `onCopy` handler, no analytics hook, and the strength estimate is computed locally.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      control: false,
      table: { type: { summary: 'string' }, category: 'State' },
    },
    onChange: {
      control: false,
      table: { type: { summary: '(value: string) => void' }, category: 'State' },
    },
    autoComplete: {
      description:
        '**Required, no default.** `current-password` on a sign-in, `new-password` on a change or a registration.',
      control: 'inline-radio',
      options: ['current-password', 'new-password'],
      table: {
        type: { summary: "'current-password' | 'new-password'" },
        category: 'Security',
      },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Accessibility' } },
    hint: {
      description: 'Help text, wired through `aria-describedby`.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    showStrength: {
      description:
        'A four-segment meter with a spoken value. Only meaningful with `new-password`: measuring a password the user already has is theatre.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Guidance',
      },
    },
    requirements: {
      description:
        'Live checklist. Advice, not a gate: the server decides. Length first, because length is what actually matters.',
      control: false,
      table: { type: { summary: 'readonly PasswordRequirement[]' }, category: 'Guidance' },
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    invalid: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Password',
    autoComplete: 'new-password',
    showStrength: true,
    size: 'md',
    disabled: false,
    invalid: false,
    value: '',
    onChange: () => undefined,
  },
} satisfies Meta<typeof PasswordField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState('');
    return (
      <div className="max-w-sm">
        <PasswordField {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const SigningIn: Story = {
  name: 'Signing in',
  args: {
    autoComplete: 'current-password',
    showStrength: false,
    label: 'Password',
    hint: '',
  },
  parameters: {
    docs: {
      description: {
        story:
          '`current-password`, no meter, no checklist. Measuring the strength of a password someone already has is theatre. They cannot act on it here, and the only thing it achieves is a red bar under a correct credential.',
      },
    },
  },
  render: function SignInStory(args) {
    const [password, setPassword] = useState('');
    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="signin-email" className="text-sm font-medium text-fg">
              Work email
            </label>
            <Input id="signin-email" type="email" autoComplete="username" />
          </div>
          <PasswordField {...args} value={password} onChange={setPassword} />
          <Button variant="primary" fullWidth>
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  },
};

export const SettingANewOne: Story = {
  name: 'Setting a new one',
  args: {
    autoComplete: 'new-password',
    showStrength: true,
    requirements: defaultPasswordRequirements,
    label: 'New password',
    hint: 'A passphrase of four unrelated words beats anything you can remember with symbols in it.',
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Meter plus checklist. Both are advice: nothing here blocks submission, because the authoritative check is a breached-password lookup on the server and this component cannot do it.',
          '',
          'Type a long passphrase and then a short one with symbols, the estimate favours length, which is the honest ordering. It is still only an estimate: it cannot know that `Tr0ub4dor&3` is weak, and it says "estimate" rather than pretending.',
        ].join('\n'),
      },
    },
  },
  render: function NewPasswordStory(args) {
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const mismatch = confirmation !== '' && confirmation !== password;

    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Change your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordField {...args} value={password} onChange={setPassword} />
          <PasswordField
            {...args}
            label="Confirm"
            hint=""
            showStrength={false}
            requirements={[]}
            invalid={mismatch}
            value={confirmation}
            onChange={setConfirmation}
          />
          {mismatch ? (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              The two entries do not match.
            </p>
          ) : null}
          <Button variant="primary" fullWidth disabled={password === '' || mismatch}>
            Update password
          </Button>
        </CardContent>
      </Card>
    );
  },
};

export const PasteWorks: Story = {
  name: 'Paste works: deliberately',
  args: { autoComplete: 'new-password', showStrength: true, label: 'Password' },
  parameters: {
    docs: {
      description: {
        story: [
          'Copy the generated string and paste it in. It works, and there is no prop to stop it.',
          '',
          'The reasoning is not about convenience. Blocking paste defeats password managers → people choose passwords they can type → passwords get short and reused → one breach becomes many. NCSC published this as guidance in 2017 and NIST followed; a field that blocks paste in 2026 is a field written from memory of a 2009 blog post.',
        ].join('\n'),
      },
    },
  },
  render: function PasteStory(args) {
    const [value, setValue] = useState('');
    const [generated] = useState(() => {
      // Deterministic, so the docs page does not diff on every run. A real
      // generator uses `crypto.getRandomValues`, never `Math.random`, which
      // is not a cryptographic source.
      const words = ['harbour', 'kestrel', 'walnut', 'lantern'];
      return words.join('-');
    });

    return (
      <div className="max-w-sm space-y-3">
        <Alert tone="info" title="Copy this, then paste it below">
          <span className="flex items-center gap-2">
            <code className="font-mono text-xs select-all">{generated}</code>
            <CopyButton value={generated} label="Copy the generated passphrase" />
          </span>
        </Alert>
        <PasswordField {...args} value={value} onChange={setValue} />
        <p className="text-xs text-fg-muted">
          Four unrelated words is stronger than anything with a symbol substitution in it, and
          possible to remember.
        </p>
      </div>
    );
  },
};

export const States: Story = {
  name: 'Invalid, disabled, sizes',
  parameters: {
    docs: {
      description: {
        story:
          'The invalid state pairs the border with `aria-invalid` **and** a message. "Incorrect password" is the only message worth showing on a sign-in: naming which of the two fields was wrong is a gift to whoever is guessing.',
      },
    },
  },
  render: (args) => (
    <div className="grid max-w-3xl gap-6 md:grid-cols-3">
      <div className="space-y-1.5">
        <PasswordField
          {...args}
          size="sm"
          label="Small"
          autoComplete="current-password"
          showStrength={false}
          value="hunter2hunter2"
          onChange={() => undefined}
        />
      </div>
      <div className="space-y-1.5">
        <PasswordField
          {...args}
          label="Invalid"
          autoComplete="current-password"
          showStrength={false}
          invalid
          value="wrong"
          onChange={() => undefined}
        />
        <p role="alert" className="text-xs font-medium text-danger-fg">
          Incorrect email or password.
        </p>
      </div>
      <PasswordField
        {...args}
        size="lg"
        label="Disabled"
        hint="Managed by your identity provider."
        autoComplete="current-password"
        showStrength={false}
        disabled
        value="............"
        onChange={() => undefined}
      />
    </div>
  ),
};
