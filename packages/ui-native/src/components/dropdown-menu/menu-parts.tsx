import type * as DropdownMenuPrimitive from '@rn-primitives/dropdown-menu';
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { cn } from '../../lib/cn.ts';
import { useEdgeInsets, WEB } from '../../lib/floating.tsx';
import { menuRowClass, MenuRowContent, menuSurface } from '../../lib/menu.tsx';
import { useOverlayContainer } from '../../lib/overlay-host.tsx';
import { flatStyle, InertOutside, labelledFrame, usePresence } from '../../lib/overlay.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';

/*
 * The parts Dropdown menu and Context menu share. `@rn-primitives`' two menus
 * have the same parts under the same names (Radix's), so one set of styled
 * parts is built over whichever primitive a menu passes in.
 */

type Primitive = typeof DropdownMenuPrimitive;

export type MenuContentProps = {
  children?: ReactNode;
  className?: string | undefined;
  /** Below the trigger, or above when there is no room. */
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Names the menu for a screen reader: "Actions for Priya Shah". */
  label?: string;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
};

export type MenuItemProps = {
  children: string;
  onSelect?: () => void;
  icon?: LucideIcon;
  /** Deletes or loses something: red. Confirm separately; colour is not consent. */
  destructive?: boolean;
  /**
   * Shown but not usable. Say why in `description` ("Locked: payroll has
   * already run"): a command that silently does nothing is a bug report.
   */
  disabled?: boolean;
  /** A second line: what it does, or why it cannot be done now. */
  description?: string;
  /** A leading avatar or mark instead of an icon. */
  lead?: ReactNode;
  /** Keep the menu open after it runs. */
  keepOpen?: boolean;
  /**
   * The label as drawn, when it is more than text (a search match in bold).
   * `children` stays the text that is read out and typed ahead to.
   */
  rendered?: ReactNode;
};

export type MenuCheckboxItemProps = {
  children: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Keep the menu open to change several; off by default, as Radix's. */
  keepOpen?: boolean;
};

export type MenuRadioItemProps = {
  children: string;
  value: string;
  disabled?: boolean;
  keepOpen?: boolean;
};

const SubState = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

function useSubState(): { open: boolean; setOpen: (open: boolean) => void } {
  const state = useContext(SubState);
  if (!state) throw new Error('A submenu row must be inside its MenuSub.');
  return state;
}

/**
 * A row's role on the web. The context menu's primitive calls its rows
 * buttons, and React Native's types list none of the menu roles.
 */
function webRole(role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'): object {
  return WEB ? { role } : {};
}

/** The leading column of a checkable row, so labels line up with or without a mark. */
function IndicatorSlot({ children }: { children?: ReactNode }): React.JSX.Element {
  return <View className="w-[18px] items-center justify-center">{children}</View>;
}

export type MenuParts = {
  MenuContent: (props: MenuContentProps) => React.JSX.Element | null;
  MenuItem: (props: MenuItemProps) => React.JSX.Element;
  MenuCheckboxItem: (props: MenuCheckboxItemProps) => React.JSX.Element;
  MenuRadioItem: (props: MenuRadioItemProps) => React.JSX.Element;
  MenuLabel: (props: { children: string }) => React.JSX.Element;
  MenuSeparator: () => React.JSX.Element;
  MenuSubTrigger: (props: { children: string; icon?: LucideIcon }) => React.JSX.Element;
  MenuSubContent: (props: {
    children?: ReactNode;
    className?: string | undefined;
  }) => React.JSX.Element | null;
  Group: Primitive['Group'];
  RadioGroup: Primitive['RadioGroup'];
  Sub: (props: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) => React.JSX.Element;
};

