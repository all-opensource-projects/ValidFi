import { Logger } from '@nestjs/common';
import { DataSource, MigrationExecutor } from 'typeorm';

/**
 * Arbitrary but fixed key identifying the schema-migration lock. Every process
 * that migrates this database must use the same value.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 4071982411;

/**
 * Runs `work` while holding a PostgreSQL session-level advisory lock, so that
 * only one process at a time can change the schema.
 *
 * TypeORM decides which migrations are pending before recording them and takes
 * no cross-process lock of its own, so two instances starting at once (a
 * rolling deploy, a replica set, or an operator running a revert while an
 * instance boots) can each decide the same migration is pending and run its
 * non-idempotent DDL twice. The lock serialises them: the loser blocks until
 * the winner commits and releases, then re-reads the migrations table and
 * finds the work already done.
 *
 * The lock is deliberately held on its own connection rather than the one
 * TypeORM uses for the DDL — an advisory lock is a mutex between *sessions*,
 * and it only has to be held for the duration of the work it guards. Holding
 * it on a dedicated session also keeps it alive across the several connections
 * TypeORM opens and closes internally while migrating.
 *
 * Note this needs a session-pooled connection — under a transaction-pooling
 * proxy such as PgBouncer in `transaction` mode, session-level advisory locks
 * are not held across statements.
 */
export async function withMigrationLock<T>(
  dataSource: DataSource,
  logger: Logger,
  work: () => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    logger.log('Waiting for the schema migration lock...');
    await queryRunner.query('SELECT pg_advisory_lock($1)', [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);

    try {
      return await work();
    } finally {
      await queryRunner.query('SELECT pg_advisory_unlock($1)', [
        MIGRATION_ADVISORY_LOCK_KEY,
      ]);
    }
  } finally {
    // Nested so that a failing unlock cannot leak the connection back to a
    // pool that will never see it returned.
    await queryRunner.release();
  }
}

/** Applies every pending migration, in one transaction, under the lock. */
export async function runPendingMigrations(
  dataSource: DataSource,
  logger: Logger = new Logger('Migrations'),
): Promise<void> {
  await withMigrationLock(dataSource, logger, async () => {
    const applied = await dataSource.runMigrations({ transaction: 'all' });

    if (applied.length === 0) {
      logger.log('Schema is up to date; no migrations to apply.');
    } else {
      logger.log(
        `Applied ${applied.length} migration(s): ${applied
          .map((migration) => migration.name)
          .join(', ')}`,
      );
    }
  });
}

/** Reverts the most recently applied migration, under the lock. */
export async function revertLastMigration(
  dataSource: DataSource,
  logger: Logger = new Logger('Migrations'),
): Promise<void> {
  await withMigrationLock(dataSource, logger, async () => {
    await dataSource.undoLastMigration({ transaction: 'all' });
    logger.log('Reverted the last migration.');
  });
}

/**
 * Records pending migrations as applied *without* running their DDL, under the
 * lock.
 *
 * This is the one-time baseline step for a database whose schema was built by
 * `synchronize` and so has the tables but no rows in the migrations table.
 * Only run it after confirming the live schema already matches the entities —
 * see `docs/DATABASE_MIGRATIONS.md`.
 */
export async function baselineMigrations(
  dataSource: DataSource,
  logger: Logger = new Logger('Migrations'),
): Promise<void> {
  await withMigrationLock(dataSource, logger, async () => {
    // A fake run resolves to an empty array — TypeORM records the migration
    // and skips the bookkeeping it does for real runs — so the names have to
    // be read before faking them.
    const pending = await new MigrationExecutor(
      dataSource,
    ).getPendingMigrations();

    if (pending.length === 0) {
      logger.log('Nothing to baseline; every migration is already recorded.');
      return;
    }

    await dataSource.runMigrations({ transaction: 'all', fake: true });

    logger.warn(
      `Recorded ${pending.length} migration(s) as applied without running them: ${pending
        .map((migration) => migration.name)
        .join(', ')}`,
    );
  });
}
