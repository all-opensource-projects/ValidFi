import { Logger } from '@nestjs/common';
import { AppDataSource } from './data-source';
import {
  baselineMigrations,
  revertLastMigration,
  runPendingMigrations,
} from './database/run-migrations';

/**
 * Standalone migration entry point for deployments:
 * `node dist/migrate.js [run|revert|baseline]`.
 *
 * Runs without Nest and without ts-node, so it works on a host installed with
 * `npm install --production`. Every command goes through the same advisory
 * lock the application takes on startup, so no schema operation can race
 * another one.
 */
const COMMANDS = {
  run: runPendingMigrations,
  revert: revertLastMigration,
  baseline: baselineMigrations,
};

type Command = keyof typeof COMMANDS;

const isCommand = (value: string): value is Command => value in COMMANDS;

async function migrate(): Promise<void> {
  const logger = new Logger('Migrations');
  const requested = process.argv[2] ?? 'run';

  if (!isCommand(requested)) {
    throw new Error(
      `Unknown command "${requested}". Expected one of: ${Object.keys(
        COMMANDS,
      ).join(', ')}.`,
    );
  }

  await AppDataSource.initialize();

  try {
    await COMMANDS[requested](AppDataSource, logger);
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((error) => {
  new Logger('Migrations').error('Migration run failed', error?.stack ?? error);
  process.exit(1);
});
