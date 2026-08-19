import type { Meta, StoryObj } from '@storybook/react-vite';
import { Flame, Heart } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Rating } from './rating';

const performance = [
  'Below expectations',
  'Partially meets',
  'Meets expectations',
  'Exceeds',
  'Outstanding',
] as const;

const meta = {
  title: 'Forms/Rating',
  component: Rating,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A star rating.',
          '',
          '### It is a radio group, not a row of buttons',
          '',
          'Five buttons that each set a value is five tab stops, five announcements, and no indication that they are alternatives. This is `role="radiogroup"` with **one** tab stop: arrow keys move between values, Home and End reach the ends, and a screen reader says *"Meets expectations, radio, selected"* rather than *"star, button"*.',
          '',
          'A native `<input type="radio">` would be better still. It is what `RadioGroup` uses, but a star rating needs *half* a glyph filled for a fractional average, and a radio input cannot be split. So the ARIA is ours, which is why the keyboard handling is explicit rather than inherited.',
          '',
          '### Reading and writing are different components',
          '',
          '`readOnly` is not a disabled state. A displayed average is not a control: it renders with `role="img"` and a text alternative ("4.2 out of 5"), takes no tab stop, and supports fractions. An interactive rating never shows a fraction, because nobody can click 4.2.',
          '',
          '### Give the numbers words',
          '',
          '`valueLabels` is the difference between a rating people use consistently and one they do not. "3 of 5" means nothing until it means "Meets expectations", and in a performance review that ambiguity is a calibration problem, not a design detail.',
          '',
          '### Colour is never the only signal',
          '',
          'The value is always available as text, through `showValue` or the accessible name. A row of gold shapes is not a number to someone who cannot separate gold from grey.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description: 'Current value. Fractions render only in `readOnly` mode.',
      control: { type: 'range', min: 0, max: 5, step: 0.1 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '0' }, category: 'State' },
    },
    onChange: {
      description: 'Fires with the new value, or `0` when cleared.',
      control: false,
      table: { type: { summary: '(value: number) => void' }, category: 'State' },
    },
    max: {
      description: 'How many symbols. Five is conventional; three and ten both exist.',
      control: { type: 'number', min: 2, max: 10 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '5' }, category: 'Scale' },
    },
    label: {
      description: 'Required. "Interview performance", not "Rating".',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    valueLabels: {
      description:
        'A word per value, announced instead of the bare number. The single most useful prop here.',
      control: 'object',
      table: { type: { summary: 'readonly string[]' }, category: 'Accessibility' },
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
    tone: {
      description: 'Colour of a filled symbol. Reinforces the value; never carries it.',
      control: 'inline-radio',
      options: ['warning', 'accent', 'success', 'danger'],
      table: {
        type: { summary: "'warning' | 'accent' | 'success' | 'danger'" },
        defaultValue: { summary: 'warning' },
        category: 'Appearance',
      },
    },
    symbol: {
      description: 'Replaces the star. Anything that reads as a scale, a heart, a flame.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Appearance' },
    },
    showValue: {
      description: 'Prints the value, and the hovered label, beside the symbols.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    clearable: {
      description: 'Re-picking the current value clears it. Home also clears.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    readOnly: {
      description: 'Display only: no tab stop, fractions rendered, announced as one string.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    disabled: {
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    name: {
      description: 'Emits a hidden input, for an uncontrolled form submit.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Form' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Interview performance',
    max: 5,
    size: 'md',
    tone: 'warning',
    showValue: true,
    clearable: true,
    readOnly: false,
    disabled: false,
  },
} satisfies Meta<typeof Rating>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState(0);
    return <Rating {...args} value={value} onChange={setValue} />;
  },
};

export const WithMeanings: Story = {
  name: 'With meanings',
  args: { valueLabels: performance, label: 'Overall performance' },
  parameters: {
    docs: {
      description: {
        story:
          'Hover or arrow through it: the label changes with the value, and that label is what a screen reader announces. Two reviewers scoring "3" mean the same thing only when 3 has a name.',
      },
    },
  },
  render: function MeaningStory(args) {
    const [value, setValue] = useState(3);
    return <Rating {...args} value={value} onChange={setValue} />;
  },
};

