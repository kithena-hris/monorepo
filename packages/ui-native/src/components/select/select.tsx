import { ChevronsUpDown } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, ScrollView, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog/dialog.tsx';
import { FieldBox, fieldText, useFieldState } from '../input/input.tsx';
import { Icon } from '../icon/icon.tsx';
import { ListHeading, ListSeparator, OptionRow } from './listbox.tsx';

/**
 * Pick one value from a short, fixed list: the web's parts (`Select`,
 * `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`,
 * `SelectLabel`, `SelectItem`, `SelectSeparator`), on a phone.
 *
 * The list opens centred, in a dialog titled with the field's name, rather
 * than as a menu hanging off the trigger: a short choice is a short task, and
 * a centred list keeps every option above the keyboard and away from the
 * screen's edge. Picking an option closes it. Over about ten options, use
 * Combobox, which can be typed into.
 */

type Item = { label: string; icon?: ReactNode };

type SelectState = {
  value: string | undefined;
  /** The list is showing: the trigger keeps its focused ring meanwhile. */
  open: boolean;
  choose: (value: string) => void;
  disabled: boolean;
  /** Labels the items told the root, so the trigger can show one while the list is shut. */
  items: ReadonlyMap<string, Item>;
  register: (value: string, item: Item | undefined) => void;
  /** The name the trigger reads: the dialog's title too. */
  name: string | undefined;
  setName: (name: string | undefined) => void;
};

const SelectContext = createContext<SelectState | null>(null);

function useSelect(part: string): SelectState {
  const context = useContext(SelectContext);
  if (!context) throw new Error(`${part} must be inside a Select.`);
  return context;
}

/** While shut, the content's items only tell the root their labels. */
const Collecting = createContext(false);

export type SelectProps = {
  children?: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
};

export function Select({
  children,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
}: SelectProps): React.JSX.Element {
  const [own, setOwn] = useState(defaultValue);
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [items, setItems] = useState<ReadonlyMap<string, Item>>(new Map());
  const [name, setName] = useState<string | undefined>(undefined);
  const value = valueProp ?? own;
  const open = openProp ?? ownOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const register = useCallback((key: string, item: Item | undefined) => {
    setItems((prev) => {
      const had = prev.get(key);
      if (had?.label === item?.label && had?.icon === item?.icon) return prev;
      const next = new Map(prev);
      if (item) next.set(key, item);
      else next.delete(key);
      return next;
    });
  }, []);
  const state = useMemo<SelectState>(
    () => ({
      value,
      open,
      choose: (next) => {
        setOwn(next);
        onValueChange?.(next);
        setOpen(false);
      },
      disabled,
      items,
      register,
      name,
      setName,
    }),
    [value, open, onValueChange, setOpen, disabled, items, register, name],
  );
  return (
    <SelectContext value={state}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next && !disabled);
        }}
      >
        {children}
      </Dialog>
    </SelectContext>
  );
}

export type SelectTriggerProps = {
  /** A `SelectValue`. */
  children?: ReactNode;
  /** `sm` 44pt; `md` and `lg` 56 under a thumb. */
  size?: 'sm' | 'md' | 'lg';
  /** Before the value, such as the chosen person's avatar. */
  startAdornment?: ReactNode;
  invalid?: boolean;
  /** The name read for the control when no `Field` gives one. Also the list's title. */
  accessibilityLabel?: string;
  className?: string | undefined;
};

/**
 * The field that shows the choice and opens the list. Inside a `Field` its
 * label floats inside the box, as a text field's does.
 */
