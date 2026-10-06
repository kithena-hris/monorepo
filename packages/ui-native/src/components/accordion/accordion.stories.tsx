import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Badge } from '../badge/badge.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Accordion, AccordionItem } from './accordion.tsx';

const meta = {
  title: 'Components/Accordion',
  component: AccordionItem,
  parameters: designDocs('accordion'),
  args: { value: 'personal', title: 'Personal details' },
} satisfies Meta<typeof AccordionItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Accordion type="single" defaultValue="personal">
      <AccordionItem value="personal" title="Personal details">
        Name, pronouns, date of birth and home address.
      </AccordionItem>
      <AccordionItem value="employment" title="Employment">
        Team, manager, contract and start date.
      </AccordionItem>
      <AccordionItem value="bank" title="Bank details">
        Account holder, IBAN and BIC.
      </AccordionItem>
    </Accordion>
  ),
};

export const MultipleOpen: Story = {
  name: 'Multiple open',
  render: () => (
    <Accordion type="multiple" defaultValue={['personal', 'employment']}>
      <AccordionItem value="personal" title="Personal details">
        Name, pronouns and date of birth.
      </AccordionItem>
      <AccordionItem value="employment" title="Employment">
        Team, manager, contract and start date.
      </AccordionItem>
      <AccordionItem value="bank" title="Bank details">
        Account holder, IBAN and BIC.
      </AccordionItem>
    </Accordion>
  ),
};

export const WithAStatusInTheHeader: Story = {
  name: 'With a status in the header',
  render: () => (
    <Accordion type="single" defaultValue="right-to-work">
      <AccordionItem
        value="personal"
        title="Personal details"
        meta={
          <Badge size="sm" tone="success" icon={Check}>
            Done
          </Badge>
        }
      >
        Name, pronouns and date of birth.
      </AccordionItem>
      <AccordionItem
        value="right-to-work"
        title="Right to work"
        meta={
          <Badge size="sm" tone="warning">
            2 missing
          </Badge>
        }
      >
        Upload a passport or ID card, and a visa if you need one.
      </AccordionItem>
      <AccordionItem value="bank" title="Bank details" meta={<Badge size="sm">Not started</Badge>}>
        Account holder, IBAN and BIC.
      </AccordionItem>
    </Accordion>
  ),
};

export const ADisabledSection: Story = {
  name: 'A disabled section',
  render: () => (
    <Accordion type="single">
      <AccordionItem value="personal" title="Personal details">
        Name, pronouns and date of birth.
      </AccordionItem>
      <AccordionItem
        value="payroll"
        title="Payroll"
        description="Locked until your contract is signed"
        disabled
      />
      <AccordionItem value="benefits" title="Benefits">
        Pension, health insurance and the bike scheme.
      </AccordionItem>
    </Accordion>
  ),
};

export const DirectlyUnderThePageTitle: Story = {
  name: 'Directly under the page title',
  render: () => (
    <Stack gap={2} className="gap-2.5">
      <Text variant="title1" weight="bold">
        Leave policy
      </Text>
      <Text variant="subhead" tone="muted" className="leading-[1.5]">
        Updated 1 Sep 2026
      </Text>
      <Accordion type="single" defaultValue="how-much">
        <AccordionItem value="how-much" title="How much leave do I get?">
          28 days a year, plus public holidays where you work.
        </AccordionItem>
        <AccordionItem value="carry" title="Can I carry days over?">
          Up to five days, used by the end of March.
        </AccordionItem>
        <AccordionItem value="ill" title="What happens if I’m ill on holiday?">
          Tell your manager the same day and the days become sick leave.
        </AccordionItem>
      </Accordion>
    </Stack>
  ),
};
