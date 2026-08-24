import { Logger } from '@nestjs/common';
import { AppDataSource } from './data-source';
import { runPendingMigrations } from './database/run-migrations';

/**
 * Standalone migration entry point for deployments: `node dist/migrate.js`.
 *
 * Runs without Nest and without ts-node, so it works on a host installed with
 * `npm install --production`, and takes the same advisory lock the application
 * takes on startup.
 */
async function migrate(): Promise<void> {
  const logger = new Logger('Migrations');
  await AppDataSource.initialize();

  try {
    await runPendingMigrations(AppDataSource, logger);
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((error) => {
  new Logger('Migrations').error('Migration run failed', error?.stack ?? error);
  process.exit(1);
});
