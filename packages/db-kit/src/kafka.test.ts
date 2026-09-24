import { describe, expect, it } from 'vitest';

import { kafkaConfigFrom } from './kafka.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const SASL = {
  KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512',
  KAFKA_SASL_USERNAME: 'people',
  KAFKA_SASL_PASSWORD: 'hunter2-secret',
};
const from = (env: NodeJS.ProcessEnv) => kafkaConfigFrom(env, 'people');

describe('kafkaConfigFrom', () => {
  it('is null with no brokers, so the caller consumes nothing', () => {
    expect(from({})).toBeNull();
    expect(from({ KAFKA_BROKERS: ' , ' })).toBeNull();
  });

  it('is a plain broker list when nothing else is set', () => {
    expect(from({ KAFKA_BROKERS: 'a:9092, b:9092' })).toEqual({
      clientId: 'people',
      brokers: ['a:9092', 'b:9092'],
    });
  });

  it('turns TLS on by default with SASL, and takes either SCRAM mechanism', () => {
    const config = from({ KAFKA_BROKERS: 'a:9092', ...SASL });
    expect(config?.ssl).toBe(true);
    expect(config?.sasl).toMatchObject({ mechanism: 'scram-sha-512', username: 'people' });
    expect(config?.sasl?.password).toBe('hunter2-secret');
    expect(
      from({ KAFKA_BROKERS: 'a:9092', ...SASL, KAFKA_SASL_MECHANISM: 'scram-sha-256' })?.sasl
        ?.mechanism,
    ).toBe('scram-sha-256');
  });

  it('never exposes the password to a serialiser', () => {
    const config = from({ KAFKA_BROKERS: 'a:9092', ...SASL });
    expect(JSON.stringify(config)).not.toContain('hunter2');
    expect(JSON.stringify({ ...config?.sasl })).not.toContain('hunter2');
  });

  it('refuses SASL half-configured, naming the variables and never the value', () => {
    for (const missing of Object.keys(SASL)) {
      const env: NodeJS.ProcessEnv = { KAFKA_BROKERS: 'a:9092', ...SASL, [missing]: '' };
      expect(() => from(env)).toThrow(/set together or not at all/);
      try {
        from(env);
      } catch (error) {
        expect(String(error)).not.toContain('hunter2');
      }
    }
  });

  it('refuses a mechanism it does not support', () => {
    expect(() => from({ KAFKA_BROKERS: 'a:9092', ...SASL, KAFKA_SASL_MECHANISM: 'plain' })).toThrow(
      /scram-sha-256 or scram-sha-512/,
    );
  });

  it('allows SASL without TLS off production only', () => {
    const env = { KAFKA_BROKERS: 'a:9092', ...SASL, KAFKA_TLS: 'false' };
    expect(from(env)?.ssl).toBeUndefined();
    expect(() => from({ ...env, NODE_ENV: 'production' })).toThrow(/refused in production/);
  });

  it('takes a CA bundle, which implies TLS', () => {
    expect(from({ KAFKA_BROKERS: 'a:9092', KAFKA_TLS_CA: PEM })?.ssl).toEqual({ ca: [PEM] });
    expect(from({ KAFKA_BROKERS: 'a:9092', KAFKA_TLS: 'true' })?.ssl).toBe(true);
  });

  it('refuses a TLS setting it cannot read', () => {
    expect(() => from({ KAFKA_BROKERS: 'a:9092', KAFKA_TLS: 'yes' })).toThrow(/true or false/);
    expect(() => from({ KAFKA_BROKERS: 'a:9092', KAFKA_TLS: 'false', KAFKA_TLS_CA: PEM })).toThrow(
      /KAFKA_TLS is false/,
    );
    expect(() => from({ KAFKA_BROKERS: 'a:9092', KAFKA_TLS_CA: 'not a pem' })).toThrow(/PEM/);
  });
});
