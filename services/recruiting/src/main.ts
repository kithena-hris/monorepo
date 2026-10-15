import { createServer } from 'node:http';
import { drain, logger, onShutdown, startTelemetry } from '@kithena/telemetry';

import manifest from '../module.manifest.js';
import { composeRecruiting } from './composition.js';

startTelemetry(`kithena-${manifest.key}`);
const { listener } = await composeRecruiting(process.env);

const server = createServer(listener);
onShutdown('http server', () => drain(server));
// 4005 by convention (modules on 40xx); `RECRUITING_PORT` for a second copy.
const port = Number(process.env['RECRUITING_PORT'] ?? 4005);
server.listen(port, () => {
  logger.info({ module: manifest.key, port }, 'subgraph listening');
});
