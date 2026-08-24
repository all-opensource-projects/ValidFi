import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  baselineMigrations,
  revertLastMigration,
  runPendingMigrations,
} from './run-migrations';

export type MigrationCommand = (
  dataSource: DataSource,
  logger: Logger,
) => Promise<void>;

export const MIGRATION_COMMANDS: Record<string, MigrationCommand> = {
  run: runPendingMigrations,
  revert: revertLastMigration,
  baseline: baselineMigrations,
};

export const DEFAULT_MIGRATION_COMMAND = 'run';

/**
 * Resolves a command name to its handler.
 *
 * Deliberately an own-property check: `'toString' in MIGRATION_COMMANDS` is
 * true, so a plain `in` would let a typo resolve to something off
 * `Object.prototype` and exit successfully without migrating anything.
 */
export function resolveMigrationCommand(name: string): MigrationCommand {
  if (!Object.prototype.hasOwnProperty.call(MIGRATION_COMMANDS, name)) {
    throw new Error(
      `Unknown command "${name}". Expected one of: ${Object.keys(
        MIGRATION_COMMANDS,
      ).join(', ')}.`,
    );
  }

  return MIGRATION_COMMANDS[name];
}
