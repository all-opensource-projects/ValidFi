# Database Migrations

The schema is owned by TypeORM migrations. `synchronize` is enabled **only**
when `NODE_ENV=development`; every other environment (including an unset
`NODE_ENV`) gets its schema exclusively from the migration files in
`src/migrations/`.

## Files

| File | Purpose |
| --- | --- |
| `src/config/database.config.ts` | Single source of truth for the connection options, shared by the Nest app and the CLI. |
| `src/data-source.ts` | `DataSource` instance the TypeORM CLI loads (`-d src/data-source.ts`). |
| `src/database/run-migrations.ts` | Run / revert / baseline, each under a PostgreSQL advisory lock. |
| `src/migrate.ts` | Standalone deploy entry point (`node dist/migrate.js <command>`). |
| `src/migrations/` | Generated migration files, applied in timestamp order. |

`src/data-source.ts` loads `.env` itself, so CLI commands pick up the same
`DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` values the
application uses.

## Commands

Run these from `backend/`:

```bash
# Apply all pending migrations
npm run migration:run

# Revert the most recently applied migration
npm run migration:revert

# List applied ([X]) and pending ([ ]) migrations
npm run migration:show

# Generate a migration from the diff between entities and the live database
npm run migration:generate -- src/migrations/DescriptiveName

# Create an empty migration to hand-write (e.g. a data backfill)
npm run migration:create -- src/migrations/DescriptiveName
```

`migration:generate` diffs your **entities** against a **live database**, so
point it at a database that is already up to date with the committed
migrations, then commit the file it writes.

## Baselining a database built by `synchronize`

Any database created before this workflow existed already has the tables, but
no row in the `migrations` table. Running `InitialSchema` against it would fail
on `CREATE TABLE "verifications"` — the table is already there.

Such a database must be **baselined once**: record the initial migration as
applied without replaying its DDL.

```bash
# 1. Confirm the live schema really does match the initial migration.
#    Silence here ("No changes in database schema were found") means they agree.
npm run migration:generate -- src/migrations/BaselineCheck

# 2. If — and only if — step 1 reported no changes, mark migrations as applied
#    without executing them.
npm run migration:baseline:prod
```

If step 1 *does* emit a migration, the live schema has drifted from the
entities. Delete the generated file, reconcile the difference deliberately, and
only then baseline. Rehearse the whole procedure against a restored copy of the
production database before touching production.

Fresh databases need none of this — `migration:run` handles them.

## Production

**Every schema change against a shared database must go through a `:prod`
command or the application's own startup path.** Those are the only routes that
take the advisory lock. The plain `migration:run` / `migration:revert` /
`migration:baseline` scripts drive the TypeORM CLI directly, take no lock, and
are meant for a developer's local database.

| Command | Effect |
| --- | --- |
| `npm run migration:run:prod` | `node dist/migrate.js run` — apply pending migrations |
| `npm run migration:revert:prod` | `node dist/migrate.js revert` — revert the last migration |
| `npm run migration:baseline:prod` | `node dist/migrate.js baseline` — record migrations as applied without running them |
| `npm run migration:show:prod` | List applied / pending migrations (read-only, no lock) |

None of these need `ts-node`, so they work on a host installed with
`npm install --production`.

Two paths apply pending migrations on a deploy, and both take the same lock, so
either order is safe:

1. **On startup.** Whenever `NODE_ENV` is not `development`, `main.ts` calls
   `runPendingMigrations` before `app.listen()`, so the app never serves
   traffic against a stale schema.
2. **From the deploy script.** `scripts/deploy-backend.sh` runs
   `npm run migration:run:prod` after the build.

### Why the advisory lock

TypeORM decides which migrations are pending *before* recording them and takes
no cross-process lock of its own. During a rolling deploy, with more than one
replica, or when an operator runs a revert while an instance is booting, two
processes can therefore each conclude the same migration is pending and run its
non-idempotent DDL twice. `withMigrationLock` wraps every schema operation in a
PostgreSQL session-level advisory lock (`MIGRATION_ADVISORY_LOCK_KEY`): the
second process blocks until the first commits and releases, then re-reads the
migrations table and finds the work already done.

The lock is held on its own connection rather than the one TypeORM uses for the
DDL. An advisory lock is a mutex between *sessions* and only has to be held for
the duration of the work it guards; holding it on a dedicated session also
keeps it alive across the several connections TypeORM opens and closes while
migrating.

This relies on a session-pooled connection. Behind a transaction-pooling proxy
(PgBouncer in `transaction` mode), session-level advisory locks are not held
across statements — point migrations at a direct connection there.

`migrationsRun` is deliberately left `false` everywhere, because TypeORM's own
bootstrap hook runs migrations inside `DataSource.initialize()`, before this
lock can be taken.

## Adding an entity

1. Write the entity as usual — it is picked up by the `*.entity.{ts,js}` glob.
2. Run `npm run migration:generate -- src/migrations/AddYourEntity` against a
   database that is current.
3. Review the generated SQL, then commit the migration alongside the entity.
