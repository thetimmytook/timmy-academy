import { readFileSync } from 'node:fs';

import { parse } from 'jsonc-parser';

type DatabaseBinding = {
  binding: string;
  database_id: string;
  database_name: string;
  remote?: boolean;
};
type EnvironmentConfig = { d1_databases?: DatabaseBinding[] };
type DatabaseConfig = EnvironmentConfig & {
  env?: { staging?: EnvironmentConfig; production?: EnvironmentConfig };
};

export function checkDatabaseTarget(environment: string): void {
  const parsed: unknown = parse(readFileSync('infrastructure/wrangler.jsonc', 'utf8'));
  const config = parsed as DatabaseConfig;
  const binding = (list: DatabaseBinding[] | undefined) =>
    list?.find(value => value.binding === 'BENCHMARK_DB');
  const local = binding(config.d1_databases);

  if (local?.database_id !== 'local-only' || local?.remote === true) {
    throw new Error('The local Benchmark binding must remain local-only.');
  }

  if (environment === 'local') {
    return;
  }

  const staging = binding(config.env?.staging?.d1_databases);
  const production = binding(config.env?.production?.d1_databases);
  const target = environment === 'staging' ? staging : production;

  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(target?.database_id ?? '')
  ) {
    throw new Error('Configure the target D1 database ID in infrastructure/wrangler.jsonc first.');
  }

  if (
    staging?.database_id === production?.database_id ||
    staging?.database_name === production?.database_name
  ) {
    throw new Error('Staging and production must use separate D1 databases.');
  }
}
