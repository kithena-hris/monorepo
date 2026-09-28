import type { Meta, StoryObj } from '@storybook/react-vite';

import { Money } from '../components/money/money';
import { Stack } from '../components/layout/layout';

/**
 * The type system, as classes rather than components.
 *
 * There is no `<Text>` here on purpose. A design system that ships a text
 * component ends up with two ways to write a heading, and the one people reach
 * for is whichever they saw last. The scale is a set of utilities, so a heading
 * is an `<h2>` with a size on it and the element still says what it is to a
 * screen reader.
 */
const meta = {
  title: 'Foundations/Typography',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Sizes, weights, colours and the prose block. Every value is read from the shipped stylesheet, so this page moves when the tokens do.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The scale, largest first: the role each step plays, and the class that
 * produces it. Titles take the display face; everything read at length takes
 * the text face. Under a finger `xs`, `sm` and `base` step up by themselves, so
 * body is 17 on a phone and the phone's roles fall out of the same classes.
 */
const SCALE = [
  {
    name: '3xl',
    className: 'text-3xl font-display font-bold tracking-tight',
    use: 'Display. Hero numbers.',
  },
  {
    name: '2xl',
    className: 'text-2xl font-display font-bold tracking-tight',
    use: 'Title 1. Page titles; the large title on a phone.',
  },
  {
    name: 'xl',
    className: 'text-xl font-display font-bold tracking-tight',
    use: 'Title 2. Section titles.',
  },
  {
    name: 'lg',
    className: 'text-lg font-display font-semibold',
    use: 'Title 3. Card and dialog titles.',
  },
  { name: 'md', className: 'text-md', use: 'Body large. Intros, row titles on a phone.' },
  { name: 'base', className: 'text-base', use: 'Body. The default for everything.' },
  { name: 'sm', className: 'text-sm font-semibold', use: 'Label. Controls, column headers.' },
  { name: 'xs', className: 'text-xs', use: 'Caption. Hints, metadata, badges.' },
  { name: '2xs', className: 'text-2xs', use: 'Legal lines and dense table chrome. Sparingly.' },
] as const;

const WEIGHTS = [
  { name: 'normal', className: 'font-normal', use: 'Body copy.' },
  { name: 'medium', className: 'font-medium', use: 'Labels, the emphasised half of a pair.' },
  { name: 'semibold', className: 'font-semibold', use: 'Controls, labels that matter, numbers.' },
  { name: 'bold', className: 'font-bold', use: 'Titles, in the display face.' },
] as const;

/**
 * Two cuts of one family. The platform's own face, so a screen looks like it
 * belongs on the device it is on, and so nothing is downloaded before the first
 * word can be read.
 */
const FACES = [
  {
    name: 'font-sans',
    className: 'font-sans text-lg',
    use: 'Everything that is read: body, controls, tables.',
  },
  {
    name: 'font-display',
    className: 'font-display text-lg font-bold tracking-tight',
    use: 'Titles from `lg` up. Tighter spacing, drawn for size.',
  },
  {
    name: 'font-mono',
    className: 'font-mono text-md',
    use: 'Identifiers, tokens and code. Never for figures.',
  },
] as const;

const TONES = [
  { name: 'text-fg', className: 'text-fg', use: 'Primary. Headings, values, anything read first.' },
  { name: 'text-fg-muted', className: 'text-fg-muted', use: 'Body and supporting copy.' },
  { name: 'text-fg-subtle', className: 'text-fg-subtle', use: 'Metadata, timestamps, counts.' },
  {
    name: 'text-fg-disabled',
    className: 'text-fg-disabled',
    use: 'Inactive only. Exempt from the 4.5:1 rule, so never for live text.',
  },
  { name: 'text-accent-fg', className: 'text-accent-fg', use: 'Links.' },
  { name: 'text-danger-fg', className: 'text-danger-fg', use: 'Errors.' },
  { name: 'text-success-fg', className: 'text-success-fg', use: 'Positive change.' },
] as const;

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // Three columns when the page is wide enough, one when it is not: a
    // container query, so a phone frame on a wide monitor stacks as a phone does.
    <div className="@container border-b border-border last:border-0">
      <div className="grid items-baseline gap-1 py-3 @2xl:grid-cols-[7rem_1fr_18rem] @2xl:gap-4">
        <code className="font-mono text-xs text-accent-fg">{label}</code>
        <div className="min-w-0">{children}</div>
        <p className="text-xs text-fg-muted">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Every step, rendered at its real size.
 *
 * The sizes are rem and the tracking is em, so the whole scale follows the root
 * font size: a reader who sets their browser to 20px gets a proportional system
 * rather than a system with one part enlarged.
 */
export const Scale: Story = {
  render: () => (
    <section aria-label="Type scale">
      {SCALE.map((step) => (
        <Row key={step.name} label={step.className} hint={step.use}>
          <p className={`${step.className} text-fg`}>Employment starts on the first of March</p>
        </Row>
      ))}
    </section>
  ),
};

/** The faces. System fonts, in two optical cuts, and a monospace. */
export const Faces: Story = {
  render: () => (
    <section aria-label="Font families">
      {FACES.map((face) => (
        <Row key={face.name} label={face.name} hint={face.use}>
          <p className={`${face.className} text-fg`}>Priya Shah joined Engineering</p>
        </Row>
      ))}
    </section>
  ),
};

/**
 * Four weights, each with one job. Bold belongs to the display face; in body
 * text it shouts.
 */
export const Weights: Story = {
  render: () => (
    <section aria-label="Font weights">
      {WEIGHTS.map((weight) => (
        <Row key={weight.name} label={weight.className} hint={weight.use}>
          <p className={`text-md ${weight.className} text-fg`}>Contract updated by Priya Raman</p>
        </Row>
      ))}
    </section>
  ),
};

/**
 * The four text colours, and the one that is not for reading.
 *
 * `text-fg-disabled` is exempt from the 4.5:1 contrast rule because WCAG
 * exempts inactive controls. That exemption is the whole reason it exists, and
 * the reason it must never carry live content.
 */
export const Tones: Story = {
  render: () => (
    <section aria-label="Text tones">
      {TONES.map((tone) => (
        <Row key={tone.name} label={tone.name} hint={tone.use}>
          {tone.className === 'text-fg-disabled' ? (
            /*
             * Shown on a genuinely disabled control, not as prose.
             *
             * WCAG exempts inactive controls from the 4.5:1 rule, and that
             * exemption is the only reason this token is allowed to be as faint
             * as it is. An earlier version of this row rendered it as a live
             * paragraph, which the contrast gate caught at 2.48:1 — on the very
             * page telling people never to do that.
             */
            <button type="button" disabled className={`text-base ${tone.className}`}>
              Probation ends 14 June
            </button>
          ) : (
            <p className={`text-base ${tone.className}`}>Probation ends 14 June</p>
          )}
        </Row>
      ))}
    </section>
  ),
};

/**
 * Numbers.
 *
 * `tabular-nums` gives every digit the same advance width, so a column of
 * figures lines up and a live-updating number stops jittering. Money never
 * passes through a float: `Money` takes minor units and formats exactly.
 */
export const Numbers: Story = {
  render: () => (
    <Stack gap={6}>
      <div>
        <h3 className="text-sm font-semibold text-fg">Proportional, the default</h3>
        <ul className="mt-2 space-y-0.5 text-base text-fg-muted">
          <li>1,284</li>
          <li>911</li>
          <li>77</li>
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">
          Fine in a sentence. In a column the digits drift.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-fg">
          <code className="font-mono text-xs text-accent-fg">tabular-nums</code>
        </h3>
        <ul className="mt-2 space-y-0.5 text-base tabular-nums text-fg-muted">
          <li>1,284</li>
          <li>911</li>
          <li>77</li>
        </ul>
        <p className="mt-2 text-xs text-fg-subtle">Any column of numbers, and any live counter.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-fg">Money</h3>
        <div className="mt-2 text-base text-fg">
          <Money minorUnits="98345000" currency="EUR" />
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          Minor units in, exact string out. `Number()` loses cents at the fifteenth digit.
        </p>
      </div>
    </Stack>
  ),
};

/**
 * Long-form copy.
 *
 * `reach-prose` styles a block of markup you did not author element by element:
 * a policy document, a job description, whatever the rich text editor produced.
 * Everywhere else, set sizes on the elements themselves.
 */
export const Prose: Story = {
  render: () => (
    <div className="reach-prose max-w-2xl">
      <h2>Working time</h2>
      <p>
        Standard hours are 09:00 to 17:30 with an unpaid break of one hour. A change to a contracted
        pattern is an amendment and needs both signatures.
      </p>
      <ul>
        <li>Overtime is approved in advance, in writing.</li>
        <li>Time in lieu expires ninety days after it is earned.</li>
      </ul>
      <blockquote>
        Where a local statute sets a shorter maximum week, the statute applies.
      </blockquote>
      <p>
        See <a href="#top">the leave policy</a> for how these hours interact with accrual.
      </p>
    </div>
  ),
};

/**
 * Measure and truncation.
 *
 * A line longer than about 75 characters is measurably harder to track back
 * from, which is what `max-w-prose` is for. Truncation is the opposite problem:
 * it is a promise that the full value is available somewhere else.
 */
export const MeasureAndTruncation: Story = {
  render: () => (
    <Stack gap={6}>
      <div>
        <h3 className="text-sm font-semibold text-fg">Measure</h3>
        <p className="mt-2 max-w-prose text-base text-fg-muted">
          A tenant who buys nothing but Time Off should still get something that looks and behaves
          like the rest of the suite, which only holds if the interface vocabulary lives in one
          place. This paragraph is capped with{' '}
          <code className="font-mono text-xs">max-w-prose</code>.
        </p>
      </div>

      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-fg">One line, clipped</h3>
        <p
          className="mt-2 truncate text-base text-fg-muted"
          title="Regional Director, People Operations and Workplace Experience"
        >
          Regional Director, People Operations and Workplace Experience
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          Carries a `title`, so the full string is still reachable.
        </p>
      </div>

      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-fg">Clamped to three lines</h3>
        <p className="mt-2 line-clamp-3 text-base text-fg-muted">
          The role holder is accountable for the delivery of people services across the region,
          including onboarding, payroll liaison, benefits administration, workplace health and
          safety, and the maintenance of employee records in accordance with local statute and
          company policy.
        </p>
      </div>
    </Stack>
  ),
};
