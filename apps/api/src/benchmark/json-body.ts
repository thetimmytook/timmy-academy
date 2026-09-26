import { BenchmarkRequestError } from './repository';

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();

  if (mediaType !== 'application/json') {
    throw new BenchmarkRequestError('unsupported_media_type');
  }

  // Enforce a small streaming limit, including chunked requests without Content-Length.
  const reader = request.body?.getReader();

  if (!reader) {
    throw new BenchmarkRequestError('invalid_input');
  }

  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    length += chunk.value.byteLength;

    if (length > maxBytes) {
      await reader.cancel();
      throw new BenchmarkRequestError('payload_too_large');
    }

    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;

  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new BenchmarkRequestError('invalid_input');
  }

  return body;
}
