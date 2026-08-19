import type { Meta, StoryObj } from '@storybook/react-vite';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { Badge } from '../components/badge/badge';
import { Button } from '../components/button/button';
import { Card } from '../components/card/card';
import { Skeleton } from '../components/feedback/feedback';
import { Progress } from '../components/progress/progress';
import { Switch } from '../components/switch/switch';
import { motionDurations, motionEasings, motionSprings, resolveToken } from '../tokens/index';

/*
 * Module constants, not values built during render: a new array identity each
 * render would re-run the effect that reads them, whose setState would render
 * again, until React gave up with "Maximum update depth exceeded".
 */
const durationNames = [...motionDurations];
const easingNames = [...motionEasings];
const springDurationNames = motionSprings.map((spring) => spring.duration);

function useResolved(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues(Object.fromEntries(names.map((name) => [name, resolveToken(name)])));
  }, [names]);
  return values;
}

/**
 * Everything on this page animates on demand rather than on a loop. A page of
 * looping animations is unreadable, and: more to the point. It cannot be
 * compared: the only way to tell 140ms from 200ms is to start them together.
 */
function Replay({
  children,
  label = 'Play again',
}: {
  children: (key: number) => ReactNode;
  label?: string;
}): JSX.Element {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-3">
      {children(key)}
      <Button
        size="sm"
        variant="ghost"
        startIcon={<RotateCcw />}
        onClick={() => {
          setKey((current) => current + 1);
        }}
      >
        {label}
      </Button>
    </div>
  );
}

/*
 * The travel keyframe, shared by the easing and spring races.
 *
 * Declared by each story that uses it rather than once at module scope, because
 * every story here is also rendered in isolation by the axe suite, and a story
 * that inherited this from a sibling would animate in the docs page and sit
 * still on its own.
 *
 * `left` rather than a transform, purely so the overshoot is legible: a
 * `linear()` value above 1 interpolates past the endpoint, which carries the dot
 * visibly over the finish line. A percentage translate would be relative to the
 * dot instead of the track and could not express the same distance.
 */
