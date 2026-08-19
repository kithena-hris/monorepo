import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '../badge/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Progressive disclosure for a record with many independent sections.',
          '',
          '### The cost, stated plainly',
          '',
          "Collapsed content is not reachable by the browser's find-in-page, is not printed, and is not indexed. Three collapsed sections are *slower* to read than one long page, because the reader has to decide what to open before they can decide what to read.",
          '',
          'So the test is whether the sections are genuinely independent. Tax details and bank details qualify: an admin fixing an IBAN has no interest in the tax code. "Personal information", split into six panels because the page felt long, does not.',
          '',
          '### Single or multiple',
          '',
          '| `type` | Behaviour | Use for |',
          '| --- | --- | --- |',
          '| `single` | Opening one closes the others | A wizard-like read, where one section at a time is the point |',
          '| `multiple` | Panels open independently | Reference content the user compares across sections |',
          '',
          '`collapsible` only applies to `single`, and controls whether the open panel can be closed again: leaving one always open avoids an empty-looking page.',
          '',
          '### Motion',
          '',
          'The collapse animates against `--radix-accordion-content-height`, which the primitive measures. `height: auto` is not animatable, which is why hand-rolled accordions either jump or hard-code a wrong height.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    type: {
      description:
        'Whether one panel is open at a time (`single`) or any number (`multiple`). Changes the underlying ARIA pattern, so it is not purely cosmetic.',
      control: 'inline-radio',
      options: ['single', 'multiple'],
      table: {
        type: { summary: "'single' | 'multiple'" },
        defaultValue: { summary: 'single' },
        category: 'Behaviour',
      },
    },
    collapsible: {
      description:
        'In `single` mode, allows the open panel to be closed, leaving none open. Ignored in `multiple` mode.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    defaultValue: {
      description: 'Uncontrolled starting state. A string for `single`, an array for `multiple`.',
      control: 'text',
      table: { type: { summary: 'string | string[]' }, category: 'State' },
    },
    value: {
      description: 'Controlled open state. Pair with `onValueChange`.',
      control: false,
      table: { type: { summary: 'string | string[]' }, category: 'State' },
    },
    onValueChange: {
      description: 'Fires with the new open value(s).',
      control: false,
      table: { type: { summary: '(value: string | string[]) => void' }, category: 'State' },
    },
    disabled: {
      description: 'Disables every trigger in the group.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    dir: {
      description: 'Text direction. Mirrors the chevron and the arrow-key order.',
      control: 'inline-radio',
      options: ['ltr', 'rtl'],
      table: {
        type: { summary: "'ltr' | 'rtl'" },
        defaultValue: { summary: 'ltr' },
        category: 'Behaviour',
      },
    },
    orientation: {
      description: 'Which arrow keys move between triggers.',
      control: 'inline-radio',
      options: ['vertical', 'horizontal'],
      table: {
        type: { summary: "'vertical' | 'horizontal'" },
        defaultValue: { summary: 'vertical' },
        category: 'Behaviour',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    type: 'single',
    collapsible: true,
    defaultValue: 'employment',
    disabled: false,
  },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const sections = [
  {
    value: 'employment',
    title: 'Employment',
    meta: 'Effective 1 Sep 2026',
    body: 'Staff Engineer, Platform. Full time, 40 hours. Reports to Radia Perlman. Probation ended 12 March 2025.',
  },
  {
    value: 'compensation',
    title: 'Compensation',
    meta: '€128,500',
    body: 'Base €128,500 · Bonus target 15% · Equity 4,000 RSU vesting quarterly. Next review 1 January 2027.',
  },
  {
    value: 'tax',
    title: 'Tax and social security',
    meta: 'ES',
    body: 'Spanish tax residency. IRPF withholding 31%. Social security number on file, verified 4 February 2026.',
  },
  {
    value: 'bank',
    title: 'Bank details',
    meta: '•••• 4471',
    body: 'IBAN ending 4471, verified by micro-deposit on 8 January 2026. Changes require re-verification.',
  },
];

const renderSections: NonNullable<Story['render']> = (args) => (
  <div className="mx-auto max-w-xl">
    <Accordion {...args}>
      {sections.map((section) => (
        <AccordionItem key={section.value} value={section.value}>
          <AccordionTrigger meta={section.meta}>{section.title}</AccordionTrigger>
          <AccordionContent>{section.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  </div>
);

export const Playground: Story = { render: renderSections };

export const Multiple: Story = {
  name: 'Multiple open',
  args: { type: 'multiple', defaultValue: ['employment', 'compensation'] },
  parameters: {
    docs: {
      description: {
        story:
          'Reference content the reader compares across sections. Note that `collapsible` no longer applies, in this mode every panel closes independently anyway.',
      },
    },
  },
  render: renderSections,
};

export const WithStatus: Story = {
  name: 'With a status in the header',
  args: { type: 'multiple', defaultValue: [] },
  parameters: {
    docs: {
      description: {
        story:
          'The summary in the header is what makes a collapsed accordion usable: it answers "is there anything wrong in here?" without opening four panels. Keep it to a value or a status, never a sentence.',
      },
    },
  },
  render: (args) => (
    <div className="mx-auto max-w-xl">
      <Accordion {...args}>
        <AccordionItem value="identity">
          <AccordionTrigger
            meta={
              <Badge tone="success" size="sm" dot>
                Complete
              </Badge>
            }
          >
            Identity
          </AccordionTrigger>
          <AccordionContent>
            Passport verified 3 February 2026. Right to work on file.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="bank">
          <AccordionTrigger
            meta={
              <Badge tone="warning" size="sm" dot>
                Needs review
              </Badge>
            }
          >
            Bank details
          </AccordionTrigger>
          <AccordionContent>
            IBAN changed 6 August 2026 and has not been re-verified. Payroll for September will be
            held until it is.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="emergency">
          <AccordionTrigger
            meta={
              <Badge tone="danger" size="sm" dot>
                Missing
              </Badge>
            }
          >
            Emergency contact
          </AccordionTrigger>
          <AccordionContent>No emergency contact recorded.</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};

export const Disabled: Story = {
  name: 'A disabled section',
  parameters: {
    docs: {
      description: {
        story:
          'A section the current user may not open. It stays visible rather than being removed, because "you do not have access to compensation" is information; a silently missing section reads as a bug.',
      },
    },
  },
  render: (args) => (
    <div className="mx-auto max-w-xl">
      <Accordion {...args}>
        <AccordionItem value="employment">
          <AccordionTrigger meta="Effective 1 Sep 2026">Employment</AccordionTrigger>
          <AccordionContent>{sections[0]?.body}</AccordionContent>
        </AccordionItem>
        <AccordionItem value="compensation" disabled>
          <AccordionTrigger meta="Restricted">Compensation</AccordionTrigger>
          <AccordionContent>{sections[1]?.body}</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  ),
};
