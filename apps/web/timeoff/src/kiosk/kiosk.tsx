import { Badge, Button, PinInput, Spinner, icons, type IconName } from '@reach/ui';
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { clockTime, localDate, minuteOfDay, type PunchKind } from '../attendance/time';
import { longDate } from '../words';

/**
 * The kiosk at the door (T25, T26; PRD §11.9): a wall tablet with no session
 * and no sidebar, which knows a person only by the first name Time Off tells
 * it when they tap.
 *
 * A badge reader attached to the tablet types the badge's number and Enter
 * (a keyboard wedge), and a QR scanner types the code the member's phone
 * shows; both arrive here as keystrokes. A PIN is typed on the screen. Where
 * the browser can read a code from the camera (`BarcodeDetector`), "Show my
 * QR code" uses it; elsewhere it says to hold the phone to the reader.
 *
 * **Nothing is sent for five seconds.** The confirmation shows the first
 * name, the time and "Not you? Undo"; pressing it sends nothing, and only
 * once the five seconds pass does the tap go to the shell's queue, which
 * keeps it through a dropped network. No balance or personal detail is ever
 * on this screen.
 */

export interface KioskCredential {
  readonly kind: 'badge' | 'pin' | 'qr';
  readonly value: string;
}

/** Who a tap was, as Time Off answers: a first name and what the tap will do. */
export type Identified =
  | { readonly status: 'known'; readonly firstName: string; readonly kind: PunchKind }
  | { readonly status: 'unknown' }
  /** No answer: the tap is kept on the kiosk and sent when the network is back. */
  | { readonly status: 'offline' };

export interface KioskProps {
  /** The kiosk's own name, "Madrid office, main entrance"; `null` until known. */
  readonly place: string | null;
  readonly online: boolean;
  readonly onIdentify: (credential: KioskCredential) => Promise<Identified>;
  /** The tap, once nobody pressed Undo: the shell queues it and sends it when it can. */
  readonly onPunch: (tap: { readonly credential: KioskCredential; readonly at: string }) => void;
  /** The zone the wall clock shows. The tablet's own by default. */
  readonly timeZone?: string;
  /** For tests: the time now. */
  readonly now?: () => Date;
  readonly undoSeconds?: number;
}

type Phase =
  | { readonly step: 'idle' }
  | { readonly step: 'pin' }
  | { readonly step: 'scan' }
  | { readonly step: 'checking' }
  | { readonly step: 'unknown' }
  | {
      readonly step: 'confirm';
      readonly credential: KioskCredential;
      readonly at: string;
      readonly who: Extract<Identified, { status: 'known' }> | null;
      readonly left: number;
    };

const icon = (name: IconName, className?: string): ReactNode =>
  createElement(icons[name], { 'aria-hidden': true, className });

/** What a badge reader or a QR scanner typed: a Time Off QR starts `kq_`. */
const credentialOf = (typed: string): KioskCredential => ({
  kind: typed.startsWith('kq_') ? 'qr' : 'badge',
  value: typed,
});

/** Keystrokes further apart than this are a person at a keyboard, not a reader. */
const READER_GAP_MS = 300;
const PIN_LENGTH = 6;

function greeting(who: { firstName: string; kind: PunchKind }, minute: number): string {
  if (who.kind === 'out') return `Goodbye, ${who.firstName}`;
  if (who.kind === 'break_end') return `Welcome back, ${who.firstName}`;
  const part = minute < 12 * 60 ? 'morning' : minute < 18 * 60 ? 'afternoon' : 'evening';
  return `Good ${part}, ${who.firstName}`;
}

const DID: Record<PunchKind, string> = {
  in: 'Clocked in at',
  out: 'Clocked out at',
  break_start: 'Break started at',
  break_end: 'Back from your break at',
};