function TravelKeyframes(): JSX.Element {
  return (
    <style>{`@keyframes motion-travel { from { left: 0.25rem } to { left: calc(100% - 1.25rem) } }`}</style>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-4">
      <code className="w-24 shrink-0 font-mono text-2xs text-fg-subtle">{label}</code>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const meta = {
  title: 'Foundations/Motion',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Interface motion is confirmation, not decoration.',
          '',
          '### What motion is for here',
          '',
          'Three jobs, and nothing else:',
          '',
          '1. **Confirming a cause.** A panel that slides from the right edge tells you where it came from and where it will go back to. A panel that fades in from nowhere does not.',
          "2. **Preserving continuity.** A row that highlights when it updates keeps the reader's place in a table that has just re-sorted itself.",
          '3. **Communicating progress.** A sweep says "still running"; a bar stuck at 90% says "hung".',
          '',
          'Nothing in this system animates for delight, and nothing is long enough to wait for. The slowest token is 320ms and it is reserved for something travelling the full width of a screen.',
          '',
          '### Two kinds of motion, and they use different machinery',
          '',
          'Most motion here is **predetermined**: a menu opens, a switch flips, a tab marker slides. That runs as a CSS transition, which keeps it on the compositor, so it holds its frame rate while the main thread is busy, and lets it be interrupted and retargeted rather than restarted.',
          '',
          'A little of it is **gesture-driven**: a sheet the user is dragging. That cannot be a transition, because it has to start from wherever the finger left the panel and continue at the speed the finger was moving. It is stepped frame by frame instead. See `useDragDismiss`.',
          '',
          '### Springs, and why they are `linear()`',
          '',
          'A cubic bézier has two control points, so it cannot describe a curve that passes its target and settles back. `linear()` interpolates an arbitrary list of samples, so a real spring solution can be used as an ordinary CSS easing. The four `--ease-spring-*` tokens are solved from a damping ratio and a response by `springEasing`, and a unit test re-derives them and fails if the stylesheet has drifted from the physics.',
          '',
          'Each is paired with the duration it was solved for. Using one with a different duration puts the overshoot in the wrong place.',
          '',
          '### `prefers-reduced-motion` keeps the fades and drops the movement',
          '',
          'The setting is about content **travelling** across the visual field, which is what triggers vestibular symptoms, not about change in general. So the base layer does not flatten everything: it stops transitions on `transform`, keeps opacity and colour, replaces entrance and exit keyframes with a short cross-fade, and stops anything that loops.',
          '',
          'Removing the animations outright would be worse than either, an element whose keyframe supplies its resting transform would snap to the wrong place, and a Radix component with no exit animation never unmounts.',
          '',
          'Two neighbouring settings are handled the same way. `prefers-reduced-transparency` makes every `[data-material]` surface opaque rather than merely unblurred, and `prefers-contrast: more` additionally gives it a defined border.',
          '',
          'The last story shows what a reduced-motion user actually sees.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Durations: Story = {
  name: 'Duration, side by side',
  parameters: {
    docs: {
      description: {
        story:
          'Four bars, one per duration token, started together. The comparison is the point: `instant` reads as a state change, `fast` as a response, `normal` as a movement, and `slow` as something travelling a distance. Anything longer than `slow` reads as a delay.',
      },
    },
  },
  render: function DurationStory() {
    const values = useResolved(durationNames);
    return (
      <Replay label="Run them again">
        {(key) => (
          <div className="max-w-xl space-y-4">
            {durationNames.map((name) => (
              <Row key={name} label={name.replace('--animate-duration-', '')}>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 rounded-full bg-surface-sunken">
                    <div
                      key={key}
                      className="h-full rounded-full bg-accent"
                      style={{
                        animation: `motion-sweep var(${name}) var(--ease-standard) forwards`,
                      }}
                    />
                  </div>
                  <code className="w-14 shrink-0 text-right font-mono text-2xs text-fg-subtle">
                    {values[name]}
                  </code>
                </div>
              </Row>
            ))}
            <style>{`@keyframes motion-sweep { from { width: 0 } to { width: 100% } }`}</style>
          </div>
        )}
      </Replay>
    );
  },
};

export const Springs: Story = {
  name: 'Springs, raced',
  parameters: {
    docs: {
      description: {
        story: [
          'The four spring tokens over the same distance, each at the duration it was solved for. Watch the right-hand edge: `snap` and `move` are critically damped and stop dead on the line, while `drawer` and `flick` cross it and come back.',
          '',
          'That overshoot is the whole reason these are not bézier curves, and it is also why it is rationed. A panel that overshoots after the user flicked it reads as momentum they supplied. The same overshoot on a menu that merely opened reads as a bug.',
          '',
          '`snap` is the one to reach for by default. `flick` is only ever correct immediately after a release with real velocity behind it.',
        ].join('\n'),
      },
    },
  },
  render: function SpringStory() {
    // `springDurationNames` is a module constant for the reason at the top of
    // this file: deriving it here with `.map` would hand `useResolved` a new
    // array identity on every render, re-running its effect, whose setState
    // renders again.
    const values = useResolved(springDurationNames);

    return (
      <Replay label="Race again">
        {(key) => (
          <div className="max-w-2xl space-y-5">
            {motionSprings.map((spring) => (
              <Row key={spring.easing} label={spring.easing.replace('--ease-spring-', '')}>
                <div className="flex items-center gap-3">
                  {/* `overflow-visible` matters: an under-damped spring travels
                      past 100% and a clipped track would hide the very thing
                      this story exists to show. */}
                  <div className="relative h-6 flex-1 overflow-visible rounded-full bg-surface-sunken">
                    {/* The finish line, so the overshoot is measurable rather
                        than merely felt. */}
                    <div className="absolute inset-y-0 right-0 w-px bg-border-strong" />
                    <div
                      key={key}
                      className="absolute top-1 left-1 size-4 rounded-full bg-accent"
                      style={{
                        animation: `motion-travel var(${spring.duration}) var(${spring.easing}) forwards`,
                      }}
                    />
                  </div>
                  <code className="w-14 shrink-0 text-right font-mono text-2xs text-fg-subtle">
                    {values[spring.duration]}
                  </code>
                </div>
              </Row>
            ))}
            <TravelKeyframes />
          </div>
        )}
      </Replay>
    );
  },
};

export const Easings: Story = {
  name: 'Easing, raced',
  parameters: {
    docs: {
      description: {
        story:
          'Three dots over the same distance in the same time, on the three easing curves: plus `linear` for contrast. `entrance` decelerates hard into place, which is what makes an arriving panel feel like it settled rather than stopped. `exit` accelerates away, because something leaving does not need to be watched. `linear` looks mechanical, which is why nothing in the system uses it except an indeterminate sweep.',
      },
    },
  },
  render: function EasingStory() {
    const values = useResolved(easingNames);
    const curves = [
      ...easingNames.map((name) => ({ name: name.replace('--ease-', ''), value: `var(${name})` })),
      { name: 'linear', value: 'linear' },
    ];

    return (
      <Replay label="Race again">
        {(key) => (
          <div className="max-w-2xl space-y-5">
            {curves.map((curve) => (
              <Row key={curve.name} label={curve.name}>
                <div className="relative h-6 rounded-full bg-surface-sunken">
                  <div
                    key={key}
                    className="absolute top-1 size-4 rounded-full bg-accent"
                    style={{
                      animation: `motion-travel 900ms ${curve.value} forwards`,
                    }}
                  />
                </div>
              </Row>
            ))}
            <div className="space-y-1 pt-2">
              {easingNames.map((name) => (
                <p key={name} className="font-mono text-2xs text-fg-subtle">
                  {name} · {values[name]}
                </p>
              ))}
            </div>
            <TravelKeyframes />
          </div>
        )}
      </Replay>
    );
  },
};

export const Entrances: Story = {
  name: 'Entrances and exits',
  parameters: {
    docs: {
      description: {
        story:
          'The named animations, on real surfaces. Note the asymmetry: entrances use `entrance` at `normal`, exits use `exit` at `fast`. Something arriving deserves to be watched; something leaving does not, and a slow exit is the single most common way an interface starts to feel sluggish.',
      },
    },
  },
  render: function EntranceStory() {
    const animations = [
      ['fade-in', 'animate-fade-in'],
      ['scale-in', 'animate-scale-in'],
      ['slide-up', 'animate-slide-up'],
      ['slide-in-right', 'animate-slide-in-right'],
      ['slide-in-bottom', 'animate-slide-in-bottom'],
      ['collapse-down', 'animate-collapse-down'],
    ] as const;

    return (
      <Replay label="Play them again">
        {(key) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {animations.map(([name, className]) => (
              <div key={name} className="space-y-2 overflow-hidden">
                <code className="font-mono text-2xs text-fg-subtle">{name}</code>
                <Card key={key} padded className={`${className} text-sm text-fg-muted`}>
                  Leave approved. 3 days from 14 September.
                </Card>
              </div>
            ))}
          </div>
        )}
      </Replay>
    );
  },
};

export const StateTransitions: Story = {
  name: 'State, not just entrance',
  parameters: {
    docs: {
      description: {
        story:
          'The motion people actually see all day is not an entrance. It is a control changing state. Hover the button, focus it from the keyboard, flip the switch, drag the slider thumb. Every one of these is 80–140ms on the standard curve, short enough that it registers as responsiveness rather than as animation.',
      },
    },
  },
  render: () => (
    <div className="max-w-xl space-y-6">
      <Row label="button">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Hover me</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" loading>
            Submitting
          </Button>
        </div>
      </Row>
      <Row label="switch">
        <div className="flex items-center gap-3">
          <Switch aria-label="Motion demo switch" />
          <span className="text-sm text-fg-muted">
            The thumb translates; the track cross-fades. Two properties, one duration.
          </span>
        </div>
      </Row>
      <Row label="progress">
        <Progress value={64} label="Onboarding tasks" showValue />
      </Row>
      <Row label="badge">
        <div className="flex gap-2">
          <Badge tone="success" dot>
            Approved
          </Badge>
          <Badge tone="warning" dot>
            Awaiting manager
          </Badge>
        </div>
      </Row>
    </div>
  ),
};

export const LoadingMotion: Story = {
  name: 'Loading',
  parameters: {
    docs: {
      description: {
        story:
          'The two loops in the system, and the rule for both: a loop is only honest while something is genuinely happening. The shimmer sweeps at 1.6s: slow enough not to strobe, fast enough to read as activity, and the indeterminate bar sweeps at 1.4s. Anything faster than about a second reads as anxiety.',
      },
    },
  },
  render: () => (
    <div className="max-w-xl space-y-6">
      <Row label="skeleton">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Row>
      <Row label="indeterminate">
        <Progress value={null} label="Connecting to Workday" />
      </Row>
    </div>
  ),
};

export const ReducedMotion: Story = {
  name: 'Under reduced motion',
  parameters: {
    docs: {
      description: {
        story: [
          'The same three entrances as a reduced-motion user sees them: each becomes a short cross-fade, and none of them travels.',
          '',
          'Compare with the row above. `scale-in` and `slide-up` still *arrive*, they just arrive without moving through space, which is the distinction the setting is actually asking for. Nothing is missing, because no information lived in the movement. That is the test: if turning motion off loses meaning, the meaning was in the wrong place.',
          '',
          'This story hard-codes the substitution so it is visible with the OS setting off. The real rule lives in the base layer and applies to every component at once.',
        ].join('\n'),
      },
    },
  },
  render: function ReducedStory() {
    return (
      <Replay label="Play them again">
        {(key) => (
          <div className="grid gap-4 sm:grid-cols-3">
            {(['animate-fade-in', 'animate-scale-in', 'animate-slide-up'] as const).map((name) => (
              <div key={name} className="space-y-2">
                <code className="font-mono text-2xs text-fg-subtle">{name}</code>
                <Card
                  key={key}
                  padded
                  // Deliberately *not* the class the label names. The base layer
                  // swaps the animation for a fade rather than shortening it, so
                  // showing a 0.01ms `slide-up` here would misreport what the
                  // system does: it would still travel, just too fast to see,
                  // and travelling is the thing the setting rules out.
                  className="animate-fade-in text-sm text-fg-muted"
                  style={{ animationDuration: 'var(--animate-duration-fast)' }}
                >
                  Leave approved.
                </Card>
              </div>
            ))}
          </div>
        )}
      </Replay>
    );
  },
};
