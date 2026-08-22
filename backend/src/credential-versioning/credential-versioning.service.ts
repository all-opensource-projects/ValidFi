import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CredentialVersion } from './credential-version.entity';
import {
  CredentialMigration,
  MigrationStatus,
} from './credential-migration.entity';
import { UpgradeCredentialDto } from './dto/upgrade-credential.dto';
import { MigrateCredentialDto } from './dto/migrate-credential.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';

export interface SnapshotInput {
  credentialId: string;
  documentHash: string;
  ipfsCid: string;
  verificationStatus: boolean;
  revoked: boolean;
  metadata?: Record<string, any> | null;
  changedBy: string;
  changeReason?: string | null;
  schemaVersion?: string;
}

/**
 * Handles all credential versioning concerns:
 *
 *  - **Snapshots** — immutable version rows appended on every credential change.
 *  - **History** — ordered retrieval of all snapshots for a credential.
 *  - **Upgrades** — bump the schema version with optimistic-locking conflict detection.
 *  - **Migrations** — record schema-level migrations (both automated and manual).
 *  - **Conflict resolution** — operator-assisted resolution of conflicted migrations.
 */
@Injectable()
export class CredentialVersioningService {
  private readonly logger = new Logger(CredentialVersioningService.name);

  constructor(
    @InjectRepository(CredentialVersion)
    private readonly versionRepo: Repository<CredentialVersion>,
    @InjectRepository(CredentialMigration)
    private readonly migrationRepo: Repository<CredentialMigration>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  /**
   * Create an immutable snapshot of the credential at its current state.
   *
   * The `versionNumber` is computed inside a serialized transaction so
   * concurrent writers cannot generate duplicate version numbers.
   *
   * @returns the newly created {@link CredentialVersion}.
   */
  async snapshotVersion(input: SnapshotInput): Promise<CredentialVersion> {
    return this.dataSource.transaction(async (manager) => {
      // Use an advisory lock keyed on the credentialId's hash to serialize
      // concurrent snapshots for the same credential without blocking others.
      const lockKey = this.credentialLockKey(input.credentialId);
      await manager.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const repo = manager.getRepository(CredentialVersion);

      const latest = await repo.findOne({
        where: { credentialId: input.credentialId },
        order: { versionNumber: 'DESC' },
      });

      const nextVersion = latest ? latest.versionNumber + 1 : 1;

      const snapshot = repo.create({
        credentialId: input.credentialId,
        versionNumber: nextVersion,
        schemaVersion: input.schemaVersion ?? latest?.schemaVersion ?? '1.0.0',
        documentHash: input.documentHash,
        ipfsCid: input.ipfsCid,
        verificationStatus: input.verificationStatus,
        revoked: input.revoked,
        metadata: input.metadata ?? null,
        changedBy: input.changedBy,
        changeReason: input.changeReason ?? null,
      });

      const saved = await repo.save(snapshot);
      this.logger.log(
        `Snapshotted credential ${input.credentialId} → v${nextVersion}`,
      );
      return saved;
    });
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all version snapshots for a credential, oldest first.
   */
  async getHistory(credentialId: string): Promise<CredentialVersion[]> {
    return this.versionRepo.find({
      where: { credentialId },
      order: { versionNumber: 'ASC' },
    });
  }

  /**
   * Retrieve a single version snapshot by credential id and version number.
   *
   * @throws {@link NotFoundException} if the combination does not exist.
   */
  async getVersion(
    credentialId: string,
    versionNumber: number,
  ): Promise<CredentialVersion> {
    const version = await this.versionRepo.findOne({
      where: { credentialId, versionNumber },
    });
    if (!version) {
      throw new NotFoundException(
        `Version ${versionNumber} not found for credential ${credentialId}`,
      );
    }
    return version;
  }

  /**
   * Retrieve the most recent snapshot for a credential.
   *
   * @throws {@link NotFoundException} if no snapshots exist.
   */
  async getCurrentVersion(credentialId: string): Promise<CredentialVersion> {
    const version = await this.versionRepo.findOne({
      where: { credentialId },
      order: { versionNumber: 'DESC' },
    });
    if (!version) {
      throw new NotFoundException(
        `No version history found for credential ${credentialId}`,
      );
    }
    return version;
  }

  // ---------------------------------------------------------------------------
  // Upgrade
  // ---------------------------------------------------------------------------

  /**
   * Upgrade the credential to a new schema version.
   *
   * If `expectedVersion` is supplied and does not match the credential's
   * current version number the operation is recorded as a **CONFLICT** and a
   * {@link ConflictException} is thrown — the caller must resolve the conflict
   * via {@link resolveConflict} before retrying.
   *
   * On success a new {@link CredentialVersion} snapshot is created with the
   * updated `schemaVersion` and the {@link CredentialMigration} is finalised.
   *
   * @returns the resulting migration record.
   */
  async upgrade(
    credentialId: string,
    dto: UpgradeCredentialDto,
    actor: string,
  ): Promise<CredentialMigration> {
    const current = await this.getCurrentVersion(credentialId);

    // --- Conflict detection (optimistic locking) ---
    if (
      dto.expectedVersion !== undefined &&
      current.versionNumber !== dto.expectedVersion
    ) {
      const migration = await this.migrationRepo.save(
        this.migrationRepo.create({
          credentialId,
          fromVersion: current.versionNumber,
          toVersion: null,
          fromSchemaVersion: current.schemaVersion,
          toSchemaVersion: dto.targetSchemaVersion,
          status: MigrationStatus.CONFLICT,
          conflictReason:
            `expectedVersion=${dto.expectedVersion} but current is ` +
            `versionNumber=${current.versionNumber}`,
          migratedBy: actor,
          resolutionNotes: null,
        }),
      );

      this.logger.warn(
        `Conflict on upgrade for credential ${credentialId}: ` +
          `expected v${dto.expectedVersion}, got v${current.versionNumber}`,
      );

      throw new ConflictException({
        message: 'Version conflict detected — resolve before retrying',
        migrationId: migration.id,
        currentVersion: current.versionNumber,
        expectedVersion: dto.expectedVersion,
      });
    }

    // --- Create pending migration record ---
    const migration = await this.migrationRepo.save(
      this.migrationRepo.create({
        credentialId,
        fromVersion: current.versionNumber,
        toVersion: null,
        fromSchemaVersion: current.schemaVersion,
        toSchemaVersion: dto.targetSchemaVersion,
        status: MigrationStatus.PENDING,
        conflictReason: null,
        migratedBy: actor,
        resolutionNotes: null,
      }),
    );

    try {
      // --- Apply upgrade: snapshot new version ---
      const upgraded = await this.snapshotVersion({
        credentialId,
        documentHash: current.documentHash,
        ipfsCid: current.ipfsCid,
        verificationStatus: current.verificationStatus,
        revoked: current.revoked,
        metadata: current.metadata,
        changedBy: actor,
        changeReason: dto.reason ?? `Schema upgrade to ${dto.targetSchemaVersion}`,
        schemaVersion: dto.targetSchemaVersion,
      });

      // --- Finalise migration record ---
      migration.status = MigrationStatus.SUCCESS;
      migration.toVersion = upgraded.versionNumber;
      await this.migrationRepo.save(migration);

      this.logger.log(
        `Credential ${credentialId} upgraded from schema ` +
          `${current.schemaVersion} → ${dto.targetSchemaVersion} (v${upgraded.versionNumber})`,
      );

      return migration;
    } catch (err) {
      migration.status = MigrationStatus.FAILED;
      migration.conflictReason =
        err instanceof Error ? err.message : String(err);
      await this.migrationRepo.save(migration);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Migrate
  // ---------------------------------------------------------------------------

  /**
   * Explicit schema migration between two specified versions.
   *
   * Similar to {@link upgrade} but validates that the credential's current
   * schema version matches `dto.fromSchemaVersion`, making it safe for batch
   * migration scripts that need strict version guards.
   *
   * @returns the resulting migration record.
   */
  async migrate(
    credentialId: string,
    dto: MigrateCredentialDto,
    actor: string,
  ): Promise<CredentialMigration> {
    const current = await this.getCurrentVersion(credentialId);

    if (current.schemaVersion !== dto.fromSchemaVersion) {
      const migration = await this.migrationRepo.save(
        this.migrationRepo.create({
          credentialId,
          fromVersion: current.versionNumber,
          toVersion: null,
          fromSchemaVersion: dto.fromSchemaVersion,
          toSchemaVersion: dto.toSchemaVersion,
          status: MigrationStatus.CONFLICT,
          conflictReason:
            `Credential schema is ${current.schemaVersion}, ` +
            `not the expected ${dto.fromSchemaVersion}`,
          migratedBy: actor,
          resolutionNotes: null,
        }),
      );

      throw new ConflictException({
        message: `Schema version mismatch: credential is at ${current.schemaVersion}`,
        migrationId: migration.id,
        currentSchemaVersion: current.schemaVersion,
        expectedSchemaVersion: dto.fromSchemaVersion,
      });
    }

    const migration = await this.migrationRepo.save(
      this.migrationRepo.create({
        credentialId,
        fromVersion: current.versionNumber,
        toVersion: null,
        fromSchemaVersion: dto.fromSchemaVersion,
        toSchemaVersion: dto.toSchemaVersion,
        status: MigrationStatus.PENDING,
        conflictReason: null,
        migratedBy: actor,
        resolutionNotes: null,
      }),
    );

    try {
      const migratedMetadata = dto.metadata
        ? { ...(current.metadata ?? {}), ...dto.metadata }
        : current.metadata;

      const migrated = await this.snapshotVersion({
        credentialId,
        documentHash: current.documentHash,
        ipfsCid: current.ipfsCid,
        verificationStatus: current.verificationStatus,
        revoked: current.revoked,
        metadata: migratedMetadata,
        changedBy: actor,
        changeReason:
          dto.reason ??
          `Migrated schema from ${dto.fromSchemaVersion} to ${dto.toSchemaVersion}`,
        schemaVersion: dto.toSchemaVersion,
      });

      migration.status = MigrationStatus.SUCCESS;
      migration.toVersion = migrated.versionNumber;
      await this.migrationRepo.save(migration);

      this.logger.log(
        `Credential ${credentialId} migrated ` +
          `${dto.fromSchemaVersion} → ${dto.toSchemaVersion} (v${migrated.versionNumber})`,
      );

      return migration;
    } catch (err) {
      migration.status = MigrationStatus.FAILED;
      migration.conflictReason =
        err instanceof Error ? err.message : String(err);
      await this.migrationRepo.save(migration);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Conflict resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a previously-conflicted migration.
   *
   * Marks the migration as RESOLVED and stores the operator's resolution
   * strategy and notes. Does not automatically retry the migration — the caller
   * must re-submit the upgrade/migrate request if desired.
   *
   * @throws {@link NotFoundException} if the migration does not exist.
   * @throws {@link ConflictException} if the migration is not in CONFLICT status.
   */
  async resolveConflict(
    migrationId: string,
    dto: ResolveConflictDto,
  ): Promise<CredentialMigration> {
    const migration = await this.migrationRepo.findOne({
      where: { id: migrationId },
    });

    if (!migration) {
      throw new NotFoundException(`Migration ${migrationId} not found`);
    }

    if (migration.status !== MigrationStatus.CONFLICT) {
      throw new ConflictException(
        `Migration ${migrationId} is in status '${migration.status}' and cannot be resolved`,
      );
    }

    migration.status = MigrationStatus.RESOLVED;
    migration.resolutionNotes = {
      strategy: dto.strategy,
      ...(dto.notes ?? {}),
    };

    const resolved = await this.migrationRepo.save(migration);
    this.logger.log(
      `Conflict on migration ${migrationId} resolved via strategy '${dto.strategy}'`,
    );
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Migrations listing
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all migration records for a credential, newest first.
   */
  async getMigrations(credentialId: string): Promise<CredentialMigration[]> {
    return this.migrationRepo.find({
      where: { credentialId },
      order: { createdAt: 'DESC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Derive a stable 32-bit integer advisory lock key for a given credential id
   * by XOR-folding the UTF-8 bytes of the UUID string.
   */
  private credentialLockKey(credentialId: string): number {
    let hash = 0;
    for (let i = 0; i < credentialId.length; i++) {
      hash = (Math.imul(31, hash) + credentialId.charCodeAt(i)) | 0;
    }
    // Ensure positive value in PostgreSQL's advisory lock range
    return Math.abs(hash) % 2_147_483_647;
  }
}
