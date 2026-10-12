import {
  Alert,
  AssistantCard,
  AssistantComposer,
  AssistantMessage,
  AssistantSource,
  AssistantSources,
  AssistantSuggestion,
  AssistantSuggestions,
  Badge,
  Button,
  KeyValues,
  Spinner,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { shortDate } from '../shared';
import type { Answer, Cited, Comparison, Read, Summary } from '../types';

/**
 * Kithena reading a document (D1, D2, D3; PRD §14): asked for once the page
 * is on screen, so a slow model never holds the document up, and gone when
 * the company has no model or has switched it off. Every claim shows the
 * pages it came from; Documents already dropped any claim that cited none.
 */

export interface ReadingProps {
  readonly documentId: string;
  readonly current: number;
  readonly onSummarize?: ((documentId: string) => Promise<Read<Summary>>) | undefined;
  readonly onAsk?: ((documentId: string, question: string) => Promise<Read<Answer>>) | undefined;
  readonly onCompare?:
    ((documentId: string, from: number, to: number) => Promise<Read<Comparison>>) | undefined;
}

const pagesWord = (pages: readonly number[]): string =>
  pages.length === 1 ? `p. ${String(pages[0])}` : `pp. ${pages.join(', ')}`;

function Claim({ claim }: { readonly claim: Cited }): JSX.Element {
  return (
    <p>
      {claim.text}{' '}
      <Badge size="sm" tone="neutral">
        {pagesWord(claim.pages)}
      </Badge>
    </p>
  );
}

export function Reading({
  documentId,
  current,
  onSummarize,
  onAsk,
  onCompare,
}: ReadingProps): JSX.Element | null {
  const [summary, setSummary] = useState<Summary | 'loading' | null>(
    onSummarize ? 'loading' : null,
  );
  const [asked, setAsked] = useState<readonly { q: string; a: Answer | null; error?: string }[]>(
    [],
  );
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (onSummarize === undefined) return;
    let live = true;
    void onSummarize(documentId).then((r) => {
      if (live) setSummary(r.ok ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [documentId, onSummarize]);

  const ask = (q: string): void => {
    if (onAsk === undefined || q.trim() === '' || busy) return;
    setBusy(true);
    setQuestion('');
    setAsked((was) => [...was, { q, a: null }]);
    void onAsk(documentId, q).then((r) => {
      setAsked((was) =>
        was.map((x, i) =>
          i === was.length - 1 ? (r.ok ? { q, a: r.data } : { q, a: null, error: r.message }) : x,
        ),
      );
      setBusy(false);
    });
  };

  if (summary === null) return null;
  if (summary === 'loading') {
    return (
      <AssistantCard title="Reading it" level={2}>
        <Spinner size="sm" label="Kithena is reading the document" />
      </AssistantCard>
    );
  }
  if (!summary.available) {
    // A medical document's dates are the one thing read without a model.
    return summary.dates.length === 0 ? null : (
      <AssistantCard title="Dates in this document" level={2} note={summary.reason ?? undefined}>
        <ul className="flex flex-wrap gap-1.5">
          {summary.dates.map((d) => (
            <li key={d}>
              <Badge size="sm">{shortDate(d)}</Badge>
            </li>
          ))}
        </ul>
      </AssistantCard>
    );
  }

  return (
    <AssistantCard
      title="Summary"
      level={2}
      note={`From version ${String(current)}. Answers can be wrong; check the page.`}
    >
      <div className="flex flex-col gap-2 text-sm">
        {summary.summary.map((c) => (
          <Claim key={c.text} claim={c} />
        ))}
      </div>
      {summary.facts.length === 0 ? null : (
        <KeyValues
          layout="split"
          items={summary.facts.map((f) => ({
            label: f.label,
            value: `${f.value} · p. ${String(f.page)}`,
          }))}
        />
      )}
      {summary.watch === null ? null : (
        <Alert tone="warning" title="Worth knowing" icon={<icons.flagged />}>
          {summary.watch.text} ({pagesWord(summary.watch.pages)})
        </Alert>
      )}
      {asked.map((x, i) => (
        <div key={`${String(i)}-${x.q}`} className="flex flex-col gap-2">
          <AssistantMessage from="user">{x.q}</AssistantMessage>
          <AssistantMessage from="assistant">
            {x.a === null ? (
              x.error === undefined ? (
                <Spinner size="sm" label="Kithena is answering" />
              ) : (
                <p>{x.error}</p>
              )
            ) : x.a.available ? (
              x.a.answer.map((c) => <Claim key={c.text} claim={c} />)
            ) : (
              <p>{x.a.reason ?? 'The document does not say.'}</p>
            )}
          </AssistantMessage>
        </div>
      ))}
      {onAsk === undefined ? null : (
        <>
          {asked.length === 0 && summary.questions.length > 0 ? (
            <AssistantSuggestions>
              {summary.questions.map((q) => (
                <AssistantSuggestion
                  key={q}
                  icon={<icons.assistant aria-hidden />}
                  onClick={() => {
                    ask(q);
                  }}
                >
                  {q}
                </AssistantSuggestion>
              ))}
            </AssistantSuggestions>
          ) : null}
          <AssistantComposer
            className="px-0 pb-0"
            aria-label="Ask about this document"
            value={question}
            onValueChange={setQuestion}
            onSubmit={ask}
            streaming={busy}
            placeholder="Ask about this document…"
            disclaimer={null}
          />
        </>
      )}
      {current > 1 && onCompare !== undefined ? (
        <Compare documentId={documentId} current={current} onCompare={onCompare} />
      ) : null}
    </AssistantCard>
  );
}

/** D3: what changed from the version before, a sentence each and then the lines. */
function Compare({
  documentId,
  current,
  onCompare,
}: {
  readonly documentId: string;
  readonly current: number;
  readonly onCompare: NonNullable<ReadingProps['onCompare']>;
}): JSX.Element {
  const [answer, setAnswer] = useState<Comparison | 'loading' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (answer === null) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        startIcon={<icons.history aria-hidden />}
        onClick={() => {
          setAnswer('loading');
          void onCompare(documentId, current - 1, current).then((r) => {
            if (r.ok) setAnswer(r.data);
            else {
              setError(r.message);
              setAnswer(null);
            }
          });
        }}
      >
        {`What changed from version ${String(current - 1)}`}
      </Button>
    );
  }
  if (answer === 'loading') return <Spinner size="sm" label="Comparing the versions" />;
  return (
    <section
      className="flex flex-col gap-2"
      aria-label={`Changes from version ${String(current - 1)}`}
    >
      {error === null ? null : <Alert tone="danger">{error}</Alert>}
      {answer.added.length === 0 && answer.removed.length === 0 ? (
        <p className="text-sm text-fg-muted">The words did not change.</p>
      ) : null}
      {answer.sentences.length === 0 ? null : (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          {answer.sentences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {answer.removed.map((l) => (
          <li key={`-${l}`} className="text-danger-fg line-through">
            {l}
          </li>
        ))}
        {answer.added.map((l) => (
          <li key={`+${l}`} className="text-success-fg">
            {l}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** B4, MR5: an answer to a question across documents, each source a link. */
export function AcrossAnswer({
  question,
  answer,
  onNavigate,
}: {
  readonly question: string;
  readonly answer: Answer;
  readonly onNavigate?: ((href: string) => void) | undefined;
}): JSX.Element {
  return (
    <AssistantCard title={question} level={2} note="Only from documents you can open.">
      {answer.available ? (
        <div className="flex flex-col gap-2 text-sm">
          {answer.answer.map((c) => (
            <p key={c.text}>{c.text}</p>
          ))}
        </div>
      ) : (
        <p className="text-sm">{answer.reason ?? 'Nothing you can open says.'}</p>
      )}
      {answer.sources.length === 0 ? null : (
        <AssistantSources>
          {answer.sources.map((s, i) => (
            <AssistantSource
              key={s.documentId}
              index={i + 1}
              href={`/documents/d/${s.documentId}`}
              onClick={(e) => {
                if (onNavigate === undefined) return;
                e.preventDefault();
                onNavigate(`/documents/d/${s.documentId}`);
              }}
            >
              {`${s.title} · ${pagesWord(s.pages)}`}
            </AssistantSource>
          ))}
        </AssistantSources>
      )}
    </AssistantCard>
  );
}