export function Kiosk({
  place,
  online,
  onIdentify,
  onPunch,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = () => new Date(),
  undoSeconds = 5,
}: KioskProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [pin, setPin] = useState('');
  const [time, setTime] = useState(() => now().toISOString());
  const typed = useRef({ text: '', at: 0 });

  useEffect(() => {
    const tick = window.setInterval(() => {
      setTime(now().toISOString());
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [now]);

  const tap = useCallback(
    async (credential: KioskCredential) => {
      const at = now().toISOString();
      setPhase({ step: 'checking' });
      const who = await onIdentify(credential).catch((): Identified => ({ status: 'offline' }));
      if (who.status === 'unknown') {
        setPhase({ step: 'unknown' });
        return;
      }
      setPhase({
        step: 'confirm',
        credential,
        at,
        who: who.status === 'known' ? who : null,
        left: undoSeconds,
      });
    },
    [now, onIdentify, undoSeconds],
  );

  // The reader types into the page, wherever focus is, except into the PIN boxes.
  useEffect(() => {
    if (phase.step !== 'idle' && phase.step !== 'scan') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return;
      const buffer = typed.current;
      if (event.timeStamp - buffer.at > READER_GAP_MS) buffer.text = '';
      buffer.at = event.timeStamp;
      if (event.key === 'Enter') {
        const value = buffer.text.trim();
        buffer.text = '';
        if (value !== '') {
          event.preventDefault();
          void tap(credentialOf(value));
        }
      } else if (event.key.length === 1) buffer.text += event.key;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [phase.step, tap]);

  // Five seconds to say "not me"; then the tap is the queue's.
  useEffect(() => {
    if (phase.step !== 'confirm') return undefined;
    const timer = window.setTimeout(() => {
      if (phase.left > 1) setPhase({ ...phase, left: phase.left - 1 });
      else {
        onPunch({ credential: phase.credential, at: phase.at });
        setPhase({ step: 'idle' });
      }
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase, onPunch]);

  useEffect(() => {
    if (phase.step !== 'unknown') return undefined;
    const timer = window.setTimeout(() => {
      setPhase({ step: 'idle' });
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase.step]);

  const minute = minuteOfDay(time, timeZone);
  const idle = (): void => {
    setPin('');
    setPhase({ step: 'idle' });
  };

  return (
    <div className="dark flex min-h-dvh flex-col bg-canvas text-fg">
      <header className="flex items-center justify-between gap-4 px-6 py-5 text-fg-muted sm:px-9 sm:py-7">
        <p className="truncate text-md font-semibold">{place ?? 'Kiosk'}</p>
        <Badge tone={online ? 'success' : 'warning'} size="lg" dot>
          {online ? 'Online' : 'Offline'}
        </Badge>
      </header>

      <main className="flex flex-1 flex-col">
        {phase.step === 'confirm' ? (
          <Confirmation phase={phase} minute={minuteOfDay(phase.at, timeZone)} onUndo={idle} />
        ) : phase.step === 'checking' ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="lg" label="Checking" />
          </div>
        ) : phase.step === 'unknown' ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <span className="text-danger-fg [&_svg]:size-20">{icon('danger')}</span>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-[4rem]">
              Not recognised
            </h1>
            <p className="max-w-xl text-lg text-fg-muted">
              Try again, or ask HR to set up your badge or PIN.
            </p>
            <Button size="lg" onClick={idle}>
              Back
            </Button>
          </div>
        ) : phase.step === 'pin' ? (
          <form
            className="flex flex-1 flex-col items-center justify-center gap-8 px-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (pin.length === PIN_LENGTH) void tap({ kind: 'pin', value: pin });
            }}
          >
            <h1 className="font-display text-3xl font-bold tracking-tight">Enter your PIN</h1>
            <PinInput
              label="Your PIN"
              value={pin}
              onChange={setPin}
              onComplete={(value) => {
                void tap({ kind: 'pin', value });
              }}
              length={PIN_LENGTH}
              masked
              size="lg"
              autoFocus
            />
            <Button size="lg" onClick={idle}>
              Cancel
            </Button>
          </form>
        ) : phase.step === 'scan' ? (
          <Scan onCode={(value) => void tap({ kind: 'qr', value })} onCancel={idle} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-12 px-6 sm:flex-row sm:justify-between sm:px-18">
            <div className="text-center sm:text-left">
              <p className="font-display text-[6rem] leading-none font-bold tracking-tighter tabular-nums sm:text-[8rem]">
                <time dateTime={time}>{clockTime(minute)}</time>
              </p>
              <p className="mt-4 text-xl text-fg-muted sm:text-2xl">
                {longDate(localDate(time, timeZone))}
              </p>
            </div>
            <div
              aria-hidden
              className="grid size-72 shrink-0 place-items-center rounded-full bg-surface ring-2 ring-border sm:size-96"
            >
              <span className="flex flex-col items-center gap-4 text-center [&_svg]:size-24">
                {icon('tap')}
              </span>
            </div>
            <h1 className="sr-only">Clock in or out</h1>
          </div>
        )}
      </main>

      {phase.step === 'idle' ? (
        <footer className="flex flex-col items-center gap-6 px-6 pb-10">
          <p className="text-2xl font-semibold">Hold your badge or phone here</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              startIcon={icon('locked')}
              onClick={() => {
                setPhase({ step: 'pin' });
              }}
            >
              Use a PIN
            </Button>
            <Button
              size="lg"
              startIcon={icon('scanCode')}
              onClick={() => {
                setPhase({ step: 'scan' });
              }}
            >
              Show my QR code
            </Button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function Confirmation({
  phase,
  minute,
  onUndo,
}: {
  readonly phase: Extract<Phase, { step: 'confirm' }>;
  readonly minute: number;
  readonly onUndo: () => void;
}): JSX.Element {
  const { who } = phase;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 text-center">
      <span
        aria-hidden
        className={`grid size-40 place-items-center rounded-full text-fg-on-accent [&_svg]:size-20 ${
          who === null ? 'bg-warning' : 'bg-success-solid'
        }`}
      >
        {icon(who === null ? 'offline' : 'confirm')}
      </span>
      <div role="status" className="space-y-3">
        <h1 className="font-display text-[3rem] leading-tight font-bold tracking-tight sm:text-[4rem]">
          {who === null ? 'Saved on this kiosk' : greeting(who, minute)}
        </h1>
        <p className="text-2xl text-fg-muted">
          {who === null
            ? `Taken at ${clockTime(minute)}. It is sent when the network is back.`
            : `${DID[who.kind]} ${clockTime(minute)}`}
        </p>
      </div>
      <Button size="lg" startIcon={icon('undo')} onClick={onUndo}>
        {`Not you? Undo · ${String(phase.left)}`}
      </Button>
    </div>
  );
}

/** A minimal `BarcodeDetector`, where the browser has one (Chrome on Android and ChromeOS). */
interface Detector {
  detect(source: HTMLVideoElement): Promise<readonly { readonly rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

function Scan({
  onCode,
  onCancel,
}: {
  readonly onCode: (value: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const Detector = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  const camera = Detector !== undefined && 'mediaDevices' in navigator;

  useEffect(() => {
    if (!camera) return undefined;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then(async (s) => {
        stream = s;
        const el = video.current;
        if (stopped || el === null) return;
        el.srcObject = s;
        await el.play();
        const look = async (): Promise<void> => {
          if (stopped) return;
          const [found] = await detector.detect(el).catch(() => []);
          if (found !== undefined && found.rawValue.startsWith('kq_')) onCode(found.rawValue);
          else timer = window.setTimeout(() => void look(), 300);
        };
        await look();
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [camera, Detector, onCode]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-display text-3xl font-bold tracking-tight">Show your QR code</h1>
      <p className="max-w-xl text-lg text-fg-muted">
        {camera
          ? 'Open Time Off on your phone, show your kiosk code and hold it up to the camera.'
          : 'Open Time Off on your phone, show your kiosk code and hold it to the reader.'}
      </p>
      {camera ? (
        <video
          ref={video}
          muted
          playsInline
          aria-label="Camera"
          className="aspect-square w-72 rounded-2xl bg-surface object-cover"
        />
      ) : null}
      <Button size="lg" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
