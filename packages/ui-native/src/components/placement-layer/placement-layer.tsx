import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Platform,
  type LayoutChangeEvent,
  type View as NativeView,
} from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { usePdfPage } from '../pdf-pages/pdf-pages.tsx';
import { InkContext, type InkReport } from './ink.ts';

/**
 * Boxes laid over a page (`PdfPages`' overlay), the web's `PlacementLayer`
 * while a document is filled in: each box pressed, one after another.
 * Placing and moving boxes is the desk's; a phone fills them.
 *
 * Every position is a fraction of the page (0–1, from its top left), so a box
 * is where it was put whatever width the page is drawn at.
 */

export interface PlacedBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Which of the six chart colours: one per person, so whose box it is shows. */
  readonly tone: 1 | 2 | 3 | 4 | 5 | 6;
  /** "Signature, Ada Lovelace". Read out, and shown in an empty box. */
  readonly label: string;
  /** Shown in the box until it is filled: "Sign", "Date". */
  readonly hint?: string;
  /** Filled: drawn without its tint, as what it holds. */
  readonly done?: boolean;
  /**
   * Small print under the box, as a document prints it under what fills it:
   * who signed, how and when. Each line on its own (`\n`); never pressed.
   */
  readonly caption?: string;
}

export interface PlacementLayerProps {
  readonly boxes: readonly PlacedBox[];
  /** A box pressed. */
  readonly onActivate?: (id: string) => void;
  /** Outlined, scrolled to the middle of the screen and given a screen reader's focus when it changes: "Next" uses it. */
  readonly focus?: string | null;
  /** What a box holds once filled: a signature, a date. */
  readonly render?: (box: PlacedBox) => ReactNode;
  readonly className?: string | undefined;
}

const TONE: Record<PlacedBox['tone'], string> = {
  1: 'border-chart-1 bg-chart-1/15',
  2: 'border-chart-2 bg-chart-2/15',
  3: 'border-chart-3 bg-chart-3/15',
  4: 'border-chart-4 bg-chart-4/15',
  5: 'border-chart-5 bg-chart-5/15',
  6: 'border-chart-6 bg-chart-6/15',
};

export function PlacementLayer({
  boxes,
  onActivate,
  focus = null,
  render,
  className,
}: PlacementLayerProps): React.JSX.Element {
  const { reveal } = usePdfPage();
  const refs = useRef(new Map<string, NativeView>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Where each box's ink ends, by box and by the part that reported it.
  const [ink, setInk] = useState<Readonly<Record<string, Readonly<Record<string, number>>>>>({});
  const reports = useMemo(() => {
    const made = new Map<string, InkReport>();
    return (id: string): InkReport => {
      let report = made.get(id);
      if (report === undefined) {
        report = (key, bottom) => {
          setInk((all) => {
            const mine = all[id] ?? {};
            if (mine[key] === (bottom ?? undefined)) return all;
            const rest = Object.fromEntries(Object.entries(mine).filter(([k]) => k !== key));
            return { ...all, [id]: bottom === null ? rest : { ...rest, [key]: bottom } };
          });
        };
        made.set(id, report);
      }
      return report;
    };
  }, []);
  // Only a new focus moves the screen, never a box filled where it already is.
  const latest = useRef({ boxes, reveal });
  latest.current = { boxes, reveal };

  useEffect(() => {
    const box = latest.current.boxes.find((b) => b.id === focus);
    if (box === undefined) return;
    latest.current.reveal(box.y + box.h / 2);
    const el = refs.current.get(box.id);
    if (el !== undefined && Platform.OS !== 'web')
      AccessibilityInfo.sendAccessibilityEvent(el, 'focus');
  }, [focus]);

  return (
    <View
      className={cn('relative h-full w-full', className)}
      pointerEvents="box-none"
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ width, height });
      }}
    >
      {boxes.map((box) => {
        const content = render?.(box);
        // A page's 6pt under the ink, as the sealed file prints it; under the
        // box until what it holds has said where its ink ends.
        const bottoms = Object.values(ink[box.id] ?? {});
        const top =
          bottoms.length === 0 || size.height === 0
            ? null
            : box.y * size.height + Math.max(...bottoms) + (size.width * 6) / 595;
        // Beside the box, not in it: the box clips what it holds.
        const caption =
          box.caption === undefined ? null : (
            <CssText
              key={`${box.id}-caption`}
              aria-hidden
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${String(box.x * 100)}%` as `${number}%`,
                top: top ?? (`${String((box.y + box.h) * 100)}%` as `${number}%`),
              }}
              className={cn(
                'text-[7px] leading-[9px] text-[var(--reach-neutral-600)]',
                top === null && 'mt-0.5',
              )}
            >
              {box.caption}
            </CssText>
          );
        return [
          <Pressable
            key={box.id}
            ref={(el: NativeView | null) => {
              if (el === null) refs.current.delete(box.id);
              else refs.current.set(box.id, el);
            }}
            accessibilityRole="button"
            accessibilityLabel={box.label}
            onPress={() => {
              onActivate?.(box.id);
            }}
            hitSlop={8}
            style={{
              position: 'absolute',
              left: `${String(box.x * 100)}%` as `${number}%`,
              top: `${String(box.y * 100)}%` as `${number}%`,
              width: `${String(box.w * 100)}%` as `${number}%`,
              height: `${String(box.h * 100)}%` as `${number}%`,
            }}
            className={cn(
              'items-center justify-center overflow-hidden rounded-sm border-2',
              box.done === true ? 'border-transparent' : cn('border-dashed', TONE[box.tone]),
              // The page is paper, white in either theme: the ring is the light theme's.
              focus === box.id && 'border-solid border-[var(--reach-brand-600)]',
            )}
          >
            <InkContext.Provider value={reports(box.id)}>
              {content ?? (
                <CssText
                  aria-hidden
                  numberOfLines={1}
                  className="px-1 text-[10px] font-semibold text-[var(--reach-neutral-900)]"
                >
                  {box.hint ?? box.label}
                </CssText>
              )}
            </InkContext.Provider>
          </Pressable>,
          caption,
        ];
      })}
    </View>
  );
}
