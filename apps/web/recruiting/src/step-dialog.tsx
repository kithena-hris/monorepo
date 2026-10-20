import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Stepper,
  cn,
  springEasing,
  springSettleTime,
  springs,
} from '@reach/ui';
import { durations, easings } from '@reach/ui/motion';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * A centred dialog with steps (design principle: "steps in a centred dialog"):
 * a step bar, the step's body, and Back or Cancel beside Next or the last
 * step's own button.
 */
export function StepDialog({
  open,
  onClose,
  title,
  description,
  steps,
  step,
  onStep,
  children,
  finish,
  finishLabel,
  pending,
  canNext = true,
  wide,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly steps: readonly string[];
  readonly step: number;
  readonly onStep: (step: number) => void;
  readonly children: ReactNode;
  readonly finish: () => void;
  readonly finishLabel: string;
  readonly pending?: boolean;
  readonly canNext?: boolean;
  readonly wide?: boolean;
}): JSX.Element {
  const lastStep = step === steps.length - 1;
  const dock = useDock();
  // A new step starts at its top, wherever the last one was scrolled to.
  const shown = useRef(step);
  useLayoutEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    dock.place.current?.parentElement?.scrollTo({ top: 0 });
  }, [step, dock.place]);
  const bar = (compact: boolean) => (
    <Stepper
      label={`${title} steps`}
      size="sm"
      variant={compact ? 'compact' : 'default'}
      free
      current={step}
      onStepChange={(i) => {
        onStep(i);
      }}
      steps={steps.map((s, i) => ({
        id: String(i),
        label: s,
        status: i < step ? 'complete' : i === step ? 'current' : 'upcoming',
      }))}
    />
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* One height for every step, so the dialog never jumps between them: the
          body scrolls inside it. Under a thumb the dialog is the screen. */}
      <DialogContent
        className={cn(
          wide === true ? 'max-w-4xl' : 'max-w-2xl',
          'h-[min(48rem,calc(100dvh-4rem))] touch:h-auto',
        )}
        // Focus opens on the dialog itself, not its first step, which drew a
        // focus ring round Basics nobody had asked for. Tab reaches it first.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-4">
            <DialogTitle className="min-w-0 truncate">{title}</DialogTitle>
            {/* The bar, docked here while its place is scrolled away. */}
            <div
              ref={dock.docked}
              aria-hidden={!dock.isDocked}
              inert={!dock.isDocked}
              className={cn('ms-auto shrink-0', !dock.isDocked && 'opacity-0')}
            >
              {bar(true)}
            </div>
          </div>
          {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div ref={dock.attach}>
            <div
              aria-hidden={dock.isDocked}
              inert={dock.isDocked}
              className={cn(
                'transition-[opacity,translate] motion-reduce:transition-none',
                dock.isDocked
                  ? 'pointer-events-none -translate-y-2 opacity-0 duration-(--animate-duration-fast) ease-(--ease-exit)'
                  : // Back once the docked copy has gone: one bar on screen at a time.
                    'delay-(--animate-duration-fast) duration-(--animate-duration-normal) ease-(--ease-entrance)',
              )}
            >
              {bar(false)}
            </div>
          </div>
          {children}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto self-center px-1 text-sm text-fg-muted">{`Step ${String(step + 1)} of ${String(steps.length)}`}</span>
          <Button
            variant="secondary"
            onClick={() => {
              if (step === 0) onClose();
              else onStep(step - 1);
            }}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {/* One primary per dialog, and it is the finish; Next is promoted, not primary. */}
          <Button
            variant={lastStep ? 'primary' : 'tinted'}
            loading={pending === true}
            disabled={!canNext}
            onClick={() => {
              if (lastStep) finish();
              else onStep(step + 1);
            }}
          >
            {lastStep ? finishLabel : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const curve = (points: readonly number[]): string => `cubic-bezier(${points.join(', ')})`;

/**
 * A step bar that docks beside the dialog's title once it is scrolled out of
 * the body. Docking, the copy in the header glides from where the bar was to
 * the title on the `move` spring; undocking, it slips back toward the bar's
 * place and fades out fast, and only then does the bar fade back in (its CSS
 * waits `fast`), so the two are never on screen together. Reduced motion
 * swaps them without travel. Under a thumb the bar stays where it is: the
 * header has no room beside the title. (`seen` is false on the server, so
 * `matchMedia` is only reached in a browser.)
 */
function useDock(): {
  readonly isDocked: boolean;
  readonly place: RefObject<HTMLDivElement | null>;
  /** The bar's place: observed from when it is in the page, not from mount. */
  readonly attach: (el: HTMLDivElement | null) => void;
  readonly docked: RefObject<HTMLDivElement | null>;
} {
  // A callback ref, not `useInView`'s: the dialog's portal draws its content a
  // render after the dialog mounts, so an observer set up on mount found no
  // element and the bar never docked.
  const place = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const watching = useRef<IntersectionObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    watching.current?.disconnect();
    watching.current = null;
    place.current = el;
    if (el === null) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (entry !== undefined) setInView(entry.isIntersecting);
    });
    seen.observe(el);
    watching.current = seen;
  }, []);
  const docked = useRef<HTMLDivElement>(null);
  // Docked only once the bar has been seen and then scrolled away, not while
  // the dialog is still opening.
  const seen = useRef(false);
  if (inView) seen.current = true;
  const isDocked = seen.current && !inView && !matchMedia('(pointer: coarse)').matches;
  const was = useRef(isDocked);
  useLayoutEffect(() => {
    if (was.current === isDocked) return;
    was.current = isDocked;
    const to = docked.current;
    const from = place.current;
    if (to === null || from === null || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    for (const running of to.getAnimations()) running.cancel();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (isDocked) {
      to.animate(
        [
          { opacity: 0, transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.92)` },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: springSettleTime(springs.move, 0.004) * 1000,
          easing: springEasing(springs.move),
        },
      );
    } else {
      to.animate(
        [
          { opacity: 1, transform: 'none' },
          {
            opacity: 0,
            transform: `translate(${String(dx / 4)}px, ${String(dy / 4)}px) scale(0.96)`,
          },
        ],
        { duration: durations.fast, easing: curve(easings.exit) },
      );
    }
  }, [isDocked, place]);
  return { isDocked, place, attach, docked };
}
