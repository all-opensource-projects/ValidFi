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

## Production

Two independent paths apply pending migrations, so a deploy is safe either way:

1. **On startup.** `migrationsRun` is `true` whenever `NODE_ENV` is not
   `development`, so the app applies pending migrations before it serves
   traffic.
2. **From the deploy script.** `scripts/deploy-backend.sh` runs
   `npm run migration:run:prod` after the build. The `:prod` variants use the
   compiled `dist/data-source.js` and the plain `typeorm` binary, so they work
   on a host installed with `npm install --production` (no `ts-node`).

## Adding an entity

1. Write the entity as usual — it is picked up by the `*.entity.{ts,js}` glob.
2. Run `npm run migration:generate -- src/migrations/AddYourEntity` against a
   database that is current.
3. Review the generated SQL, then commit the migration alongside the entity.
