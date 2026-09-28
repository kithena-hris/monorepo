import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX, type ReactNode } from 'react';

import { Skeleton } from '../feedback/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs/tabs';
import { TertiaryNav, type TertiaryNavItem } from './nav';
import { TertiaryNavMenu } from './tertiary-nav-menu';

const meta: Meta = {
  title: 'Components/Tertiary navigation',
  component: TertiaryNav,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Moves between sections of one page. The sidebar is primary and tabs are secondary; this is the third level, usually a local list on the left.',
          '',
          'On a phone it’s a scrolling row of pills under the title (`touchLayout="pills"`), or a list you drill into (`touchLayout="list"`). Where there is no room for a column at all, `TertiaryNavMenu` folds it into a menu in the page header.',
          '',
          '`current="location"` (the default) for a table of contents, where the page has not changed and the reader’s place in it has; `current="page"` with `href` for sections that are pages of a record. A screen reader says which.',
        ].join('\n'),
      },
    },
  },
};

export default meta;
type Story = StoryObj;

/** The design's frame: a surface column beside skeleton content. */
function Frame({ nav }: { nav: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-90 overflow-hidden rounded-lg border border-border bg-canvas touch:min-h-0 touch:flex-col touch:border-0 touch:bg-transparent">
      <div className="w-55 shrink-0 border-e border-border bg-surface px-2.5 py-3.5 touch:w-full touch:border-0 touch:bg-transparent touch:p-0">
        {nav}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 touch:px-0">
        <Skeleton className="h-4.5 w-2/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-22 w-full" />
      </div>
    </div>
  );
}

const record: TertiaryNavItem[] = [
  'Personal',
  'Employment',
  'Pay',
  'Time off',
  'Documents',
  'Access',
].map((label) => {
  const id = label.toLowerCase().replace(' ', '-');
  return { id, label, href: `#record-${id}` };
});

export const Playground: Story = {
  render: function Render() {
    const [active, setActive] = useState('employment');
    return (
      <Frame
        nav={
          <TertiaryNav
            label="Priya Shah"
            title="Priya Shah"
            items={record}
            activeId={active}
            onSelect={setActive}
            current="page"
            touchLayout="pills"
          />
        }
      />
    );
  },
};

/** Line tabs for the area, and pills for the view inside it. Never two rows of line tabs. */
export const UnderPrimaryTabs: Story = {
  render: () => (
    <Tabs defaultValue="time-off" className="flex flex-col gap-3">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="time-off">Time off</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
      <TabsContent value="time-off" className="flex flex-col gap-3">
        <TertiaryNav
          label="Time off"
          items={['Balances', 'Requests', 'Calendar', 'Policy'].map((label) => ({
            id: label.toLowerCase(),
            label,
          }))}
          activeId="requests"
          orientation="horizontal"
        />
        <Skeleton className="h-20 w-full" />
      </TabsContent>
      <TabsContent value="overview" />
      <TabsContent value="documents" />
    </Tabs>
  ),
};

/** The current section is highlighted as you scroll. Clicking one jumps to it, instantly under reduced motion. */
export const AsATableOfContents: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-6">
      <TertiaryNav
        label="On this page"
        title="On this page"
        className="w-50 touch:w-full"
        activeId="how-to-request"
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'eligibility', label: 'Eligibility' },
          { id: 'how-to-request', label: 'How to request' },
          { id: 'planned-leave', label: 'Planned leave', depth: 1 },
          { id: 'emergencies', label: 'Emergencies', depth: 1 },
          { id: 'carry-over', label: 'Carry-over' },
          { id: 'faq', label: 'FAQ' },
        ]}
      />
      <div className="flex min-w-65 flex-1 flex-col gap-2.5">
        <h2 className="font-display text-lg font-bold text-fg">How to request</h2>
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-11/12" />
        <Skeleton className="h-2.5 w-4/5" />
      </div>
    </div>
  ),
};

export const WithCountsAndStatus: Story = {
  render: () => (
    <Frame
      nav={
        <TertiaryNav
          label="Onboarding, Lucas"
          title="Onboarding · Lucas"
          variant="fill"
          current="page"
          touchLayout="list"
          activeId="personal"
          items={[
            { id: 'personal', label: 'Personal', status: 'success', href: '#onboarding-personal' },
            {
              id: 'right-to-work',
              label: 'Right to work',
              status: 'warning',
              href: '#onboarding-rtw',
            },
            {
              id: 'bank-details',
              label: 'Bank details',
              status: 'danger',
              href: '#onboarding-bank',
            },
            { id: 'documents', label: 'Documents', count: 12, href: '#onboarding-documents' },
            { id: 'equipment', label: 'Equipment', count: 3, href: '#onboarding-equipment' },
          ]}
        />
      }
    />
  ),
};

/** Where there is no room for a column, the sections fold into a menu in the page header. */
export const CollapsedIntoAMenu: Story = {
  render: () => (
    <TertiaryNavMenu
      label="Section"
      items={record.slice(0, 5)}
      activeId="employment"
      current="page"
    />
  ),
};
