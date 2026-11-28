import {
  List,
  ListItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
  SearchField,
  Separator,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX } from 'react';

import { t } from '../i18n';

/**
 * The library's one field (B4): words narrow the list as they are typed, a
 * question is Kithena's to answer on Enter. Focused and empty, it offers
 * questions to start from and the ones asked here before; picking one asks
 * it. The directory's prompt bar, for documents.
 */

const RECENT = 'documents.library.recent';
const RECENT_MAX = 3;

/** The questions asked here, newest first, in this browser only; the field works without them. */
export function useRecentQuestions(): readonly [readonly string[], (question: string) => void] {
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(RECENT) ?? '[]') as unknown;
      if (Array.isArray(saved)) setRecent(saved.filter((s): s is string => typeof s === 'string'));
    } catch {
      // No storage, or not ours: nothing recent.
    }
  }, []);
  const add = (question: string): void => {
    const next = [question, ...recent.filter((s) => s !== question)].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      window.localStorage.setItem(RECENT, JSON.stringify(next));
    } catch {
      // Kept for this page only.
    }
  };
  return [recent, add];
}

export function AskBar({
  value,
  onValueChange,
  onAsk,
  loading,
  suggestions,
  recent,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Enter on what was typed, or a suggestion picked. Absent: the field only searches. */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly loading: boolean;
  readonly suggestions: readonly string[];
  readonly recent: readonly string[];
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLDivElement | null>(null);
  const asks = onAsk !== undefined;
  // What was asked before and is offered anyway is listed once, as a suggestion.
  const before = recent.filter((s) => !suggestions.includes(s));
  const open = asks && focused && value === '' && suggestions.length + before.length > 0;
  const label = asks
    ? t('library.library.search_or_ask_a_question', 'Search, or ask a question')
    : t('library.library.search_documents', 'Search documents');
  const pick = (question: string): void => {
    setFocused(false);
    onValueChange(question);
    onAsk?.(question);
  };
  const row = (question: string, kind: 'suggestion' | 'recent') => (
    <ListItem
      key={`${kind}:${question}`}
      asChild
      leading={
        kind === 'suggestion' ? (
          <icons.assistant aria-hidden className="size-4 text-accent-fg" />
        ) : (
          <icons.history aria-hidden className="size-4 text-fg-muted" />
        )
      }
    >
      <button
        type="button"
        onClick={() => {
          pick(question);
        }}
      >
        {question}
      </button>
    </ListItem>
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setFocused(false);
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={field}
          className="max-w-xl"
          onKeyDown={(event) => {
            // ↓ from the field walks into what it offers.
            if (event.key === 'ArrowDown' && open) {
              event.preventDefault();
              panel.current?.querySelector<HTMLElement>('button')?.focus();
            }
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={(event) => {
            const to = event.relatedTarget;
            if (!(to instanceof Node && panel.current?.contains(to) === true)) setFocused(false);
          }}
        >
          <SearchField
            {...(asks ? { variant: 'prompt' as const } : {})}
            label={label}
            placeholder={label}
            value={value}
            onValueChange={onValueChange}
            {...(asks ? { onSearch: onAsk } : {})}
            loading={loading}
            enterKeyHint="search"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        aria-label={t('library.ask-bar.suggestions', 'Suggestions')}
        align="start"
        className="w-(--radix-popover-trigger-width) max-w-130 min-w-80 p-2.5"
        onOpenAutoFocus={(event) => {
          // Typing goes on in the field; the list is a ↓ or a click away.
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && field.current?.contains(event.target) === true) {
            event.preventDefault();
          }
        }}
      >
        <div
          ref={panel}
          className="flex flex-col"
          onBlur={(event) => {
            const to = event.relatedTarget;
            const inside =
              to instanceof Node &&
              (panel.current?.contains(to) === true || field.current?.contains(to) === true);
            if (!inside) setFocused(false);
          }}
        >
          {suggestions.length === 0 ? null : (
            <section aria-labelledby="documents-ask-try" className="flex flex-col gap-1">
              <h2 id="documents-ask-try" className="px-2 pt-1 text-xs font-semibold text-fg-subtle">
                {t('library.ask-bar.try_asking', 'Try asking')}
              </h2>
              <List navigable>{suggestions.map((s) => row(s, 'suggestion'))}</List>
            </section>
          )}
          {suggestions.length === 0 || before.length === 0 ? null : <Separator className="my-1" />}
          {before.length === 0 ? null : (
            <section aria-labelledby="documents-ask-recent" className="flex flex-col gap-1">
              <h2
                id="documents-ask-recent"
                className="px-2 pt-1 text-xs font-semibold text-fg-subtle"
              >
                {t('library.ask-bar.recent', 'Recent')}
              </h2>
              <List navigable>{before.map((s) => row(s, 'recent'))}</List>
            </section>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
