import { composeStory, type Meta, type StoryObj } from '@storybook/react-native-web-vite';
import { Pressable, Text, View } from 'react-native';
import { expect } from 'storybook/test';

/**
 * The gate, tested: a story that breaks axe must fail the suite.
 *
 * As in the web Storybook (`apps/storybook/.storybook/a11y-gate.stories.tsx`):
 * a near-white-on-white label and an unnamed button, composed with the
 * project's own annotations and run, and the a11y report must say it failed.
 * If the annotations go missing, or the preview's `a11y.test` stops being
 * `'error'`, there is no failed report and this story fails instead.
 *
 * Only the Vitest run loads this file (`main.ts`).
 */
function Broken(): React.JSX.Element {
  return (
    // Literal colours on purpose: the point is a contrast no token produces.
    <View style={{ backgroundColor: '#ffffff', padding: 16 }}>
      <Text style={{ color: '#eeeeee' }}>White on white.</Text>
      <Pressable accessibilityRole="button" style={{ width: 44, height: 44 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#eeeeee' }} />
      </Pressable>
    </View>
  );
}

const BrokenStory = composeStory({ render: () => <Broken /> }, { title: 'Gate/Broken' });

const meta = {
  title: 'Gate/Axe',
  // Off for this wrapper only; the composed story inherits the real default.
  parameters: { a11y: { test: 'off' } },
} satisfies Meta;

export default meta;

export const FailsAViolatingStory: StoryObj = {
  render: () => <Text>Axe must fail a white-on-white story with an unnamed button.</Text>,
  play: async () => {
    await BrokenStory.run().catch(() => undefined);
    const report = BrokenStory.reporting.reports.find((r) => r.type === 'a11y');
    await expect(report?.status).toBe('failed');
    const ids = (report?.result as { violations?: { id: string }[] } | undefined)?.violations?.map(
      (v) => v.id,
    );
    await expect(ids).toEqual(expect.arrayContaining(['color-contrast', 'button-name']));
  },
};
