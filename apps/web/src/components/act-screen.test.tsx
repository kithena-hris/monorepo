// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * What a Recruiting or Onboarding screen is handed by the shell. The screen
 * is a remote; here it is a stand-in that keeps its props.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../app/(app)/recruiting/actions', () => ({ recruitingAct: vi.fn() }));
vi.mock('../app/(app)/onboarding/actions', () => ({ onboardingAct: vi.fn() }));
vi.mock('./app-shell', () => ({ useShellData: () => ({ sections: [], remotes: {} }) }));
let shown: Record<string, unknown> = {};
vi.mock('./remote-screen', () => ({
  RemoteScreen: ({ props }: { props: Record<string, unknown> }) => {
    shown = props;
    return null;
  },
}));

const { RecruitingScreen } = await import('./act-screen');

afterEach(cleanup);

describe('a Recruiting screen', () => {
  it('is handed the route\'s params and query, so "new" is not taken for a job to load', () => {
    render(
      <RecruitingScreen
        route={{ entry: 'x', component: 'JobSetup' }}
        load={{ status: 'none' }}
        frame={undefined as never}
        params={{ id: 'new' }}
        search={{ requisition: 'r1' }}
      />,
    );
    expect(shown['params']).toEqual({ id: 'new' });
    expect(shown['search']).toEqual({ requisition: 'r1' });
  });
});
