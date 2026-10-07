import { CircleAlert, Lock, TriangleAlert } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon } from '../icon/icon.tsx';

/**
 * Form field wiring, the web's parts on a phone: `Field`, `FieldLabel`,
 * `FieldDescription`, `FieldError`, `FieldControl`.
 *
 * A phone has no ids to point a label at. Instead each part tells the field
 * what it says, and the control reads that back as its accessible name and
 * hint, so a screen reader hears "Work email, Use a full address" on the
 * control itself, which is where VoiceOver and TalkBack look.
 *
 * Under a thumb a single-line field is 56pt tall and its label moves inside
 * it, above the value: the label, the field and the target become one thing.
 * A control that can carry it says so, and `FieldLabel` then draws nothing.
 */

type Parts = {
  label?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  /** A warning `FieldDescription`: allowed but unusual. A ring, never a block. */
  caution?: boolean | undefined;
  /** A control inside draws the label itself. */
  floating?: boolean | undefined;
};

type FieldState = {
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  sensitive: boolean;
  missing: boolean;
  optional: boolean;
  parts: Parts;
  set: <K extends keyof Parts>(key: K, value: Parts[K]) => void;
};

const FieldContext = createContext<FieldState | null>(null);

/** The field a control sits in, if any. For controls, not for screens. */
export function useField(): FieldState | null {
  return useContext(FieldContext);
}

/** Tells the field a part's value while it is mounted. */
function useRegister<K extends keyof Parts>(key: K, value: Parts[K]): FieldState | null {
  const field = useField();
  const set = field?.set;
  useLayoutEffect(() => {
    if (!set) return undefined;
    set(key, value);
    return () => {
      set(key, undefined);
    };
  }, [set, key, value]);
  return field;
}

export type FieldProps = {
  children?: ReactNode;
  /** Marks the control invalid and reveals `FieldError`. */
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Private data: a lock beside the label, and "Private" in its name. */
  sensitive?: boolean;
  /** Wanted and not yet filled in: a `Missing` mark in the label, never colour alone. */
  missing?: boolean;
  /** Says "Optional" beside the label. Mark the few optional fields, not the many required ones. */
  optional?: boolean;
  /**
   * `vertical`: the label above (or inside) the control. `horizontal`: beside
   * it, for a switch or a checkbox whose row is the label. `columns` is the
   * web's desk layout; on a phone it stacks like `vertical`.
   */
  orientation?: 'vertical' | 'horizontal' | 'columns';
  className?: string | undefined;
};

