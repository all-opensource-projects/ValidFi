import {
  DEFAULT_MIGRATION_COMMAND,
  MIGRATION_COMMANDS,
  resolveMigrationCommand,
} from './migration-commands';
import {
  baselineMigrations,
  revertLastMigration,
  runPendingMigrations,
} from './run-migrations';

describe('resolveMigrationCommand', () => {
  it.each([
    ['run', runPendingMigrations],
    ['revert', revertLastMigration],
    ['baseline', baselineMigrations],
  ])('resolves %s', (name, expected) => {
    expect(resolveMigrationCommand(name)).toBe(expected);
  });

  it('defaults to running pending migrations', () => {
    expect(resolveMigrationCommand(DEFAULT_MIGRATION_COMMAND)).toBe(
      runPendingMigrations,
    );
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'rejects the inherited property %s',
    (name) => {
      // A plain `name in MIGRATION_COMMANDS` would accept these and exit
      // successfully without migrating anything.
      expect(() => resolveMigrationCommand(name)).toThrow('Unknown command');
    },
  );

  it('rejects an unknown command and lists the valid ones', () => {
    expect(() => resolveMigrationCommand('bogus')).toThrow(
      'Unknown command "bogus". Expected one of: run, revert, baseline.',
    );
  });

  it('exposes exactly the three supported commands', () => {
    expect(Object.keys(MIGRATION_COMMANDS)).toEqual([
      'run',
      'revert',
      'baseline',
    ]);
  });
});
