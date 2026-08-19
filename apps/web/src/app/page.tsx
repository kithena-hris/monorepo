import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KithenaLogo,
} from '@reach/ui';
import type { JSX } from 'react';

/**
 * Placeholder shell. It exists to prove the wiring — the design system renders
 * here exactly as it does in Storybook — not to be the product.
 */
export default function Home(): JSX.Element {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Badge tone="accent">Reference client</Badge>
      {/* The lockup rather than a styled `<h1>`: this is the one screen where
          the product names itself, so it should do it with the mark. */}
      <KithenaLogo showSubtitle className="mt-4 text-fg" />
      <p className="mt-4 text-fg-muted">
        Every screen here renders through <code className="font-mono text-sm">@reach/ui</code>. The
        API is the product; this is one of its four transports.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <div>
            <CardTitle>Nothing mounted yet</CardTitle>
            <CardDescription>Add a route per module as each one lands.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="primary">Primary action</Button>
        </CardContent>
      </Card>
    </main>
  );
}
