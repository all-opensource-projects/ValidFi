import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SecureDeletionService } from './secure-deletion.service';
import { Credential } from './credential.entity';
import { AccessPermission } from '../access-control/access-control.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';
import { CredentialExport } from '../credential-export/credential-export.entity';
import { AuditService } from '../audit/audit.service';
import { AuditOperation, AuditStatus } from '../audit/audit-log.entity';
import { NotFoundException } from '@nestjs/common';

describe('SecureDeletionService', () => {
  let service: SecureDeletionService;
  let credentialRepo: any;
  let accessPermissionRepo: any;
  let versionRepo: any;
  let exportRepo: any;
  let auditService: any;
  let cacheManager: any;
  let dataSource: any;

  const mockCredential = {
    id: 'credential-uuid-1',
    type: 'TestCredential',
    issuer: 'GISSUER...',
    holder: 'GHOLDER...',
    data: { field1: 'sensitive-data', field2: 'more-data' },
    status: 'active',
    contentHash: 'hash123',
    duplicateMetadata: { mergedAt: '2024-01-01' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: {
      findOne: jest.fn().mockResolvedValue(mockCredential),
      remove: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    },
  };

  beforeEach(async () => {
    credentialRepo = {
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn().mockResolvedValue(mockCredential),
    };

    accessPermissionRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    versionRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    exportRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(undefined),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecureDeletionService,
        { provide: getRepositoryToken(Credential), useValue: credentialRepo },
        { provide: getRepositoryToken(AccessPermission), useValue: accessPermissionRepo },
        { provide: getRepositoryToken(CredentialVersion), useValue: versionRepo },
        { provide: getRepositoryToken(CredentialExport), useValue: exportRepo },
        { provide: AuditService, useValue: auditService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<SecureDeletionService>(SecureDeletionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('secureDelete', () => {
    it('should securely delete a credential and all related data', async () => {
      const result = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
        'Test deletion',
      );

      expect(result.credentialId).toBe('credential-uuid-1');
      expect(result.deleted).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.auditRecorded).toBe(true);
      expect(result.deletionHash).toHaveLength(64); // SHA-256 hash

      // Verify transaction was used
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      // Verify audit was recorded
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'GDELETER...',
          operationType: AuditOperation.DELETED,
          targetCredentialId: 'credential-uuid-1',
          status: AuditStatus.SUCCESS,
        }),
      );
    });

    it('should throw NotFoundException for non-existent credential', async () => {
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(null);

      await expect(
        service.secureDelete('non-existent', 'GDELETER...'),
      ).rejects.toThrow(NotFoundException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should remove access permissions during deletion', async () => {
      mockQueryRunner.manager.delete
        .mockResolvedValueOnce({ affected: 5 }) // access permissions
        .mockResolvedValueOnce({ affected: 3 }); // versions

      const result = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
      );

      expect(result.relatedDataCleared.accessPermissions).toBe(5);
      expect(result.relatedDataCleared.versions).toBe(3);
    });

    it('should clear cache entries during deletion', async () => {
      await service.secureDelete('credential-uuid-1', 'GDELETER...');

      expect(cacheManager.del).toHaveBeenCalledWith('credential:credential-uuid-1');
      expect(cacheManager.del).toHaveBeenCalledWith('credential:credential-uuid-1:versions');
      expect(cacheManager.del).toHaveBeenCalledWith('credential:credential-uuid-1:access');
      expect(cacheManager.del).toHaveBeenCalledWith('credential:credential-uuid-1:metadata');
    });

    it('should record audit entry even if cache clearing fails', async () => {
      cacheManager.del.mockRejectedValueOnce(new Error('Cache error'));

      const result = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
      );

      expect(result.deleted).toBe(true);
      expect(result.cacheCleared).toBe(false);
      expect(result.auditRecorded).toBe(true);
    });

    it('should rollback transaction on error', async () => {
      // Reset the mock to clear previous calls
      mockQueryRunner.commitTransaction.mockClear();
      
      mockQueryRunner.manager.remove.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(
        service.secureDelete('credential-uuid-1', 'GDELETER...'),
      ).rejects.toThrow('Database error');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('should securely overwrite credential data before deletion', async () => {
      await service.secureDelete('credential-uuid-1', 'GDELETER...');

      // Verify save was called (for overwriting data)
      expect(credentialRepo.save).toHaveBeenCalled();
    });
  });

  describe('verifyDeletionComplete', () => {
    it('should return verified=true when credential is fully deleted', async () => {
      credentialRepo.count.mockResolvedValue(0);
      accessPermissionRepo.count.mockResolvedValue(0);
      versionRepo.count.mockResolvedValue(0);
      cacheManager.get.mockResolvedValue(null);

      const result = await service.verifyDeletionComplete('credential-uuid-1');

      expect(result.credentialId).toBe('credential-uuid-1');
      expect(result.exists).toBe(false);
      expect(result.existsInDatabase).toBe(false);
      expect(result.existsInCache).toBe(false);
      expect(result.relatedDataExists).toBe(false);
      expect(result.verified).toBe(true);
      expect(result.details).toContain('Deletion verified: no traces found');
    });

    it('should return verified=false when credential still exists in database', async () => {
      credentialRepo.count.mockResolvedValue(1);

      const result = await service.verifyDeletionComplete('credential-uuid-1');

      expect(result.exists).toBe(true);
      expect(result.existsInDatabase).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.details).toContain('Credential still exists in database');
    });

    it('should return verified=false when credential still exists in cache', async () => {
      cacheManager.get.mockResolvedValue({ id: 'credential-uuid-1' });

      const result = await service.verifyDeletionComplete('credential-uuid-1');

      expect(result.exists).toBe(true);
      expect(result.existsInCache).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.details).toContain('Credential still exists in cache');
    });

    it('should return verified=false when related data still exists', async () => {
      accessPermissionRepo.count.mockResolvedValue(2);

      const result = await service.verifyDeletionComplete('credential-uuid-1');

      expect(result.exists).toBe(true);
      expect(result.relatedDataExists).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.details).toContain('Related data still exists');
    });

    it('should handle multiple verification failures', async () => {
      credentialRepo.count.mockResolvedValue(1);
      cacheManager.get.mockResolvedValue({ id: 'credential-uuid-1' });
      versionRepo.count.mockResolvedValue(3);

      const result = await service.verifyDeletionComplete('credential-uuid-1');

      expect(result.exists).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.details.length).toBeGreaterThan(1);
    });
  });

  describe('deletion hash generation', () => {
    it('should generate unique deletion hashes', async () => {
      const result1 = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER1...',
      );

      // Reset mocks for second call
      mockQueryRunner.manager.findOne.mockResolvedValue(mockCredential);

      const result2 = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER2...',
      );

      expect(result1.deletionHash).not.toBe(result2.deletionHash);
      expect(result1.deletionHash).toHaveLength(64);
      expect(result2.deletionHash).toHaveLength(64);
    });
  });

  describe('export updates', () => {
    it('should update exports that reference the deleted credential', async () => {
      const mockExport = {
        id: 'export-uuid-1',
        credentialIds: ['credential-uuid-1', 'other-credential'],
        validationResults: {},
      };

      mockQueryRunner.manager.find.mockResolvedValue([mockExport]);

      const result = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
      );

      expect(result.relatedDataCleared.exportsUpdated).toBe(1);
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
    });
  });

  describe('audit recording', () => {
    it('should include deletion reason in audit metadata', async () => {
      await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
        'User requested deletion',
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'User requested deletion',
          }),
        }),
      );
    });

    it('should record failure status if verification fails', async () => {
      // Make verification fail by having credential still exist
      credentialRepo.count.mockResolvedValue(1);

      const result = await service.secureDelete(
        'credential-uuid-1',
        'GDELETER...',
      );

      expect(result.verified).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AuditStatus.FAILURE,
        }),
      );
    });
  });
});
