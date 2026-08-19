import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

/**
 * Called before anything else in a service entrypoint. The correlationId from
 * the event envelope rides along as baggage, so one user action is traceable
 * from click through event through downstream projection.
 */
export function startTelemetry(serviceName: string): NodeSDK {
  const sdk = new NodeSDK({
    serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk.shutdown());
  return sdk;
}
