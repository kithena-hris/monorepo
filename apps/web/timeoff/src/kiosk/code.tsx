import { Alert, Button, Card, PageHeader, PageSection, PinInput, Skeleton } from '@reach/ui';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { encode } from 'uqr';

import { Loaded, type Loadable, type Outcome } from '../load';
import { t } from '../i18n';

/**
 * My kiosk code (PRD §11.9): the QR a member's phone shows the kiosk at the
 * door, and the PIN they type there instead. The code is Time Off's, signed
 * and good for a minute, so a screenshot of it is worth nothing by lunch; the
 * page asks for a fresh one before it runs out.
 *
 * The QR is drawn from `uqr`'s matrix as one SVG path: encoding a QR code
 * (Reed–Solomon, masking) is nothing to write by hand, and Reach has no QR,
 * so the encoder is this module's dependency, not the design system's.
 */

export interface KioskCodeData {
  readonly token: string;
  readonly expiresAt: string;
  readonly personId: string;
}

export interface KioskCodeProps {
  readonly load: Loadable<KioskCodeData>;
  /** A fresh code, before this one runs out. */
  readonly onRefresh: () => void;
  readonly onSavePin: (personId: string, pin: string) => Promise<Outcome>;
  /** For tests: the time now. */
  readonly now?: () => number;
}

const PIN_LENGTH = 6;
/** Asked again this long before the code runs out, so the one on screen always works. */
const REFRESH_BEFORE_MS = 10_000;

/** The matrix as one path, a rectangle per run of dark modules, with the standard's four-module quiet zone. */
function qrPath(text: string): { path: string; size: number } {
  const { data, size } = encode(text, { border: 4 });
  let path = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (row[x]) x++;
      path += t('kiosk.code.m_h_v1h_z', 'M{{start}} {{y}}h{{value}}v1h-{{value2}}z', {
        start: String(start),
        y: String(y),
        value: String(x - start),
        value2: String(x - start),
      });
    }
  });
  return { path, size };
}

export function KioskCode({
  load,
  onRefresh,
  onSavePin,
  now = Date.now,
}: KioskCodeProps): JSX.Element {
  if (load.status === 'loading') return <KioskCodeSkeleton />;
  return (
    <div className="@container flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={t('kiosk.code.my_kiosk_code', 'My kiosk code')} />
      ) : null}
      <Loaded load={load} what={t('kiosk.code.your_kiosk_code', 'your kiosk code')}>
        {(data) => <Ready data={data} onRefresh={onRefresh} onSavePin={onSavePin} now={now} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onRefresh,
  onSavePin,
  now,
}: {
  readonly data: KioskCodeData;
  readonly onRefresh: () => void;
  readonly onSavePin: KioskCodeProps['onSavePin'];
  readonly now: () => number;
}): JSX.Element {
  const qr = useMemo(() => qrPath(data.token), [data.token]);
  const expires = Date.parse(data.expiresAt);
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((expires - now()) / 1000)));
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const ms = expires - now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= REFRESH_BEFORE_MS) onRefresh();
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [expires, now, onRefresh]);

  return (
    <>
      <PageHeader
        title={t('kiosk.code.my_kiosk_code', 'My kiosk code')}
        description={t(
          'kiosk.code.show_this_at_the_kiosk_by',
          'Show this at the kiosk by the door to clock in or out.',
        )}
      />
      <div className="grid gap-5 @min-[48rem]:grid-cols-2">
        <Card padded className="flex flex-col items-center gap-3">
          <svg
            role="img"
            aria-label={t('kiosk.code.your_kiosk_code', 'Your kiosk code')}
            viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
            shapeRendering="crispEdges"
            className="aspect-square w-full max-w-72 rounded-md bg-white"
          >
            <path d={qr.path} fill="black" />
          </svg>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {left > 0
              ? t(
                  'kiosk.code.works_for_another_seconds_then_a',
                  'Works for another {{left}} seconds, then a new one appears.',
                  { left: String(left) },
                )
              : t('kiosk.code.getting_a_new_code', 'Getting a new code…')}
          </p>
        </Card>
        <PageSection title={t('kiosk.code.or_use_a_pin', 'Or use a PIN')}>
          <form
            className="flex flex-col items-start gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (pin.length !== PIN_LENGTH) return;
              setSaving(true);
              void onSavePin(data.personId, pin).then((done) => {
                setSaving(false);
                setOutcome(done);
                if (done.ok) setPin('');
              });
            }}
          >
            <PinInput
              label={t('kiosk.code.your_kiosk_pin', 'Your kiosk PIN')}
              hint={t(
                'kiosk.code.six_digits_nobody_else_at_work',
                'Six digits nobody else at work has. You type it at the kiosk instead of the code.',
              )}
              value={pin}
              onChange={setPin}
              length={PIN_LENGTH}
              masked
            />
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={pin.length !== PIN_LENGTH}
            >
              {t('kiosk.code.save_pin', 'Save PIN')}
            </Button>
            {outcome === null ? null : outcome.ok ? (
              <Alert
                tone="success"
                title={t('kiosk.code.your_pin_is_saved', 'Your PIN is saved')}
              />
            ) : (
              <Alert
                tone="danger"
                title={t('kiosk.code.your_pin_was_not_saved', 'Your PIN was not saved')}
              >
                {outcome.message}
              </Alert>
            )}
          </form>
        </PageSection>
      </div>
    </>
  );
}

export function KioskCodeSkeleton(): JSX.Element {
  return (
    <div className="@container flex flex-col gap-6">
      <PageHeader title={t('kiosk.code.my_kiosk_code', 'My kiosk code')} description={' '} />
      <div role="status" className="grid gap-5 @min-[48rem]:grid-cols-2">
        <span className="sr-only">
          {t('kiosk.code.loading_your_kiosk_code', 'Loading your kiosk code')}
        </span>
        <Skeleton className="aspect-square w-full max-w-80 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}