export function menuParts(P: Primitive): MenuParts {
  const Content = styled(flatStyle(P.Content));
  const Overlay = styled(flatStyle(P.Overlay));
  const Item = styled(flatStyle(P.Item));
  const CheckboxItem = styled(flatStyle(P.CheckboxItem));
  const RadioItem = styled(flatStyle(P.RadioItem));
  const Indicator = styled(flatStyle(P.ItemIndicator));
  const Label = styled(flatStyle(P.Label));
  const Separator = styled(flatStyle(P.Separator));

  function MenuContent({
    children,
    className,
    side = 'bottom',
    align = 'start',
    sideOffset = 6,
    label,
    portalHost,
  }: MenuContentProps): React.JSX.Element | null {
    const { open, onOpenChange } = P.useRootContext();
    const presence = usePresence(open, side);
    const container = useOverlayContainer(portalHost);
    const edge = useEdgeInsets();
    if (!presence.mounted) return null;
    const content = (
      <Content
        forceMount
        asChild
        ref={labelledFrame(label)}
        side={side}
        align={align}
        sideOffset={sideOffset}
        {...edge}
        // On the web the name goes on Radix's element (`labelledFrame`): a
        // labelled view between a menu and its items breaks the menu's role.
        {...(label && !WEB ? { accessibilityLabel: label } : {})}
        className="outline-none"
      >
        {/*
          A plain view, not the primitive's own pressable, which the web
          makes a focus stop that a menu may not contain.
        */}
        <View>
          {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
          <Animated.View style={presence.style}>
            <View className={cn(menuSurface, 'min-w-[220px]', className)}>{children}</View>
          </Animated.View>
          {/* A menu is modal on the web: the page behind it is hidden, so inert. */}
          <InertOutside />
        </View>
      </Content>
    );
    return (
      <P.Portal
        forceMount
        {...(portalHost ? { hostName: portalHost } : {})}
        {...(WEB ? { container } : {})}
      >
        {/* Radix's portal takes one child. On a device a press outside closes it. */}
        {WEB ? (
          content
        ) : (
          <View pointerEvents="box-none" className="absolute inset-0">
            <Overlay
              forceMount
              onPress={() => {
                onOpenChange(false);
              }}
              className="absolute inset-0"
            />
            {content}
          </View>
        )}
      </P.Portal>
    );
  }

  function MenuItem({
    children,
    onSelect,
    icon,
    destructive = false,
    disabled = false,
    description,
    lead,
    keepOpen = false,
    rendered,
  }: MenuItemProps): React.JSX.Element {
    return (
      <Item
        disabled={disabled}
        closeOnPress={!keepOpen}
        textValue={children}
        {...webRole('menuitem')}
        {...(onSelect ? { onPress: onSelect } : {})}
        className={menuRowClass({ disabled })}
      >
        <MenuRowContent
          icon={icon}
          lead={lead}
          destructive={destructive}
          disabled={disabled}
          description={description}
        >
          {rendered ?? children}
        </MenuRowContent>
      </Item>
    );
  }

  function MenuCheckboxItem({
    children,
    checked,
    onCheckedChange,
    icon,
    disabled = false,
    keepOpen = false,
  }: MenuCheckboxItemProps): React.JSX.Element {
    return (
      <CheckboxItem
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        closeOnPress={!keepOpen}
        textValue={children}
        // The primitive's web part calls itself a button; it is a checkbox item.
        {...webRole('menuitemcheckbox')}
        aria-checked={checked}
        className={menuRowClass({ disabled })}
      >
        <MenuRowContent
          lead={
            <IndicatorSlot>
              <Indicator>
                <Icon icon={Check} size={16} tone="accent" />
              </Indicator>
            </IndicatorSlot>
          }
          disabled={disabled}
          end={icon ? <Icon icon={icon} size={20} tone="muted" /> : null}
        >
          {children}
        </MenuRowContent>
      </CheckboxItem>
    );
  }

  function MenuRadioItem({
    children,
    value,
    disabled = false,
    keepOpen = false,
  }: MenuRadioItemProps): React.JSX.Element {
    return (
      <RadioItem
        value={value}
        disabled={disabled}
        closeOnPress={!keepOpen}
        textValue={children}
        {...webRole('menuitemradio')}
        className={menuRowClass({ disabled })}
      >
        <MenuRowContent
          lead={
            <IndicatorSlot>
              <Indicator>
                <View className="size-2 rounded-full bg-accent" />
              </Indicator>
            </IndicatorSlot>
          }
          disabled={disabled}
        >
          {children}
        </MenuRowContent>
      </RadioItem>
    );
  }

  /** A group's heading. */
  function MenuLabel({ children }: { children: string }): React.JSX.Element {
    return (
      <Label className="px-2.5 pt-2 pb-1 text-caption leading-none font-semibold text-fg-subtle">
        {children}
      </Label>
    );
  }

  function MenuSeparator(): React.JSX.Element {
    return <Separator className="mx-3 my-1.5 h-px bg-border" />;
  }

  /**
   * A submenu, opened in place under its row. A phone has no room beside a
   * menu for a second one, and the system's own menus expand in place too.
   * Its rows are rows of the same menu, so arrow keys and type-ahead reach
   * them.
   */
  function MenuSub({
    open,
    defaultOpen = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }): React.JSX.Element {
    const [own, setOwn] = useState(defaultOpen);
    const shown = open ?? own;
    const set = (next: boolean): void => {
      setOwn(next);
      onOpenChange?.(next);
    };
    return <SubState.Provider value={{ open: shown, setOpen: set }}>{children}</SubState.Provider>;
  }

  /** The row that opens a submenu: it expands and collapses, and stays open. */
  function MenuSubTrigger({
    children,
    icon,
  }: {
    children: string;
    icon?: LucideIcon;
  }): React.JSX.Element {
    const { open, setOpen } = useSubState();
    return (
      <Item
        closeOnPress={false}
        textValue={children}
        {...webRole('menuitem')}
        onPress={() => {
          setOpen(!open);
        }}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        className={menuRowClass({ highlighted: open })}
      >
        <MenuRowContent
          icon={icon}
          end={<Icon icon={open ? ChevronDown : ChevronRight} size={16} tone="subtle" />}
        >
          {children}
        </MenuRowContent>
      </Item>
    );
  }

  /** A submenu's rows, under its row while it is open. */
  function MenuSubContent({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string | undefined;
  }): React.JSX.Element | null {
    const { open } = useSubState();
    if (!open) return null;
    return (
      <View
        accessibilityRole="menu"
        className={cn('my-1 ml-4 border-l-2 border-border pl-1.5', className)}
      >
        {children}
      </View>
    );
  }

  return {
    MenuContent,
    MenuItem,
    MenuCheckboxItem,
    MenuRadioItem,
    MenuLabel,
    MenuSeparator,
    MenuSubTrigger,
    MenuSubContent,
    Group: P.Group,
    RadioGroup: P.RadioGroup,
    Sub: MenuSub,
  };
}
