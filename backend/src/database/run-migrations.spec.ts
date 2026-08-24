import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  runPendingMigrations,
} from './run-migrations';

describe('runPendingMigrations', () => {
  const silentLogger = {
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const buildDataSource = (
    runMigrations: jest.Mock,
  ): { dataSource: DataSource; calls: string[]; query: jest.Mock } => {
    const calls: string[] = [];
    const query = jest.fn(async (sql: string) => {
      calls.push(sql);
      return [];
    });
    const queryRunner = {
      connect: jest.fn(),
      query,
      release: jest.fn(),
    };

    const dataSource = {
      createQueryRunner: () => queryRunner,
      runMigrations: jest.fn(async (...args: unknown[]) => {
        calls.push('runMigrations');
        return runMigrations(...args);
      }),
    } as unknown as DataSource;

    return { dataSource, calls, query };
  };

  beforeEach(() => jest.clearAllMocks());

  it('runs migrations between acquiring and releasing the advisory lock', async () => {
    const { dataSource, calls, query } = buildDataSource(
      jest.fn().mockResolvedValue([{ name: 'InitialSchema1' }]),
    );

    await runPendingMigrations(dataSource, silentLogger);

    expect(calls).toEqual([
      'SELECT pg_advisory_lock($1)',
      'runMigrations',
      'SELECT pg_advisory_unlock($1)',
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
  });

  it('releases the lock when a migration fails', async () => {
    const { dataSource, calls } = buildDataSource(
      jest.fn().mockRejectedValue(new Error('boom')),
    );

    await expect(
      runPendingMigrations(dataSource, silentLogger),
    ).rejects.toThrow('boom');

    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
  });

  it('runs every pending migration in a single transaction', async () => {
    const { dataSource } = buildDataSource(jest.fn().mockResolvedValue([]));

    await runPendingMigrations(dataSource, silentLogger);

    expect(dataSource.runMigrations).toHaveBeenCalledWith({
      transaction: 'all',
    });
  });
});
