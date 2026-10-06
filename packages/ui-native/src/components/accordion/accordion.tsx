import * as AccordionPrimitive from '@rn-primitives/accordion';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react-native';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { Reveal } from '../reveal/reveal.tsx';

/**
 * Sections people only sometimes need, as the web's, in one rounded group:
 * a 60pt header (the title 17, a line under it, a status, the chevron) and a
 * body that eases open with Reveal. If most people need a section, it should
 * not be hidden at all.
 */

const Root = styled(flatStyle(AccordionPrimitive.Root));
const Item = styled(flatStyle(AccordionPrimitive.Item));
const Header = styled(flatStyle(AccordionPrimitive.Header));
const Trigger = styled(flatStyle(AccordionPrimitive.Trigger));
const Content = styled(flatStyle(AccordionPrimitive.Content));

type SingleProps = {
  type: 'single';
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: (value: string | undefined) => void;
  /** Lets the open section close again, leaving none open. On by default. */
  collapsible?: boolean;
};
type MultipleProps = {
  type: 'multiple';
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type AccordionProps = (SingleProps | MultipleProps) & {
  children: ReactNode;
  disabled?: boolean;
  className?: string | undefined;
};

export function Accordion(props: AccordionProps): React.JSX.Element {
  const { children, disabled, className, ...rest } = props;
  const root = rest.type === 'single' ? { ...rest, collapsible: rest.collapsible ?? true } : rest;
  return (
    <Root
      {...(root as AccordionPrimitive.RootProps)}
      {...(disabled === undefined ? {} : { disabled })}
      className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}
    >
      {Children.toArray(children)
        .filter(isValidElement)
        .map((child, i) =>
          i === 0
            ? cloneElement(child as ReactElement<AccordionItemProps>, { first: true })
            : child,
        )}
    </Root>
  );
}

export type AccordionItemProps = {
  value: string;
  /** The section's name, its header. */
  title: string;
  /** A line under the title: what is inside, or why it is locked. */
  description?: string | undefined;
  /** A status beside the chevron: a `Badge`. */
  meta?: ReactNode;
  icon?: LucideIcon | undefined;
  /** Locked: a padlock instead of the chevron, and the description says why. */
  disabled?: boolean;
  children?: ReactNode;
  /** Set by `Accordion`: the first section has no line above it. */
  first?: boolean;
  className?: string | undefined;
};

export function AccordionItem({
  value,
  title,
  description,
  meta,
  icon,
  disabled = false,
  children,
  first = false,
  className,
}: AccordionItemProps): React.JSX.Element {
  return (
    <Item
      value={value}
      disabled={disabled}
      className={cn(!first && 'border-t border-border', disabled && 'opacity-50', className)}
    >
      <Section title={title} description={description} meta={meta} icon={icon} disabled={disabled}>
        {children}
      </Section>
    </Item>
  );
}

function Section({
  title,
  description,
  meta,
  icon,
  disabled,
  children,
}: Omit<AccordionItemProps, 'value' | 'className' | 'first'> & {
  disabled: boolean;
}): React.JSX.Element {
  const { isExpanded } = AccordionPrimitive.useItemContext();
  return (
    <>
      <Header>
        <Trigger className="min-h-[60px] flex-row items-center gap-3 px-4 py-2">
          {icon ? <Icon icon={icon} size={18} tone="muted" /> : null}
          <View className="min-w-0 flex-1 gap-0.5">
            <CssText className="text-body font-semibold leading-[1.3] text-fg">{title}</CssText>
            {description ? (
              <CssText className="text-subhead leading-[1.3] text-fg-muted">{description}</CssText>
            ) : null}
          </View>
          {/* In a view: a Badge aligns itself to the start, which in this row is the top. */}
          {meta ? <View>{meta}</View> : null}
          {disabled ? (
            <Icon icon={Lock} size={16} tone="subtle" />
          ) : (
            <Icon icon={isExpanded ? ChevronUp : ChevronDown} size={18} tone="muted" />
          )}
        </Trigger>
      </Header>
      {/*
       * A group named by its header, not a region: a region is a landmark,
       * and a form of a dozen sections would fill the landmark list.
       */}
      <Content forceMount role="group">
        <Reveal open={isExpanded}>
          <View className="px-4 pb-[18px]">
            {typeof children === 'string' ? (
              <CssText className="text-callout leading-[1.55] text-fg-muted">{children}</CssText>
            ) : (
              children
            )}
          </View>
        </Reveal>
      </Content>
    </>
  );
}
