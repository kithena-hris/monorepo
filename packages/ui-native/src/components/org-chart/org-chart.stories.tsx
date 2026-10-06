import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Eye } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Alert } from '../feedback/feedback.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';
import { OrgChart, type OrgNode } from './org-chart.tsx';

const meta = {
  title: 'Charts/Org chart',
  component: OrgChart,
  parameters: designDocs('org-chart'),
} satisfies Meta<typeof OrgChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The design's company: a chief executive, three leaders, their teams and one open role. */
const company: OrgNode[] = [
  { id: 'nora', name: 'Nora Becker', title: 'Chief Executive' },
  { id: 'jonas', name: 'Jonas Weber', title: 'CTO', parentId: 'nora' },
  { id: 'priya', name: 'Priya Shah', title: 'Senior Engineer', parentId: 'jonas' },
  { id: 'omar', name: 'Omar Haddad', title: 'Backend Engineer', parentId: 'jonas' },
  { id: 'yuki', name: 'Yuki Sato', title: 'iOS Engineer', parentId: 'jonas' },
  { id: 'zara', name: 'Zara Ahmed', title: 'CFO', parentId: 'nora' },
  { id: 'mei', name: 'Mei Tanaka', title: 'Data Analyst', parentId: 'zara' },
  { id: 'tom', name: 'Tom Fischer', title: 'VP Sales', parentId: 'nora' },
  { id: 'lucas', name: 'Lucas Moreau', title: 'Account Executive', parentId: 'tom' },
  { id: 'open-se', name: '', title: 'Sales Engineer', parentId: 'tom', vacant: true },
];

const base = { label: 'Reporting lines', nodes: company };

export const Playground: Story = { args: base };

export const PanAndZoom: Story = {
  name: 'Pan and zoom',
  parameters: designNote('org-chart', 'Pan and zoom'),
  args: base,
};

function Searching(): React.JSX.Element {
  const [query, setQuery] = useState('Mei');
  const found = company.filter((n) => query && n.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Stack gap={3}>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <SearchField value={query} onValueChange={setQuery} label="Find a person" />
        </View>
        <Badge>{`${String(found.length)} match${found.length === 1 ? '' : 'es'}`}</Badge>
      </View>
      <OrgChart label="Reporting lines" nodes={company} query={query} />
    </Stack>
  );
}

export const SearchFocusAndTheChain: Story = {
  name: 'Search, focus and the chain',
  parameters: designNote('org-chart', 'Search, focus and the chain'),
  args: base,
  render: () => <Searching />,
};

export const ReadOnlyForEveryoneElse: Story = {
  name: 'Read-only for everyone else',
  args: base,
  render: () => (
    <Stack gap={3}>
      <Alert tone="info" icon={Eye} title="You’re viewing, not editing">
        Only People admins can change reporting lines.
      </Alert>
      <OrgChart label="Reporting lines" nodes={company} viewerRole="viewer" reassignable />
    </Stack>
  ),
};

function Opening({ initial }: { initial: string }): React.JSX.Element {
  const [selected, setSelected] = useState(initial);
  return (
    <OrgChart
      label="Reporting lines"
      nodes={company}
      selectedId={selected}
      onSelect={(node) => {
        setSelected(node.id);
      }}
    />
  );
}

export const NothingMovesUnderThePointer: Story = {
  name: 'Nothing moves under the pointer',
  parameters: designNote('org-chart', 'Nothing moves under the pointer'),
  args: base,
  render: () => <Opening initial="omar" />,
};

function Moving(): React.JSX.Element {
  const [nodes, setNodes] = useState(company);
  return (
    <OrgChart
      label="Reporting lines"
      nodes={nodes}
      viewerRole="hr-admin"
      reassignable
      onReassign={(move) => {
        setNodes((current) =>
          current.map((n) => (n.id === move.nodeId ? { ...n, parentId: move.toParentId } : n)),
        );
      }}
    />
  );
}

export const DragToChangeAReportingLine: Story = {
  name: 'Drag to change a reporting line',
  parameters: designNote('org-chart', 'Drag to change a reporting line'),
  args: base,
  render: () => <Moving />,
};

