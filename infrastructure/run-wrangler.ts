import { spawnSync } from 'node:child_process';

// Wrangler includes database/account identifiers in normal output. Keep those
// out of terminal and Actions logs. Do not print child-process error objects.

export function runWrangler(args: string[]): void {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: 'true' },
  });

  const redact = (text: string | null): string =>
    (text ?? '')
      .replace(/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi, '[database-id]')
      .replaceAll(process.env.CLOUDFLARE_ACCOUNT_ID || '___NO_ACCOUNT_ID___', '[account-id]');
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));

  if (result.error) {
    throw new Error('Could not start Wrangler.');
  }

  if (result.status !== 0) {
    throw new Error('Wrangler failed; see the redacted output above.');
  }
}
