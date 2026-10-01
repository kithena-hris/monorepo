import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { setShortcutKeys } from '../../lib/shortcut-keys';
import { Badge } from '../badge/badge';
import { Chip, ChipRow } from '../chip/chip';
import { IconList, IconListItem } from '../icon-list/icon-list';
import { RadioCard, RadioGroup } from '../radio-group/radio-group';
import { ScrollPosition } from '../scroll-position/scroll-position';
import { SearchField } from '../typed-fields/typed-fields';
import { AssistantCard, AssistantLabel } from './assistant';

function Prompt({
  onSearch,
  loading = false,
  initial = '',
}: {
  onSearch?: (value: string) => void;
  loading?: boolean;
  initial?: string;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <SearchField
      variant="prompt"
      label="Ask"
      shortcut="page.search"
      loading={loading}
      value={value}
      onValueChange={setValue}
      {...(onSearch ? { onSearch } : {})}
    />
  );
}

describe('the smart search bar', () => {
  it('is a search box that asks on Enter and clears on Escape', async () => {
    const onSearch = vi.fn();
    render(<Prompt onSearch={onSearch} />);
    const box = screen.getByRole('searchbox', { name: 'Ask' });
    await userEvent.type(box, 'engineers in Madrid{Enter}');
    expect(onSearch).toHaveBeenLastCalledWith('engineers in Madrid');
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(onSearch).toHaveBeenLastCalledWith('');
  });

  it('shows the app’s key while empty, and Escape and a clear button once typed in', async () => {
    setShortcutKeys({ keys: { 'page.search': ['/'] }, characterKeys: true });
    render(<Prompt />);
    expect(screen.getByText('/')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'x');
    expect(screen.queryByText('/')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Escape')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear ask' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('says it is working instead of offering to clear while loading', () => {
    render(<Prompt loading initial="people leaving soon" />);
    expect(screen.getByRole('status')).toHaveTextContent('Working it out');
    expect(screen.queryByRole('button', { name: 'Clear ask' })).not.toBeInTheDocument();
  });
});

describe('understood as', () => {
  it('is a group named by its label, with each part removable by name', () => {
    render(
      <ChipRow
        label={<AssistantLabel>Understood as</AssistantLabel>}
        action={<a href="#f">Edit as filters</a>}
      >
        <Chip field="Team" selected onRemove={vi.fn()}>
          Engineering
        </Chip>
      </ChipRow>,
    );
    const group = screen.getByRole('group', { name: 'Understood as' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Remove Team Engineering' }));
    expect(group).toContainElement(screen.getByRole('link', { name: 'Edit as filters' }));
  });
});

describe('the AI card and badge', () => {
  it('heads its content and notes where it came from', () => {
    render(
      <AssistantCard
        title="Here’s what I’d create"
        level={2}
        note="From the file’s columns."
        action={<Badge tone="assistant">AI</Badge>}
      >
        <p>Body</p>
      </AssistantCard>,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Here’s what I’d create' }),
    ).toBeInTheDocument();
    expect(screen.getByText('From the file’s columns.')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });
});

describe('a choice with its impact', () => {
  it('names the radio by its title and describes it with the impact', () => {
    render(
      <RadioGroup defaultValue="ask" aria-label="People with no value">
        <RadioCard
          value="ask"
          description="Optional for them."
          impact="14 tasks"
          badge={<Badge>Suggested</Badge>}
        >
          Ask the 14 people
        </RadioCard>
      </RadioGroup>,
    );
    const radio = screen.getByRole('radio', { name: 'Ask the 14 people' });
    expect(radio).toHaveAccessibleDescription('Optional for them.14 tasks');
  });
});

describe('icon list and scroll position', () => {
  it('reads as a list of statements', () => {
    render(
      <IconList>
        <IconListItem icon={<svg />} tone="warning" description="Median is 4%">
          A 38% raise
        </IconListItem>
      </IconList>,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('A 38% raiseMedian is 4%');
  });

  it('goes back to the top only when asked to', async () => {
    const onBackToTop = vi.fn();
    const { rerender } = render(
      <ScrollPosition onBackToTop={onBackToTop}>150 of 388</ScrollPosition>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(onBackToTop).toHaveBeenCalledOnce();
    rerender(<ScrollPosition>50 of 388</ScrollPosition>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