export function SelectTrigger({
  children,
  size = 'md',
  startAdornment,
  invalid: invalidProp,
  accessibilityLabel,
  className,
}: SelectTriggerProps): React.JSX.Element {
  const select = useSelect('SelectTrigger');
  const state = useFieldState({ invalid: invalidProp, disabled: select.disabled || undefined });
  const ring = useFocusRing();
  const label = accessibilityLabel ?? state.name;
  const { setName } = select;
  useLayoutEffect(() => {
    setName(label);
  }, [label, setName]);
  const chosen = select.value === undefined ? undefined : select.items.get(select.value);
  return (
    <DialogTrigger asChild disabled={state.disabled}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[label, chosen?.label ?? 'nothing chosen'].filter(Boolean).join(', ')}
        {...(state.hint ? { accessibilityHint: state.hint } : {})}
        accessibilityState={{ disabled: state.disabled, expanded: false }}
        aria-invalid={state.invalid || undefined}
        disabled={state.disabled}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn('rounded-[16px] outline-none', className)}
      >
        <FieldBox
          size={size}
          focused={ring.focused || select.open}
          invalid={state.invalid}
          caution={state.caution}
          disabled={state.disabled}
          startAdornment={startAdornment ?? chosen?.icon}
          endAdornment={<Icon icon={ChevronsUpDown} size={18} tone="muted" />}
        >
          <View aria-hidden>{children}</View>
        </FieldBox>
      </Pressable>
    </DialogTrigger>
  );
}

/** The chosen option's label, or the placeholder in the subtle colour, which no chosen value is drawn in. */
export function SelectValue({
  placeholder = 'Choose…',
}: {
  placeholder?: string;
}): React.JSX.Element {
  const select = useSelect('SelectValue');
  const chosen = select.value === undefined ? undefined : select.items.get(select.value);
  return (
    <CssText numberOfLines={1} className={cn(fieldText, !chosen && 'text-fg-subtle')}>
      {chosen?.label ?? placeholder}
    </CssText>
  );
}

export type SelectContentProps = {
  children?: ReactNode;
  /** The list's title. The trigger's name by default. */
  title?: string;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  className?: string | undefined;
};

/** The centred list. Its items stay mounted while it is shut, only to name the choice. */
export function SelectContent({
  children,
  title,
  portalHost,
  className,
}: SelectContentProps): React.JSX.Element {
  const select = useSelect('SelectContent');
  const heading = title ?? select.name ?? 'Choose one';
  return (
    <>
      <Collecting value>{children}</Collecting>
      <DialogContent
        {...(portalHost ? { portalHost } : {})}
        className={cn('gap-2 px-1.5 pb-1.5', className)}
      >
        <DialogHeader className="px-4 pt-0.5 pb-1">
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-[420px]" contentContainerClassName="gap-0">
          <View accessibilityRole="radiogroup" accessibilityLabel={heading}>
            {children}
          </View>
        </ScrollView>
      </DialogContent>
    </>
  );
}

export type SelectItemProps = {
  value: string;
  /** The label: what the trigger shows once it is chosen. */
  children: string;
  /** A second line: why it is unavailable, or what choosing it means. */
  description?: string;
  /** An `<Icon>` or a 32pt `<Avatar>`, shown on the trigger too once chosen. */
  icon?: ReactNode;
  /** Stays in the list, with the reason in `description`: a missing option looks like a bug. */
  disabled?: boolean;
};

export function SelectItem({
  value,
  children,
  description,
  icon,
  disabled = false,
}: SelectItemProps): React.JSX.Element | null {
  const select = useSelect('SelectItem');
  const collecting = useContext(Collecting);
  const { register } = select;
  useLayoutEffect(() => {
    if (!collecting) return undefined;
    register(value, { label: children, icon });
    return () => {
      register(value, undefined);
    };
  }, [collecting, register, value, children, icon]);
  if (collecting) return null;
  return (
    <OptionRow
      label={children}
      description={description}
      icon={icon}
      disabled={disabled}
      selected={select.value === value}
      onPress={() => {
        select.choose(value);
      }}
    />
  );
}

/** Options under one `SelectLabel`. */
export function SelectGroup({ children }: { children?: ReactNode }): React.JSX.Element {
  const collecting = useContext(Collecting);
  if (collecting) return <>{children}</>;
  return <View>{children}</View>;
}

export function SelectLabel({ children }: { children: string }): React.JSX.Element | null {
  if (useContext(Collecting)) return null;
  return <ListHeading>{children}</ListHeading>;
}

export function SelectSeparator(): React.JSX.Element | null {
  if (useContext(Collecting)) return null;
  return <ListSeparator />;
}
