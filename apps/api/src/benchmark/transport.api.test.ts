import { benchmarkErrorSchema, cohortResponseSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { COHORT_QUERY_MAX_BODY_BYTES } from '../config';
import { createApp } from '../index';

import { InMemoryBenchmarkRepository } from './in-memory-repository';

const app = createApp(new InMemoryBenchmarkRepository());
const path = '/api/bench/v1/cohorts/query';
const jsonType = 'application/json';
const validBody = JSON.stringify({
  hardware: { cpu_name: 'Ryzen 7 7800X3D', gpu_name: 'GeForce RTX 4070 SUPER', ram_gb: 32 },
  map: 'lighthouse',
  execution: 'bsg_servers',
  game_resolution: { width: 2560, height: 1440 },
  game_version: '0.16.9.0',
});

describe('Position transport policy', () => {
  it.each([jsonType, 'Application/JSON', 'application/json; charset=utf-8'])(
    'accepts %s',
    async contentType => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: validBody,
      });
      expect(response.status).toBe(200);
      expect(cohortResponseSchema.parse(await response.json()).status).toBe('matches');
    },
  );
  it.each([undefined, 'text/plain', 'application/problem+json', 'application/jsonp'])(
    'rejects missing/unsupported media type %s',
    async contentType => {
      const response = await app.request(path, {
        method: 'POST',
        headers: contentType === undefined ? {} : { 'content-type': contentType },
        body: new TextEncoder().encode(validBody),
      });
      expect(response.status).toBe(415);
      expect(benchmarkErrorSchema.parse(await response.json()).code).toBe('unsupported_media_type');
    },
  );
  it('accepts exactly the byte limit and rejects one byte more', async () => {
    for (const extra of [0, 1]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': jsonType },
        body: validBody.padEnd(COHORT_QUERY_MAX_BODY_BYTES + extra),
      });
      expect(response.status).toBe(extra === 0 ? 200 : 413);

      if (extra !== 0) {
        expect(benchmarkErrorSchema.parse(await response.json()).code).toBe('payload_too_large');
      }
    }
  });
  it('counts UTF-8 bytes rather than characters', async () => {
    const body = JSON.stringify({ extra: 'é'.repeat(2100) });
    expect(body.length).toBeLessThan(COHORT_QUERY_MAX_BODY_BYTES);
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': jsonType },
      body,
    });
    expect(response.status).toBe(413);
    expect(benchmarkErrorSchema.parse(await response.json()).code).toBe('payload_too_large');
  });
  it.each([undefined, '1'])(
    'enforces the streamed limit with Content-Length %s',
    async contentLength => {
      let canceled = false;
      let chunk = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller): void {
          controller.enqueue(
            new Uint8Array(chunk++ === 0 ? COHORT_QUERY_MAX_BODY_BYTES : 1).fill(32),
          );
        },
        cancel(): void {
          canceled = true;
        },
      });
      const init = {
        method: 'POST',
        headers: {
          'content-type': jsonType,
          ...(contentLength === undefined ? {} : { 'content-length': contentLength }),
        },
        body,
        duplex: 'half',
      };
      const response = await app.request(path, init);
      expect(response.status).toBe(413);
      expect(benchmarkErrorSchema.parse(await response.json()).code).toBe('payload_too_large');
      expect(canceled).toBe(true);
    },
  );
  it.each(['', '{', 'null'])(
    'keeps invalid JSON/DTO errors separate from transport errors: %j',
    async body => {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': jsonType },
        body,
      });
      expect(response.status).toBe(422);
      expect(benchmarkErrorSchema.parse(await response.json()).code).toBe('invalid_input');
    },
  );
});
