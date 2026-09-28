import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PortalContainerProvider } from '../../lib/portal-container';
import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
} from './action-sheet';

beforeAll(() => {
  // jsdom has no `matchMedia`. A mouse everywhere, so only a subtree can say
  // "finger", which is the case under test.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

function sheet(onSelect = vi.fn()) {
  return (
    <ActionSheet>
      <ActionSheetTrigger>Manage</ActionSheetTrigger>
      <ActionSheetContent title="Vacation · 14–18 Oct">
        <ActionSheetItem onSelect={onSelect}>Archive</ActionSheetItem>
        <ActionSheetItem destructive>Delete request</ActionSheetItem>
      </ActionSheetContent>
    </ActionSheet>
  );
}

describe('<ActionSheet>', () => {
  it('is a menu at a desk', async () => {
    render(sheet());
    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
  });

  it('is a dialog with Cancel apart under a finger, and an action closes it', async () => {
    const container = document.createElement('div');
    container.dataset['pointer'] = 'coarse';
    document.body.append(container);
    const onSelect = vi.fn();
    render(
      <PortalContainerProvider container={container}>{sheet(onSelect)}</PortalContainerProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    const dialog = await screen.findByRole('dialog', { name: 'Vacation · 14–18 Oct' });
    expect(container).toContainElement(dialog);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    container.remove();
  });
});
