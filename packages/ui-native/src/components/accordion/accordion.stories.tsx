import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Badge } from '../badge/badge.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion.tsx';

const meta = {
  title: 'Components/Accordion',
  component: AccordionContent,
  parameters: designDocs('accordion'),
} satisfies Meta<typeof AccordionContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Accordion type="single" defaultValue="personal">
      <AccordionItem value="personal">
        <AccordionTrigger>Personal details</AccordionTrigger>
        <AccordionContent>Name, pronouns, date of birth and home address.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="employment">
        <AccordionTrigger>Employment</AccordionTrigger>
        <AccordionContent>Team, manager, contract and start date.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="bank">
        <AccordionTrigger>Bank details</AccordionTrigger>
        <AccordionContent>Account holder, IBAN and BIC.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const MultipleOpen: Story = {
  name: 'Multiple open',
  render: () => (
    <Accordion type="multiple" defaultValue={['personal', 'employment']}>
      <AccordionItem value="personal">
        <AccordionTrigger>Personal details</AccordionTrigger>
        <AccordionContent>Name, pronouns and date of birth.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="employment">
        <AccordionTrigger>Employment</AccordionTrigger>
        <AccordionContent>Team, manager, contract and start date.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="bank">
        <AccordionTrigger>Bank details</AccordionTrigger>
        <AccordionContent>Account holder, IBAN and BIC.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const WithAStatusInTheHeader: Story = {
  name: 'With a status in the header',
  render: () => (
    <Accordion type="single" defaultValue="right-to-work">
      <AccordionItem value="personal">
        <AccordionTrigger
          meta={
            <Badge size="sm" tone="success" icon={Check}>
              Done
            </Badge>
          }
        >
          Personal details
        </AccordionTrigger>
        <AccordionContent>Name, pronouns and date of birth.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="right-to-work">
        <AccordionTrigger
          meta={
            <Badge size="sm" tone="warning">
              2 missing
            </Badge>
          }
        >
          Right to work
        </AccordionTrigger>
        <AccordionContent>
          Upload a passport or ID card, and a visa if you need one.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="bank">
        <AccordionTrigger meta={<Badge size="sm">Not started</Badge>}>
          Bank details
        </AccordionTrigger>
        <AccordionContent>Account holder, IBAN and BIC.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const ADisabledSection: Story = {
  name: 'A disabled section',
  render: () => (
    <Accordion type="single">
      <AccordionItem value="personal">
        <AccordionTrigger>Personal details</AccordionTrigger>
        <AccordionContent>Name, pronouns and date of birth.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="payroll" disabled>
        <AccordionTrigger description="Locked until your contract is signed">
          Payroll
        </AccordionTrigger>
      </AccordionItem>
      <AccordionItem value="benefits">
        <AccordionTrigger>Benefits</AccordionTrigger>
        <AccordionContent>Pension, health insurance and the bike scheme.</AccordionContent>
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
        <AccordionItem value="how-much">
          <AccordionTrigger>How much leave do I get?</AccordionTrigger>
          <AccordionContent>28 days a year, plus public holidays where you work.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="carry">
          <AccordionTrigger>Can I carry days over?</AccordionTrigger>
          <AccordionContent>Up to five days, used by the end of March.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="ill">
          <AccordionTrigger>What happens if I’m ill on holiday?</AccordionTrigger>
          <AccordionContent>
            Tell your manager the same day and the days become sick leave.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Stack>
  ),
};
