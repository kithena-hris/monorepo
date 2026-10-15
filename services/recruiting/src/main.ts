import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { daily, sendDueMessages } from './application/background.js';
import { composeRecruiting } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener, storage } = await composeRecruiting(process.env);
wireConsumers(process.env, storage?.uow ?? null);

// The thread's emails every minute; offers, pool consents and retention daily.
// ponytail: timers in one process; BullMQ repeatable jobs when Recruiting runs twice.
if (storage !== null) {
  const every = (ms: number, name: string, job: () => Promise<unknown>) => {
    const timer = setInterval(() => {
      job().catch((error: unknown) => {
        logger.error({ err: error, job: name }, 'recruiting job failed');
      });
    }, ms);
    timer.unref();
    onShutdown(name, () => {
      clearInterval(timer);
      return Promise.resolve();
    });
  };
  every(60_000, 'recruiting messages', () => sendDueMessages(storage.deps));
  every(24 * 60 * 60_000, 'recruiting daily', () => daily(storage.deps));
}

const server = createServer(listener);
onShutdown('http server', () => drain(server));
// 4005 by convention (modules on 40xx); `RECRUITING_PORT` for a second copy.
const port = Number(process.env['RECRUITING_PORT'] ?? 4005);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});