export const Keyboard: Story = {
  name: 'From the keyboard',
  args: { valueLabels: performance },
  parameters: {
    docs: {
      description: {
        story:
          'Tab once to reach the whole group. ← → and ↑ ↓ move by one, Home clears, End jumps to the top. One tab stop, not five, a review form with eight ratings would otherwise cost forty tab presses to cross.',
      },
    },
  },
  render: function KeyboardStory(args) {
    const [value, setValue] = useState(0);
    return (
      <div className="space-y-3">
        <Rating {...args} value={value} onChange={setValue} />
        <p aria-live="polite" className="text-sm text-fg-muted">
          {value === 0 ? 'Not rated' : `${String(value)}, ${performance[value - 1] ?? ''}`}
        </p>
      </div>
    );
  },
};

export const ReadOnly: Story = {
  name: 'Displaying an average',
  args: { readOnly: true },
  parameters: {
    docs: {
      description: {
        story:
          'Fractions are rendered by clipping the filled glyph, not by swapping in a half-star icon, a half-star only exists at one fraction, and an average of 4.2 is not a half. It takes no tab stop and announces as a single string, because an average is a fact, not a control.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md space-y-3">
      {(
        [
          ['Interview panel', 4.2, 12],
          ['Onboarding survey', 3.6, 48],
          ['Manager feedback', 4.9, 7],
          ['Tooling satisfaction', 2.1, 96],
        ] as const
      ).map(([name, score, responses]) => (
        <div key={name} className="flex items-center justify-between gap-4">
          <span className="text-base text-fg">{name}</span>
          <span className="flex items-center gap-2">
            <Rating {...args} label={name} value={score} showValue />
            <span className="text-xs text-fg-subtle">({responses})</span>
          </span>
        </div>
      ))}
    </div>
  ),
};

export const Symbols: Story = {
  name: 'Sizes and symbols',
  parameters: {
    docs: {
      description: {
        story:
          'The symbol is swappable, and the scale need not be five. A flame or a heart reads as a scale; an arbitrary glyph does not, if a reader has to be told what the shape means, the shape is not carrying it.',
      },
    },
  },
  render: function SymbolStory(args) {
    const [values, setValues] = useState({ small: 3, large: 4, heart: 2, flame: 3, ten: 7 });
    return (
      <div className="space-y-4">
        <Rating
          {...args}
          size="sm"
          label="Small"
          value={values.small}
          onChange={(value) => {
            setValues((current) => ({ ...current, small: value }));
          }}
        />
        <Rating
          {...args}
          size="lg"
          label="Large"
          value={values.large}
          onChange={(value) => {
            setValues((current) => ({ ...current, large: value }));
          }}
        />
        <Rating
          {...args}
          label="Culture fit"
          tone="danger"
          symbol={<Heart className="size-5" />}
          value={values.heart}
          onChange={(value) => {
            setValues((current) => ({ ...current, heart: value }));
          }}
        />
        <Rating
          {...args}
          label="Urgency"
          tone="warning"
          symbol={<Flame className="size-5" />}
          value={values.flame}
          onChange={(value) => {
            setValues((current) => ({ ...current, flame: value }));
          }}
        />
        <Rating
          {...args}
          label="Likelihood to recommend"
          max={10}
          tone="accent"
          value={values.ten}
          onChange={(value) => {
            setValues((current) => ({ ...current, ten: value }));
          }}
        />
      </div>
    );
  },
};

export const InAReview: Story = {
  name: 'In a review form',
  args: { valueLabels: performance },
  parameters: {
    docs: {
      description: {
        story:
          "Where this actually lives. Note that every row uses the same five words: a calibration meeting is impossible when one manager's 4 is another's 3, and the labels are the cheapest fix available.",
      },
    },
  },
  render: function ReviewStory(args) {
    const [scores, setScores] = useState<Record<string, number>>({});
    const criteria = ['Technical depth', 'Collaboration', 'Ownership', 'Communication', 'Impact'];
    const answered = Object.values(scores).filter(Boolean).length;

    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar name="Grace Hopper" />
            <div>
              <CardTitle>Grace Hopper</CardTitle>
              <p className="text-sm text-fg-muted">Mid-year review · Principal Engineer</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {criteria.map((criterion) => (
            <div
              key={criterion}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0"
            >
              <span className="text-base text-fg">{criterion}</span>
              <Rating
                {...args}
                label={criterion}
                value={scores[criterion] ?? 0}
                onChange={(value) => {
                  setScores((current) => ({ ...current, [criterion]: value }));
                }}
              />
            </div>
          ))}
          <p aria-live="polite" className="pt-2 text-sm text-fg-muted">
            {answered} of {criteria.length} rated
          </p>
        </CardContent>
      </Card>
    );
  },
};