/** The label, the control, then a hint or an error. Only one message shows at a time. */
export function Field({
  children,
  invalid = false,
  required = false,
  disabled = false,
  sensitive = false,
  missing = false,
  optional = false,
  orientation = 'vertical',
  className,
}: FieldProps): React.JSX.Element {
  const [parts, setParts] = useState<Parts>({});
  // Stable, so a part registering itself does not re-register on every render.
  const set = useCallback<FieldState['set']>((key, next) => {
    setParts((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }, []);
  const value = useMemo<FieldState>(
    () => ({
      invalid,
      required,
      disabled,
      sensitive,
      missing,
      optional,
      parts,
      set,
    }),
    [invalid, required, disabled, sensitive, missing, optional, parts, set],
  );
  return (
    <FieldContext value={value}>
      <View
        className={cn(
          'min-w-0',
          orientation === 'horizontal'
            ? 'min-h-m-tap flex-row items-center justify-between gap-4'
            : 'gap-1.5',
          className,
        )}
      >
        {children}
      </View>
    </FieldContext>
  );
}

/** The accessible name a control in this field carries: label, then its marks. */
export function fieldName(field: FieldState | null, fallback?: string): string | undefined {
  const label = field?.parts.label ?? fallback;
  if (!label || !field) return label;
  return [
    label,
    field.required && 'required',
    field.optional && 'optional',
    field.sensitive && 'private',
    field.missing && 'missing',
  ]
    .filter(Boolean)
    .join(', ');
}

/** What is read after the name: the error while invalid, else the hint. */
export function fieldHint(field: FieldState | null): string | undefined {
  if (!field) return undefined;
  return (field.invalid ? field.parts.error : undefined) ?? field.parts.description;
}

/**
 * The label. Above the control, or, for a single-line field, inside it,
 * where the control draws it. Pass a string: it is also the control's name.
 */
export function FieldLabel({
  children,
  className,
}: {
  children: string;
  className?: string | undefined;
}): React.JSX.Element | null {
  const field = useRegister('label', children);
  if (field?.parts.floating) return null;
  return (
    <View className={cn('flex-row flex-wrap items-center gap-2', className)} aria-hidden>
      <CssText
        className={cn(
          'text-subhead font-semibold',
          field?.disabled ? 'text-fg-disabled' : 'text-fg',
        )}
      >
        {children}
        {field?.required ? <CssText className="text-danger-fg"> *</CssText> : null}
      </CssText>
      <LabelMarks />
    </View>
  );
}

/** Optional, Private, Missing: what the design sets beside a label above a control. */
function LabelMarks(): React.JSX.Element | null {
  const field = useField();
  if (!field) return null;
  return (
    <>
      {field.optional ? <CssText className="text-subhead text-fg-muted">Optional</CssText> : null}
      {field.sensitive ? (
        <View className="flex-row items-center gap-1">
          <Icon icon={Lock} size={12} tone="muted" />
          <CssText className="text-subhead font-medium text-fg-muted">Private</CssText>
        </View>
      ) : null}
      {field.missing ? (
        <View className="flex-row items-center gap-1">
          <Icon icon={TriangleAlert} size={12} tone="warning" />
          <CssText className="text-subhead font-medium text-warning-fg">Missing</CssText>
        </View>
      ) : null}
    </>
  );
}

/**
 * The label as a floating field draws it, inside the box: 12pt over the
 * value, accent while focused, danger while invalid.
 */
export function FloatingLabel({
  focused,
  invalid,
}: {
  focused: boolean;
  invalid: boolean;
}): React.JSX.Element | null {
  const field = useField();
  const label = field?.parts.label;
  if (!field || !label) return null;
  return (
    <View className="flex-row items-center gap-1" aria-hidden>
      <CssText
        numberOfLines={1}
        className={cn(
          'text-caption',
          invalid ? 'text-danger-fg' : focused ? 'text-accent-fg' : 'text-fg-muted',
        )}
      >
        {label}
        {field.required ? <CssText className="text-danger-fg"> *</CssText> : null}
        {field.optional ? ' · optional' : ''}
      </CssText>
      {field.sensitive ? <Icon icon={Lock} size={11} tone="muted" /> : null}
    </View>
  );
}

/** Tells the field its label is drawn inside the control. */
export function useFloatingLabel(enabled: boolean): FieldState | null {
  return useRegister('floating', enabled || undefined);
}

/**
 * Help under the control. `tone="warning"` is a caution: a value that was
 * accepted but looks doubtful. It rings the field in amber and never blocks.
 */
export function FieldDescription({
  children,
  tone = 'muted',
  className,
}: {
  children: string;
  tone?: 'muted' | 'warning';
  className?: string | undefined;
}): React.JSX.Element | null {
  useRegister('description', children);
  const field = useRegister('caution', tone === 'warning' || undefined);
  // One message at a time: the error replaces the hint while it shows.
  if (field?.invalid && field.parts.error) return null;
  return (
    <CssText
      className={cn(
        'text-subhead',
        tone === 'warning' ? 'text-warning-fg' : 'text-fg-muted',
        className,
      )}
    >
      {children}
    </CssText>
  );
}

/** Shown only while the field is invalid, and announced politely. */
export function FieldError({
  children,
  className,
}: {
  children?: string;
  className?: string | undefined;
}): React.JSX.Element | null {
  const field = useRegister('error', children);
  if (!children || (field && !field.invalid)) return null;
  return (
    <CssText
      accessibilityLiveRegion="polite"
      aria-live="polite"
      className={cn('text-subhead text-danger-fg', className)}
    >
      {children}
    </CssText>
  );
}

/**
 * The web's id wiring. On a phone the control reads the field itself, so this
 * only keeps a form's shape the same on both.
 */
export function FieldControl({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>;
}

/** The glyph a state adds after the value, so it never rests on the ring's colour. */
export function StateGlyph({
  invalid,
  caution,
}: {
  invalid: boolean;
  caution: boolean;
}): React.JSX.Element | null {
  if (invalid) return <Icon icon={CircleAlert} size={19} tone="danger" />;
  if (caution) return <Icon icon={TriangleAlert} size={19} tone="warning" />;
  return null;
}
