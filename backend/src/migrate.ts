import { Logger } from '@nestjs/common';
import { AppDataSource } from './data-source';
import {
  DEFAULT_MIGRATION_COMMAND,
  resolveMigrationCommand,
} from './database/migration-commands';

/**
 * Standalone migration entry point for deployments:
 * `node dist/migrate.js [run|revert|baseline]`.
 *
 * Runs without Nest and without ts-node, so it works on a host installed with
 * `npm install --production`. Every command goes through the same advisory
 * lock the application takes on startup, so no schema operation can race
 * another one.
 */
async function migrate(): Promise<void> {
  const logger = new Logger('Migrations');
  const command = resolveMigrationCommand(
    process.argv[2] ?? DEFAULT_MIGRATION_COMMAND,
  );

  await AppDataSource.initialize();

  try {
    await command(AppDataSource, logger);
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((error) => {
  new Logger('Migrations').error('Migration run failed', error?.stack ?? error);
  process.exit(1);
});