function Driving(): React.JSX.Element {
  const [selected, setSelected] = useState<OrgNode | undefined>(company[1]);
  const reports = company.filter((n) => n.parentId === selected?.id).length;
  return (
    <Stack gap={3}>
      <OrgChart
        label="Reporting lines"
        nodes={company}
        {...(selected ? { selectedId: selected.id } : {})}
        onSelect={setSelected}
      />
      {selected ? (
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <Avatar name={selected.name || 'Open role'} size={44} decorative />
            <View className="flex-1">
              <Text weight="semibold">{selected.name || 'Open role'}</Text>
              <Text variant="subhead" tone="muted">
                {`${selected.title ?? ''} · ${String(reports)} reports`}
              </Text>
            </View>
          </View>
          <Button size="sm" fullWidth>
            Open profile
          </Button>
        </Card>
      ) : null}
    </Stack>
  );
}

export const DrivingSomethingElse: Story = {
  name: 'Driving something else',
  args: base,
  render: () => <Driving />,
};

export const VerticalAndHorizontal: Story = {
  name: 'Vertical and horizontal',
  args: base,
  render: () => (
    <Stack gap={3}>
      <OrgChart label="Reporting lines" nodes={company} />
      <Text variant="subhead" tone="muted">
        On a phone both directions become the indented list.
      </Text>
    </Stack>
  ),
};

export const SelectingAPerson: Story = {
  name: 'Selecting a person',
  parameters: designNote('org-chart', 'Selecting a person'),
  args: base,
  render: () => <Opening initial="priya" />,
};

export const CustomCards: Story = {
  name: 'Custom cards',
  args: {
    label: 'Engineering',
    nodes: company,
    renderNode: (node, info) => (
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <Text variant="subhead" weight="semibold" numberOfLines={1}>
            {node.name || 'Open role'}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {node.title ?? ''}
          </Text>
        </View>
        {info.reports > 0 ? <Badge size="sm">{`${String(info.total)} in branch`}</Badge> : null}
      </View>
    ),
  },
};

export const ACircularReportingLine: Story = {
  name: 'A circular reporting line',
  args: base,
  render: () => (
    <Stack gap={3}>
      <Alert tone="danger" title="This would create a loop">
        Jonas reports to Nora. Nora can’t report to Priya, because Priya reports to Jonas.
      </Alert>
      <OrgChart label="Reporting lines" nodes={company} flaggedIds={['nora', 'jonas', 'priya']} />
    </Stack>
  ),
};

const departments: OrgNode[] = [
  { id: 'nora', name: 'Nora Becker', title: 'Chief Executive' },
  {
    id: 'jonas',
    name: 'Jonas Weber',
    title: 'Engineering · 124',
    parentId: 'nora',
    reportCount: 6,
  },
  { id: 'tom', name: 'Tom Fischer', title: 'Sales · 64', parentId: 'nora', reportCount: 4 },
  { id: 'zara', name: 'Zara Ahmed', title: 'Finance · 26', parentId: 'nora', reportCount: 2 },
  { id: 'sofia', name: 'Sofia Lindqvist', title: 'People · 22', parentId: 'nora', reportCount: 2 },
];

export const DepartmentsCollapsed: Story = {
  name: 'Departments, collapsed',
  parameters: designNote('org-chart', 'Departments, collapsed'),
  args: {
    label: 'Departments',
    nodes: departments,
    defaultCollapsed: ['jonas', 'tom', 'zara', 'sofia'],
  },
};

export const SpanOfControlAndVacancies: Story = {
  name: 'Span of control and vacancies',
  parameters: designNote('org-chart', 'Span of control and vacancies'),
  args: {
    label: 'Engineering leadership',
    nodes: [
      { id: 'jonas', name: 'Jonas Weber', title: 'CTO · 3 direct' },
      {
        id: 'priya',
        name: 'Priya Shah',
        title: 'Lead · 8 direct',
        parentId: 'jonas',
        status: 'Over 7',
        statusTone: 'danger',
      },
      { id: 'omar', name: 'Omar Haddad', title: 'Lead · 4 direct', parentId: 'jonas' },
      { id: 'open-ml', name: '', title: 'Mobile Lead', parentId: 'jonas', vacant: true },
    ],
  },
};
