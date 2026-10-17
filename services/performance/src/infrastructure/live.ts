import { EventEmitter } from 'node:events';

import type { Live } from '../application/ports.js';

/**
 * The live stream behind the cycle subscription (PRD §8.7): what a committed
 * write changed, told to every subscriber of that company, in this process.
 *
 * ponytail: one process, so an in-process emitter; Postgres LISTEN/NOTIFY or
 * the outbox topic when Performance runs on more than one instance.
 */
export function inProcessLive(): Live {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  return {
    publish: (tenantId, change) => {
      bus.emit(tenantId, change);
    },
    subscribe: (tenantId, listener) => {
      bus.on(tenantId, listener);
      return () => {
        bus.off(tenantId, listener);
      };
    },
  };
}
