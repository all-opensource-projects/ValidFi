import { buildDatabaseOptions, isDevelopment } from './database.config';

const reader = (env: Record<string, string | undefined>) => (key: string) =>
  env[key];

describe('buildDatabaseOptions', () => {
  it('enables synchronize only when NODE_ENV is development', () => {
    const options = buildDatabaseOptions(reader({ NODE_ENV: 'development' }));

    expect(options.synchronize).toBe(true);
    expect(options.migrationsRun).toBe(false);
  });

  it.each(['production', 'staging', 'test', undefined])(
    'disables synchronize and runs migrations when NODE_ENV is %s',
    (nodeEnv) => {
      const options = buildDatabaseOptions(reader({ NODE_ENV: nodeEnv }));

      expect(options.synchronize).toBe(false);
      expect(options.migrationsRun).toBe(true);
    },
  );

  it('reads connection settings from the environment', () => {
    const options = buildDatabaseOptions(
      reader({
        NODE_ENV: 'production',
        DB_HOST: 'db.internal',
        DB_PORT: '6543',
        DB_USERNAME: 'validfi',
        DB_PASSWORD: 's3cret',
        DB_DATABASE: 'validfi',
      }),
    );

    expect(options).toMatchObject({
      type: 'postgres',
      host: 'db.internal',
      port: 6543,
      username: 'validfi',
      password: 's3cret',
      database: 'validfi',
    });
  });

  it('points at the migrations directory and tracking table', () => {
    const options = buildDatabaseOptions(reader({ NODE_ENV: 'production' }));

    expect(options.migrationsTableName).toBe('migrations');
    expect(options.migrations).toEqual([
      expect.stringContaining('migrations'),
    ]);
  });
});

describe('isDevelopment', () => {
  it('is false when NODE_ENV is unset', () => {
    expect(isDevelopment(reader({}))).toBe(false);
  });
});
