import {
  Alert,
  AssistantComposer,
  AssistantMessage,
  AssistantSource,
  AssistantSources,
  AssistantSuggestion,
  AssistantText,
  Card,
  CardTitle,
  List,
  ListItem,
  Text,
} from '@reach/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useSigned } from '../people/api';
import { askDocuments } from './api';

/**
 * Kithena reading a document on the phone (MR1, MR2, MR5; PRD §14), as the
 * web's `document/reading.tsx`: asked for once the screen is up, gone when
 * there is no model or the company switched it off, every claim with its
 * pages.
 */

interface Cited {
  readonly text: string;
  readonly pages: readonly number[];
}

interface Summary {
  readonly available: boolean;
  readonly summary: readonly Cited[];
  readonly facts: readonly { label: string; value: string; page: number }[];
  readonly watch: Cited | null;
  readonly questions: readonly string[];
  readonly dates: readonly string[];
}

export interface Answer {
  readonly available: boolean;
  readonly reason: string | null;
  readonly answer: readonly Cited[];
  readonly sources: readonly { documentId: string; title: string; pages: readonly number[] }[];
}

const pagesWord = (pages: readonly number[]): string =>
  pages.length === 1 ? `p. ${String(pages[0])}` : `pp. ${pages.join(', ')}`;

const said = (c: Cited): string => `${c.text} (${pagesWord(c.pages)})`;

export function Reading({ documentId }: { readonly documentId: string }): React.JSX.Element | null {
  const signed = useSigned();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [asked, setAsked] = useState<readonly { q: string; a: Answer | null; error?: string }[]>([]);
  const [question, setQuestion] = useState('');
  const busy = asked.at(-1)?.a === null && asked.at(-1)?.error === undefined;

  useEffect(() => {
    let live = true;
    void askDocuments<Summary>(signed, 'DocumentSummary', { documentId }).then((r) => {
      if (live && r.ok) setSummary(r.data);
    });
    return () => {
      live = false;
    };
  }, [signed, documentId]);

  const ask = (q: string): void => {
    if (q.trim() === '' || busy) return;
    setQuestion('');
    setAsked((was) => [...was, { q, a: null }]);
    void askDocuments<Answer>(signed, 'AskDocument', { documentId, input: { question: q } }).then(
      (r) => {
        setAsked((was) =>
          was.map((x, i) =>
            i === was.length - 1 ? (r.ok ? { q, a: r.data } : { q, a: null, error: r.message }) : x,
          ),
        );
      },
    );
  };

  if (summary === null) return null;
  if (!summary.available) {
    return summary.dates.length === 0 ? null : (
      <Card variant="assistant">
        <CardTitle>Dates in this document</CardTitle>
        <Text>{summary.dates.join(' · ')}</Text>
      </Card>
    );
  }
  return (
    <Card variant="assistant">
      <CardTitle>Summary</CardTitle>
      {summary.summary.map((c) => (
        <AssistantText key={c.text}>{said(c)}</AssistantText>
      ))}
      {summary.facts.length === 0 ? null : (
        <List>
          {summary.facts.map((f) => (
            <ListItem key={f.label} description={`${f.value} · p. ${String(f.page)}`}>
              {f.label}
            </ListItem>
          ))}
        </List>
      )}
      {summary.watch === null ? null : (
        <Alert tone="warning" title="Worth knowing">
          {said(summary.watch)}
        </Alert>
      )}
      {asked.map((x, i) => (
        <View key={`${String(i)}-${x.q}`} className="gap-2">
          <AssistantMessage from="user">{x.q}</AssistantMessage>
          <AssistantMessage from="assistant" streaming={x.a === null && x.error === undefined}>
            {x.a === null ? (
              <AssistantText>{x.error ?? 'Reading…'}</AssistantText>
            ) : x.a.available ? (
              x.a.answer.map((c) => <AssistantText key={c.text}>{said(c)}</AssistantText>)
            ) : (
              <AssistantText>{x.a.reason ?? 'The document does not say.'}</AssistantText>
            )}
          </AssistantMessage>
        </View>
      ))}
      {asked.length === 0
        ? summary.questions.map((q) => (
            <AssistantSuggestion
              key={q}
              icon={Sparkles}
              onPress={() => {
                ask(q);
              }}
            >
              {q}
            </AssistantSuggestion>
          ))
        : null}
      <AssistantComposer
        value={question}
        onValueChange={setQuestion}
        onSubmit={ask}
        streaming={busy}
        placeholder="Ask about this document…"
        disclaimer="Answers can be wrong; check the page."
      />
    </Card>
  );
}

/** MR5: an answer across documents, each source opening its document. */
export function AcrossAnswer({
  question,
  answer,
  onOpen,
}: {
  readonly question: string;
  readonly answer: Answer;
  readonly onOpen: (documentId: string, title: string) => void;
}): React.JSX.Element {
  return (
    <Card variant="assistant">
      <CardTitle>{question}</CardTitle>
      {answer.available ? (
        answer.answer.map((c) => <AssistantText key={c.text}>{c.text}</AssistantText>)
      ) : (
        <AssistantText>{answer.reason ?? 'Nothing you can open says.'}</AssistantText>
      )}
      {answer.sources.length === 0 ? null : (
        <AssistantSources>
          {answer.sources.map((s, i) => (
            <AssistantSource
              key={s.documentId}
              index={i + 1}
              onPress={() => {
                onOpen(s.documentId, s.title);
              }}
            >
              {`${s.title} · ${pagesWord(s.pages)}`}
            </AssistantSource>
          ))}
        </AssistantSources>
      )}
      <Text variant="footnote" tone="muted">
        Only from documents you can open.
      </Text>
    </Card>
  );
}
