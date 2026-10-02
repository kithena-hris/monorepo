import { composeStory, type Meta, type StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import { expect } from 'storybook/test';

/**
 * The gate, tested: a story that breaks axe must fail the suite.
 *
 * #219 found axe had silently stopped running here — the setup file dropped
 * the a11y addon's annotations — and a white-on-white story with an unnamed
 * button passed. This composes exactly such a story with the project's own
 * annotations (`vitest.setup.ts` + `preview.tsx`, nothing overridden), runs
 * it, and expects axe to have failed it. If the annotations go missing, or the
 * preview's `a11y.test` stops being `'error'`, there is no failed a11y report
 * and this story fails instead.
 *
 * Only the Vitest run loads this file (`main.ts`): it is a deliberately broken
 * page and has no place in the published documentation.
 */
function Broken(): JSX.Element {
  return (
    // Near-white, not white: at exactly 1:1 axe assumes the text is meant to be
    // hidden and reports it as incomplete rather than as a violation.
    <div style={{ background: '#fff', color: '#eee', padding: 16 }}>
      <p>White on white.</p>
      {/* A finger's size, so the phone project's tap floor is not what fails. */}
      <button type="button" style={{ width: 44, height: 44 }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

const BrokenStory = composeStory({ render: () => <Broken /> }, { title: 'Gate/Broken' });

const meta = {
  title: 'Gate/Axe',
  // Off for this wrapper only: the broken markup is still on the page when its
  // own check would run, and failing that is the point, not a finding. The
  // composed story above inherits the real default.
  parameters: { a11y: { test: 'off' } },
} satisfies Meta;

export default meta;

export const FailsAViolatingStory: StoryObj = {
  render: () => <p>Axe must fail a white-on-white story with an unnamed button.</p>,
  play: async () => {
    // In a CLI run the a11y addon throws on a violation; in Storybook's own
    // test widget it only reports. The report is what both share.
    await BrokenStory.run().catch(() => undefined);
    const report = BrokenStory.reporting.reports.find((r) => r.type === 'a11y');
    await expect(report?.status).toBe('failed');
    const ids = (report?.result as { violations?: { id: string }[] } | undefined)?.violations?.map(
      (v) => v.id,
    );
    await expect(ids).toEqual(expect.arrayContaining(['color-contrast', 'button-name']));
  },
};
