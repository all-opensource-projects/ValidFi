import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Arbitrary but fixed key identifying the schema-migration lock. Every process
 * that migrates this database must use the same value.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 4071982411;

/**
 * Applies pending migrations while holding a PostgreSQL session-level advisory
 * lock.
 *
 * TypeORM checks which migrations are pending before recording them and takes
 * no cross-process lock of its own, so two instances starting at once (a
 * rolling deploy, a replica set, or a deploy script racing the app) can each
 * decide the same migration is pending and run its DDL twice. The advisory
 * lock serialises them: the loser blocks until the winner commits, then finds
 * nothing left to apply.
 *
 * Note this needs a session-pooled connection — under a transaction-pooling
 * proxy such as PgBouncer in `transaction` mode, session-level advisory locks
 * are not held across statements.
 */
export async function runPendingMigrations(
  dataSource: DataSource,
  logger: Logger = new Logger('Migrations'),
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    logger.log('Waiting for the schema migration lock...');
    await queryRunner.query('SELECT pg_advisory_lock($1)', [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);

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
  } finally {
    await queryRunner.query('SELECT pg_advisory_unlock($1)', [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    await queryRunner.release();
  }
}
