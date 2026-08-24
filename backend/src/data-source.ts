import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { buildDatabaseOptions } from './config/database.config';

// The CLI runs outside Nest, so the .env file has to be loaded by hand.
loadEnv();

/**
 * Options used by the TypeORM CLI. Schema changes must go through migrations,
 * so the CLI never synchronizes or auto-runs migrations as a side effect.
 */
export const dataSourceOptions: DataSourceOptions = {
  ...buildDatabaseOptions((key) => process.env[key]),
  synchronize: false,
  migrationsRun: false,
};

/**
 * Data source for `npm run typeorm -- <command>`, e.g.
 * `npm run migration:generate -- src/migrations/AddSomething`.
 */
export const AppDataSource = new DataSource(dataSourceOptions);
