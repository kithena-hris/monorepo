import type { Server } from 'node:http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import { logger } from './logger.js';

/**
 * Called before anything else in a service entrypoint. The correlationId from
 * the event envelope rides along as baggage, so one user action is traceable
 * from click through event through downstream projection.
 *
 * It also owns the process's end (PEO-118). On SIGTERM or SIGINT every step
 * registered with `onShutdown` runs — the server stops accepting and drains,
 * pollers and workers finish the job in hand, consumers leave their group,
 * pools close — then the spans are flushed and the process exits: 0 when all
 * of it finished, 1 when a step failed or the deadline passed first. The
 * deadline is `SHUTDOWN_DEADLINE_MS`, 10 s by default, inside the 30 s an
 * orchestrator gives before it sends SIGKILL.
 */
export function startTelemetry(serviceName: string): NodeSDK {
  const sdk = new NodeSDK({
    serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  const stop = (signal: NodeJS.Signals): void => {
    void shutdown(signal, () => sdk.shutdown());
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return sdk;
}

type Step = () => Promise<unknown>;
const steps: { name: string; step: Step }[] = [];
const pending = new Set<string>();
const FLUSH_MS = 2000;
let stopping = false;

/**
 * Something to stop before the process exits. Steps run concurrently, so one
 * step is one resource and its own order: drain the server, then close the
 * pool its requests use.
 */
export function onShutdown(name: string, step: Step): void {
  steps.push({ name, step });
}

/**
 * Stop accepting, and resolve once every request in flight has answered.
 *
 * `close()` refuses new connections and drops idle keep-alive ones; a
 * connection still serving a request is closed when that response ends.
 */
export function drain(server: Server): Promise<void> {
  let drained = draining.get(server);
  if (drained === undefined) {
    drained = server.listening ? close(server) : Promise.resolve();
    draining.set(server, drained);
  }
  return drained;
}

/** One drain per server, so two steps awaiting it both wait for the real one. */
const draining = new WeakMap<Server, Promise<void>>();

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
    // A keep-alive connection that finishes its request after `close()` is
    // idle again, and would hold the server open until its timeout.
    const idle = setInterval(() => {
      server.closeIdleConnections();
    }, 100);
    server.once('close', () => {
      clearInterval(idle);
    });
  });
}

async function shutdown(signal: NodeJS.Signals, flush: () => Promise<void>): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = Number(process.env['SHUTDOWN_DEADLINE_MS'] ?? 10_000);
  logger.info({ signal, steps: steps.length, deadline }, 'shutting down');
  setTimeout(() => {
    logger.error(
      { deadline, unfinished: [...pending] },
      'shutdown did not finish within its deadline; exiting',
    );
    process.exit(1);
  }, deadline);

  const results = await Promise.allSettled(
    steps.map(async ({ name, step }) => {
      pending.add(name);
      try {
        await step();
      } catch (error) {
        logger.error({ err: error, step: name }, 'shutdown step failed');
        throw error;
      } finally {
        pending.delete(name);
      }
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  // Last, so the spans of the drained requests are in what is flushed.
  // Bounded on its own: an unreachable collector retries for thirty seconds,
  // and losing a few spans is no reason to report a clean stop as failed.
  const flushed = await Promise.race([
    flush().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => setTimeout(resolve, FLUSH_MS, false)),
  ]);
  if (!flushed) logger.warn({ within: FLUSH_MS }, 'telemetry was not flushed');
  process.exit(failed.length === 0 ? 0 : 1);
}
