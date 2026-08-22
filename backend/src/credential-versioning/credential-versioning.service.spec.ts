import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CredentialVersioningService } from './credential-versioning.service';
import { CredentialVersion } from './credential-version.entity';
import {
  CredentialMigration,
  MigrationStatus,
} from './credential-migration.entity';

// ---------------------------------------------------------------------------
// Repository stubs
// ---------------------------------------------------------------------------

const makeVersionRepoStub = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto) => ({ ...dto })),
  save: jest.fn(async (e) => ({ id: 'ver-1', ...e })),
});

const makeMigrationRepoStub = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto) => ({ ...dto })),
  save: jest.fn(async (e) => ({ id: 'mig-1', ...e })),
});

/** Minimal DataSource stub that runs the transaction callback immediately. */
const makeDataSourceStub = (
  versionRepo: ReturnType<typeof makeVersionRepoStub>,
) => ({
  transaction: jest.fn(async (cb) => {
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue(versionRepo),
    };
    return cb(manager);
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDENTIAL_ID = 'cred-abc-123';
const ACTOR = '0xWalletActor';

const baseSnapshot = {
  credentialId: CREDENTIAL_ID,
  documentHash: 'doc-hash',
  ipfsCid: 'Qm123',
  verificationStatus: false,
  revoked: false,
  metadata: null,
  changedBy: ACTOR,
  changeReason: 'test',
  schemaVersion: '1.0.0',
};

const makeVersion = (overrides: Partial<CredentialVersion> = {}): CredentialVersion =>
  ({
    id: 'ver-uuid',
    credentialId: CREDENTIAL_ID,
    versionNumber: 1,
    schemaVersion: '1.0.0',
    documentHash: 'doc-hash',
    ipfsCid: 'Qm123',
    verificationStatus: false,
    revoked: false,
    metadata: null,
    changeReason: null,
    changedBy: ACTOR,
    createdAt: new Date(),
    ...overrides,
  } as CredentialVersion);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialVersioningService', () => {
  let service: CredentialVersioningService;
  let versionRepo: ReturnType<typeof makeVersionRepoStub>;
  let migrationRepo: ReturnType<typeof makeMigrationRepoStub>;
  let dataSource: ReturnType<typeof makeDataSourceStub>;

  beforeEach(async () => {
    versionRepo = makeVersionRepoStub();
    migrationRepo = makeMigrationRepoStub();
    dataSource = makeDataSourceStub(versionRepo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialVersioningService,
        { provide: getRepositoryToken(CredentialVersion), useValue: versionRepo },
        { provide: getRepositoryToken(CredentialMigration), useValue: migrationRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<CredentialVersioningService>(CredentialVersioningService);
  });

  // -------------------------------------------------------------------------
  // snapshotVersion
  // -------------------------------------------------------------------------

  describe('snapshotVersion()', () => {
    it('creates version 1 when no previous snapshot exists', async () => {
      versionRepo.findOne.mockResolvedValue(null);
      versionRepo.save.mockResolvedValue({ ...baseSnapshot, versionNumber: 1, id: 'ver-1' });

      const result = await service.snapshotVersion(baseSnapshot);

      expect(result.versionNumber).toBe(1);
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ versionNumber: 1, schemaVersion: '1.0.0' }),
      );
    });

    it('increments version number from the latest snapshot', async () => {
      versionRepo.findOne.mockResolvedValue(makeVersion({ versionNumber: 3 }));
      versionRepo.save.mockResolvedValue({ ...baseSnapshot, versionNumber: 4, id: 'ver-4' });

      const result = await service.snapshotVersion(baseSnapshot);

      expect(result.versionNumber).toBe(4);
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ versionNumber: 4 }),
      );
    });

    it('inherits schemaVersion from the latest snapshot when not specified', async () => {
      const latestVersion = makeVersion({ versionNumber: 1, schemaVersion: '1.5.0' });
      versionRepo.findOne.mockResolvedValue(latestVersion);
      versionRepo.save.mockResolvedValue({ ...baseSnapshot, versionNumber: 2, schemaVersion: '1.5.0', id: 'ver-2' });

      await service.snapshotVersion({ ...baseSnapshot, schemaVersion: undefined });

      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ schemaVersion: '1.5.0' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe('getHistory()', () => {
    it('returns versions ordered ASC', async () => {
      const versions = [makeVersion({ versionNumber: 1 }), makeVersion({ versionNumber: 2 })];
      versionRepo.find.mockResolvedValue(versions);

      const result = await service.getHistory(CREDENTIAL_ID);

      expect(result).toEqual(versions);
      expect(versionRepo.find).toHaveBeenCalledWith({
        where: { credentialId: CREDENTIAL_ID },
        order: { versionNumber: 'ASC' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // getVersion
  // -------------------------------------------------------------------------

  describe('getVersion()', () => {
    it('returns the requested version', async () => {
      const version = makeVersion({ versionNumber: 2 });
      versionRepo.findOne.mockResolvedValue(version);

      const result = await service.getVersion(CREDENTIAL_ID, 2);
      expect(result.versionNumber).toBe(2);
    });

    it('throws NotFoundException for unknown version', async () => {
      versionRepo.findOne.mockResolvedValue(null);
      await expect(service.getVersion(CREDENTIAL_ID, 99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getCurrentVersion
  // -------------------------------------------------------------------------

  describe('getCurrentVersion()', () => {
    it('returns the latest snapshot', async () => {
      const latest = makeVersion({ versionNumber: 5 });
      versionRepo.findOne.mockResolvedValue(latest);

      const result = await service.getCurrentVersion(CREDENTIAL_ID);
      expect(result.versionNumber).toBe(5);
    });

    it('throws NotFoundException when no snapshots exist', async () => {
      versionRepo.findOne.mockResolvedValue(null);
      await expect(service.getCurrentVersion(CREDENTIAL_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // upgrade
  // -------------------------------------------------------------------------

  describe('upgrade()', () => {
    it('creates SUCCESS migration and new snapshot on clean upgrade', async () => {
      const current = makeVersion({ versionNumber: 2, schemaVersion: '1.0.0' });
      // getCurrentVersion uses versionRepo.findOne
      versionRepo.findOne.mockResolvedValue(current);

      // snapshotVersion's internal findOne (inside transaction)
      // The DataSource transaction uses the same versionRepo stub
      versionRepo.save.mockResolvedValue({ ...current, versionNumber: 3, schemaVersion: '2.0.0', id: 'ver-3' });

      migrationRepo.save
        .mockResolvedValueOnce({ id: 'mig-1', status: MigrationStatus.PENDING, fromVersion: 2, toVersion: null })
        .mockResolvedValueOnce({ id: 'mig-1', status: MigrationStatus.SUCCESS, fromVersion: 2, toVersion: 3 });

      const dto = { targetSchemaVersion: '2.0.0' };
      const result = await service.upgrade(CREDENTIAL_ID, dto, ACTOR);

      expect(result.status).toBe(MigrationStatus.SUCCESS);
      expect(result.toVersion).toBe(3);
    });

    it('records CONFLICT and throws ConflictException when expectedVersion is stale', async () => {
      const current = makeVersion({ versionNumber: 5 });
      versionRepo.findOne.mockResolvedValue(current);
      migrationRepo.save.mockResolvedValue({
        id: 'mig-conflict',
        status: MigrationStatus.CONFLICT,
      });

      const dto = { targetSchemaVersion: '2.0.0', expectedVersion: 3 };

      await expect(service.upgrade(CREDENTIAL_ID, dto, ACTOR)).rejects.toThrow(
        ConflictException,
      );

      expect(migrationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: MigrationStatus.CONFLICT }),
      );
    });

    it('does not conflict when expectedVersion matches current', async () => {
      const current = makeVersion({ versionNumber: 4 });
      versionRepo.findOne.mockResolvedValue(current);
      versionRepo.save.mockResolvedValue({ ...current, versionNumber: 5, schemaVersion: '2.0.0', id: 'ver-5' });
      migrationRepo.save
        .mockResolvedValueOnce({ id: 'mig-2', status: MigrationStatus.PENDING, fromVersion: 4, toVersion: null })
        .mockResolvedValueOnce({ id: 'mig-2', status: MigrationStatus.SUCCESS, fromVersion: 4, toVersion: 5 });

      const dto = { targetSchemaVersion: '2.0.0', expectedVersion: 4 };
      const result = await service.upgrade(CREDENTIAL_ID, dto, ACTOR);

      expect(result.status).toBe(MigrationStatus.SUCCESS);
    });
  });

  // -------------------------------------------------------------------------
  // migrate
  // -------------------------------------------------------------------------

  describe('migrate()', () => {
    it('creates SUCCESS migration when schema versions match', async () => {
      const current = makeVersion({ versionNumber: 1, schemaVersion: '1.0.0' });
      versionRepo.findOne.mockResolvedValue(current);
      versionRepo.save.mockResolvedValue({ ...current, versionNumber: 2, schemaVersion: '1.1.0', id: 'ver-2' });
      migrationRepo.save
        .mockResolvedValueOnce({ id: 'mig-3', status: MigrationStatus.PENDING })
        .mockResolvedValueOnce({ id: 'mig-3', status: MigrationStatus.SUCCESS, toVersion: 2 });

      const dto = { fromSchemaVersion: '1.0.0', toSchemaVersion: '1.1.0' };
      const result = await service.migrate(CREDENTIAL_ID, dto, ACTOR);

      expect(result.status).toBe(MigrationStatus.SUCCESS);
    });

    it('records CONFLICT when fromSchemaVersion does not match credential', async () => {
      const current = makeVersion({ versionNumber: 1, schemaVersion: '2.0.0' });
      versionRepo.findOne.mockResolvedValue(current);
      migrationRepo.save.mockResolvedValue({
        id: 'mig-conflict',
        status: MigrationStatus.CONFLICT,
      });

      const dto = { fromSchemaVersion: '1.0.0', toSchemaVersion: '1.1.0' };

      await expect(service.migrate(CREDENTIAL_ID, dto, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });

    it('merges provided metadata with existing metadata', async () => {
      const current = makeVersion({ versionNumber: 1, schemaVersion: '1.0.0', metadata: { existing: true } });
      versionRepo.findOne.mockResolvedValue(current);
      versionRepo.save.mockResolvedValue({ ...current, versionNumber: 2, schemaVersion: '1.1.0', id: 'ver-2' });
      migrationRepo.save
        .mockResolvedValueOnce({ id: 'mig-4', status: MigrationStatus.PENDING })
        .mockResolvedValueOnce({ id: 'mig-4', status: MigrationStatus.SUCCESS, toVersion: 2 });

      const dto = { fromSchemaVersion: '1.0.0', toSchemaVersion: '1.1.0', metadata: { newField: 'hello' } };
      await service.migrate(CREDENTIAL_ID, dto, ACTOR);

      // The snapshotVersion call inside the transaction should receive merged metadata
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { existing: true, newField: 'hello' },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // resolveConflict
  // -------------------------------------------------------------------------

  describe('resolveConflict()', () => {
    it('transitions CONFLICT migration to RESOLVED', async () => {
      const migration = {
        id: 'mig-c1',
        status: MigrationStatus.CONFLICT,
        resolutionNotes: null,
      } as CredentialMigration;

      migrationRepo.findOne.mockResolvedValue(migration);
      migrationRepo.save.mockResolvedValue({
        ...migration,
        status: MigrationStatus.RESOLVED,
        resolutionNotes: { strategy: 'accept-current' },
      });

      const dto = { strategy: 'accept-current', notes: { reason: 'manual review' } };
      const result = await service.resolveConflict('mig-c1', dto);

      expect(result.status).toBe(MigrationStatus.RESOLVED);
      expect(result.resolutionNotes).toEqual(
        expect.objectContaining({ strategy: 'accept-current' }),
      );
    });

    it('throws NotFoundException for unknown migration id', async () => {
      migrationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveConflict('nonexistent', { strategy: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when migration is not in CONFLICT status', async () => {
      const migration = {
        id: 'mig-ok',
        status: MigrationStatus.SUCCESS,
      } as CredentialMigration;
      migrationRepo.findOne.mockResolvedValue(migration);

      await expect(
        service.resolveConflict('mig-ok', { strategy: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // getMigrations
  // -------------------------------------------------------------------------

  describe('getMigrations()', () => {
    it('returns all migrations for a credential newest first', async () => {
      const migrations = [
        { id: 'mig-b', createdAt: new Date('2026-01-02') },
        { id: 'mig-a', createdAt: new Date('2026-01-01') },
      ] as CredentialMigration[];
      migrationRepo.find.mockResolvedValue(migrations);

      const result = await service.getMigrations(CREDENTIAL_ID);
      expect(result).toEqual(migrations);
      expect(migrationRepo.find).toHaveBeenCalledWith({
        where: { credentialId: CREDENTIAL_ID },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
