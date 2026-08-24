import { Logger } from '@nestjs/common';
import { DataSource, MigrationExecutor } from 'typeorm';
import {
  baselineMigrations,
  MIGRATION_ADVISORY_LOCK_KEY,
  revertLastMigration,
  runPendingMigrations,
  withMigrationLock,
} from './run-migrations';

const LOCK = 'SELECT pg_advisory_lock($1)';
const UNLOCK = 'SELECT pg_advisory_unlock($1)';

const pendingMigrations = jest.fn().mockResolvedValue([]);

jest.mock('typeorm', () => ({
  ...jest.requireActual('typeorm'),
  MigrationExecutor: jest.fn(),
}));

describe('migration helpers', () => {
  const silentLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  type Harness = {
    dataSource: DataSource;
    calls: string[];
    query: jest.Mock;
    release: jest.Mock;
  };

  const buildHarness = (
    overrides: {
      runMigrations?: jest.Mock;
      undoLastMigration?: jest.Mock;
      onQuery?: (sql: string) => void;
    } = {},
  ): Harness => {
    const calls: string[] = [];

    const query = jest.fn(async (sql: string) => {
      calls.push(sql);
      overrides.onQuery?.(sql);
      return [];
    });
    const release = jest.fn();

    const dataSource = {
      createQueryRunner: () => ({ connect: jest.fn(), query, release }),
      runMigrations: jest.fn(async (...args: unknown[]) => {
        calls.push('runMigrations');
        return overrides.runMigrations?.(...args) ?? [];
      }),
      undoLastMigration: jest.fn(async (...args: unknown[]) => {
        calls.push('undoLastMigration');
        return overrides.undoLastMigration?.(...args);
      }),
    } as unknown as DataSource;

    return { dataSource, calls, query, release };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pendingMigrations.mockResolvedValue([]);
    (MigrationExecutor as unknown as jest.Mock).mockImplementation(() => ({
      getPendingMigrations: pendingMigrations,
    }));
  });

  describe('withMigrationLock', () => {
    it('brackets the work with the advisory lock', async () => {
      const { dataSource, calls, query } = buildHarness();

      await withMigrationLock(dataSource, silentLogger, async () => {
        calls.push('work');
      });

      expect(calls).toEqual([LOCK, 'work', UNLOCK]);
      expect(query).toHaveBeenCalledWith(LOCK, [MIGRATION_ADVISORY_LOCK_KEY]);
      expect(query).toHaveBeenCalledWith(UNLOCK, [MIGRATION_ADVISORY_LOCK_KEY]);
    });

    it('releases the lock when the work throws', async () => {
      const { dataSource, calls, release } = buildHarness();

      await expect(
        withMigrationLock(dataSource, silentLogger, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(calls).toContain(UNLOCK);
      expect(release).toHaveBeenCalled();
    });

    it('releases the query runner even when the unlock query fails', async () => {
      const { dataSource, release } = buildHarness({
        onQuery: (sql) => {
          if (sql === UNLOCK) {
            throw new Error('connection lost');
          }
        },
      });

      await expect(
        withMigrationLock(dataSource, silentLogger, async () => undefined),
      ).rejects.toThrow('connection lost');

      expect(release).toHaveBeenCalled();
    });

    it('returns the value produced by the work', async () => {
      const { dataSource } = buildHarness();

      await expect(
        withMigrationLock(dataSource, silentLogger, async () => 'done'),
      ).resolves.toBe('done');
    });
  });

  describe('runPendingMigrations', () => {
    it('runs migrations inside the lock, in a single transaction', async () => {
      const { dataSource, calls } = buildHarness({
        runMigrations: jest.fn().mockResolvedValue([{ name: 'InitialSchema1' }]),
      });

      await runPendingMigrations(dataSource, silentLogger);

      expect(calls).toEqual([LOCK, 'runMigrations', UNLOCK]);
      expect(dataSource.runMigrations).toHaveBeenCalledWith({
        transaction: 'all',
      });
    });
  });

  describe('revertLastMigration', () => {
    it('reverts inside the lock', async () => {
      const { dataSource, calls } = buildHarness();

      await revertLastMigration(dataSource, silentLogger);

      expect(calls).toEqual([LOCK, 'undoLastMigration', UNLOCK]);
      expect(dataSource.undoLastMigration).toHaveBeenCalledWith({
        transaction: 'all',
      });
    });
  });

  describe('baselineMigrations', () => {
    it('records pending migrations as applied without running their DDL', async () => {
      pendingMigrations.mockResolvedValue([{ name: 'InitialSchema1' }]);
      const { dataSource, calls } = buildHarness();

      await baselineMigrations(dataSource, silentLogger);

      expect(calls).toEqual([LOCK, 'runMigrations', UNLOCK]);
      expect(dataSource.runMigrations).toHaveBeenCalledWith({
        transaction: 'all',
        fake: true,
      });
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('InitialSchema1'),
      );
    });

    it('does nothing when every migration is already recorded', async () => {
      const { dataSource, calls } = buildHarness();

      await baselineMigrations(dataSource, silentLogger);

      expect(calls).toEqual([LOCK, UNLOCK]);
      expect(dataSource.runMigrations).not.toHaveBeenCalled();
    });
  });
});
