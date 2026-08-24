import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * Reads a configuration value. Lets the same options be built from either
 * Nest's ConfigService or raw `process.env` (TypeORM CLI).
 */
export type EnvReader = (key: string) => string | undefined;

/**
 * Strict check: anything other than an explicit `development` is treated as a
 * non-development environment, so an unset NODE_ENV never enables auto sync.
 */
export const isDevelopment = (get: EnvReader): boolean =>
  get('NODE_ENV') === 'development';

/**
 * Single source of truth for the database connection, shared by the Nest
 * application and the TypeORM CLI data source so both always agree on where
 * entities and migrations live.
 */
export const buildDatabaseOptions = (get: EnvReader): DataSourceOptions => {
  const development = isDevelopment(get);

  return {
    type: 'postgres',
    host: get('DB_HOST') ?? 'localhost',
    port: parseInt(get('DB_PORT') ?? '5432', 10),
    username: get('DB_USERNAME') ?? 'postgres',
    password: get('DB_PASSWORD') ?? 'postgres',
    database: get('DB_DATABASE') ?? 'securedata',
    entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
    migrations: [join(__dirname, '..', 'migrations', '*{.ts,.js}')],
    migrationsTableName: 'migrations',
    // Auto schema sync is a development-only convenience; every other
    // environment gets its schema exclusively from migrations.
    synchronize: development,
    // Migrations are never run by TypeORM's own bootstrap hook: outside
    // development the app applies them explicitly in `main.ts` via
    // `runPendingMigrations`, which serialises concurrent instances behind a
    // PostgreSQL advisory lock that `migrationsRun` cannot take.
    migrationsRun: false,
    logging: development,
  };
};
