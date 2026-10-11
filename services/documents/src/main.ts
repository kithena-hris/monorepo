import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { sweepTrash } from './application/organise.js';
import { composeDocuments } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';
import { tenantsWithDocuments } from './infrastructure/unit-of-work.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener, storage } = await composeDocuments(process.env);
wireConsumers(process.env, storage?.uow ?? null);

// The trash sweep, every six hours: documents deleted 30 days ago lose their bytes.
// ponytail: a timer per process; a BullMQ repeatable job when Documents runs twice.
if (storage !== null) {
  const sweep = async () => {
    for (const tenantId of await tenantsWithDocuments(storage.db)) {
      try {
        const { destroyed } = await sweepTrash(storage.deps, tenantId);
        if (destroyed > 0) logger.info({ tenantId, destroyed }, 'trash swept');
      } catch (error) {
        logger.error({ err: error, tenantId }, 'trash sweep failed for a tenant');
      }
    }
  };
  const timer = setInterval(() => void sweep(), 6 * 60 * 60 * 1000);
  timer.unref();
  onShutdown('trash sweep', async () => clearInterval(timer));
}

const server = createServer(listener);
onShutdown('http server', () => drain(server));
// 4003 by convention (modules on 40xx); `DOCUMENTS_PORT` for a second copy.
const port = Number(process.env['DOCUMENTS_PORT'] ?? 4003);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});
