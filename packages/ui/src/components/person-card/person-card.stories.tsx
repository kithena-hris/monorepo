import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail, MapPin, MessageCircle } from 'lucide-react';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { PersonCard } from './person-card';

const meta = {
  title: 'Components/Person card',
  component: PersonCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A person, in a grid or a list. Their status shows as a dot on the avatar with `statusLabel` in words, and absence as a line of text. With `href` the whole card is one link and its actions stay targets of their own.',
      },
    },
  },
  args: { name: 'Adam Novak', description: 'Backend engineer' },
} satisfies Meta<typeof PersonCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const people = [
  {
    name: 'Adam Novak',
    description: 'Backend engineer',
    team: 'Engineering',
    place: 'Madrid',
    status: 'success' as const,
    label: 'Active',
  },
  {
    name: 'Lucía Fernández',
    description: 'Product designer',
    team: 'Design',
    place: 'Barcelona',
    status: 'info' as const,
    label: 'On leave',
    note: 'Back 21 Oct',
  },
  {
    name: 'Omar Haddad',
    description: 'Frontend engineer',
    team: 'Engineering',
    place: 'Remote',
    status: 'success' as const,
    label: 'Active',
  },
];

export const Grid: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-3">
      {people.map((p) => (
        <PersonCard
          key={p.name}
          name={p.name}
          description={p.description}
          status={p.status}
          statusLabel={p.label}
          {...(p.note === undefined ? {} : { note: p.note })}
          badges={
            <>
              <Badge size="sm">{p.team}</Badge>
              <Badge size="sm">
                <MapPin aria-hidden />
                {p.place}
              </Badge>
            </>
          }
          actions={
            <>
              <Button
                size="xs"
                aria-label={`Message ${p.name}`}
                startIcon={<MessageCircle aria-hidden />}
              />
              <Button size="xs" aria-label={`Email ${p.name}`} startIcon={<Mail aria-hidden />} />
              <Button size="xs">Profile</Button>
            </>
          }
        />
      ))}
    </div>
  ),
};

export const Row: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2">
      <PersonCard
        layout="row"
        name="Adam Novak"
        description="Backend engineer"
        status="success"
        statusLabel="Active"
        href="#adam"
      />
      <PersonCard
        layout="row"
        name="Lucía Fernández"
        description="Product designer"
        note="On leave until 21 Oct"
        status="info"
        statusLabel="On leave"
        href="#lucia"
        selected
      />
    </div>
  ),
};
