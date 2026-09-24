/**
 * How a consumer reaches the broker, from the environment.
 *
 * Here beside the outbox because it is the other half of the same pipeline:
 * the outbox is how an event leaves a module, this is how a module connects
 * to read one. Identity and People both build their kafkajs client from it,
 * so a managed cluster works for every consumer or for none.
 *
 * - `KAFKA_BROKERS` — comma separated. Unset or empty: `null`, and the caller
 *   consumes nothing, as before.
 * - `KAFKA_SASL_MECHANISM` — `scram-sha-256` or `scram-sha-512`, with
 *   `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD`. All three or none.
 * - `KAFKA_TLS` — `true` or `false`. Defaults to on when SASL is set (a
 *   managed Redpanda requires both) and off otherwise (a broker on a private
 *   network, or compose).
 * - `KAFKA_TLS_CA` — a PEM bundle to trust instead of the system roots, for
 *   a broker with a private CA. Implies TLS. Certificate checking is never
 *   switchable off.
 *
 * **Fails closed.** Anything half-configured or unrecognised throws, in every
 * environment: a consumer that quietly connects without the credentials it
 * was meant to have is a misconfiguration discovered later, somewhere worse.
 * In production (`NODE_ENV=production`) SASL without TLS throws as well. The
 * message names the variable, never a value.
 *
 * **The password is not enumerable.** kafkajs reads it by name; a log line,
 * `JSON.stringify` or a spread of the config does not see it.
 */

export type ScramMechanism = 'scram-sha-256' | 'scram-sha-512';

/** Structurally kafkajs's `KafkaConfig`, so this package need not depend on kafkajs. */
export interface KafkaClientConfig {
  readonly clientId: string;
  readonly brokers: string[];
  readonly ssl?: true | { readonly ca: string[] };
  readonly sasl?: ScramCredentials<'scram-sha-256'> | ScramCredentials<'scram-sha-512'>;
}

interface ScramCredentials<M extends ScramMechanism> {
  readonly mechanism: M;
  readonly username: string;
  readonly password: string;
}

const MECHANISMS: readonly ScramMechanism[] = ['scram-sha-256', 'scram-sha-512'];

const set = (value: string | undefined): value is string => value !== undefined && value !== '';

function refuse(message: string): never {
  throw new Error(`Kafka configuration: ${message}`);
}

export function kafkaConfigFrom(
  env: NodeJS.ProcessEnv,
  clientId: string,
): KafkaClientConfig | null {
  const brokers = (env['KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b !== '');
  if (brokers.length === 0) return null;

  const mechanism = env['KAFKA_SASL_MECHANISM'];
  const username = env['KAFKA_SASL_USERNAME'];
  const password = env['KAFKA_SASL_PASSWORD'];
  const given = [mechanism, username, password].filter(set).length;
  if (given !== 0 && given !== 3) {
    refuse(
      'KAFKA_SASL_MECHANISM, KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are set together or not at all',
    );
  }
  let sasl: KafkaClientConfig['sasl'];
  if (given === 3) {
    const normalised = (mechanism ?? '').toLowerCase() as ScramMechanism;
    if (!MECHANISMS.includes(normalised)) {
      refuse('KAFKA_SASL_MECHANISM must be scram-sha-256 or scram-sha-512');
    }
    const credentials = { mechanism: normalised, username: username ?? '' };
    Object.defineProperty(credentials, 'password', { value: password, enumerable: false });
    sasl = credentials as NonNullable<KafkaClientConfig['sasl']>;
  }

  const ca = env['KAFKA_TLS_CA'];
  const tlsSetting = env['KAFKA_TLS'];
  if (set(tlsSetting) && tlsSetting !== 'true' && tlsSetting !== 'false') {
    refuse('KAFKA_TLS must be true or false');
  }
  if (set(ca) && tlsSetting === 'false') refuse('KAFKA_TLS_CA is set but KAFKA_TLS is false');
  if (set(ca) && !ca.includes('-----BEGIN CERTIFICATE-----')) {
    refuse('KAFKA_TLS_CA must be a PEM certificate bundle');
  }
  const tls = set(tlsSetting) ? tlsSetting === 'true' : sasl !== undefined || set(ca);
  if (sasl !== undefined && !tls && env['NODE_ENV'] === 'production') {
    refuse('SASL without TLS is refused in production; unset KAFKA_TLS or set it to true');
  }

  return {
    clientId,
    brokers,
    ...(tls ? { ssl: set(ca) ? { ca: [ca] } : (true as const) } : {}),
    ...(sasl === undefined ? {} : { sasl }),
  };
}
