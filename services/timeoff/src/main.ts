import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';
import manifest from '../module.manifest.js';
import { composeTimeOff } from './composition.js';
import { wireConsumers } from './infrastructure/consumers/wire.js';
import { wireBackground } from './infrastructure/background.js';

startTelemetry(`kithena-${manifest.key}`);
// REST, the subgraph and what they stand on (`composition.ts`).
const { listener, storage } = await composeTimeOff(process.env);
wireConsumers(
  process.env,
  storage?.uow ?? null,
  storage?.tuples,
  storage?.reach,
  storage?.feedSecret,
);
wireBackground(process.env, storage?.db ?? null, storage?.reach);

const server = createServer(listener);

// SIGTERM drains it, then the process exits (PEO-118).
onShutdown('http server', () => drain(server));
// 4002 by convention (modules on 40xx); `TIMEOFF_PORT` for a second copy, as an acceptance run starts.
const port = Number(process.env['TIMEOFF_PORT'] ?? 4002);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});
