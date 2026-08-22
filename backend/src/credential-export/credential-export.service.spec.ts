import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CredentialExportService } from './credential-export.service';
import {
  CredentialExport,
  ExportFormat,
  ExportStatus,
} from './credential-export.entity';
import { Credential } from '../credentials/credential.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';

const makeExportRepoStub = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto) => ({ ...dto })),
  save: jest.fn(async (e) => ({ id: 'export-uuid', ...e })),
});

const makeCredentialRepoStub = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto) => ({ ...dto })),
  save: jest.fn(async (e) => ({ ...e })),
});

const makeVersionRepoStub = () => ({
  find: jest.fn(),
});

const CREDENTIAL_ID = 'cred-abc-123';
const WALLET_ADDRESS = '0xWalletAddress';

const makeCredential = (
  overrides: Partial<Credential> = {},
): Credential =>
  ({
    id: CREDENTIAL_ID,
    type: 'vaccination',
    issuer: 'health-authority-1',
    holder: WALLET_ADDRESS,
    data: { vaccine: 'COVID-19', dose: 1 },
    status: 'active',
    systemSource: 'manual',
    contentHash: 'hash123',
    duplicateOfId: null,
    isDuplicate: false,
    duplicateMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Credential;

const makeExport = (
  overrides: Partial<CredentialExport> = {},
): CredentialExport =>
  ({
    id: 'export-uuid',
    requestedBy: WALLET_ADDRESS,
    format: ExportFormat.JSON,
    status: ExportStatus.COMPLETED,
    credentialIds: [CREDENTIAL_ID],
    includeMetadata: false,
    includeVersionHistory: false,
    encryptSensitiveData: true,
    encryptionKeyId: null,
    fileHash: 'abc123hash',
    storagePath: null,
    credentialCount: 1,
    fileSizeBytes: 1024,
    errorMessage: null,
    validationResults: null,
    completedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as CredentialExport;

describe('CredentialExportService', () => {
  let service: CredentialExportService;
  let exportRepo: ReturnType<typeof makeExportRepoStub>;
  let credentialRepo: ReturnType<typeof makeCredentialRepoStub>;
  let versionRepo: ReturnType<typeof makeVersionRepoStub>;

  beforeEach(async () => {
    exportRepo = makeExportRepoStub();
    credentialRepo = makeCredentialRepoStub();
    versionRepo = makeVersionRepoStub();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialExportService,
        {
          provide: getRepositoryToken(CredentialExport),
          useValue: exportRepo,
        },
        {
          provide: getRepositoryToken(Credential),
          useValue: credentialRepo,
        },
        {
          provide: getRepositoryToken(CredentialVersion),
          useValue: versionRepo,
        },
      ],
    }).compile();

    service = module.get<CredentialExportService>(CredentialExportService);
  });

  describe('createExport()', () => {
    it('creates an export record for valid credentials', async () => {
      credentialRepo.find.mockResolvedValue([makeCredential()]);
      exportRepo.save.mockResolvedValue(makeExport({ status: ExportStatus.PENDING }));

      const result = await service.createExport(
        {
          format: ExportFormat.JSON,
          credentialIds: [CREDENTIAL_ID],
        },
        WALLET_ADDRESS,
      );

      expect(result.status).toBe(ExportStatus.PENDING);
      expect(result.credentialCount).toBe(1);
      expect(exportRepo.create).toHaveBeenCalled();
    });

    it('throws BadRequestException when no credentials found', async () => {
      credentialRepo.find.mockResolvedValue([]);

      await expect(
        service.createExport(
          {
            format: ExportFormat.JSON,
            credentialIds: ['nonexistent'],
          },
          WALLET_ADDRESS,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets expiry date 24 hours in the future', async () => {
      credentialRepo.find.mockResolvedValue([makeCredential()]);
      exportRepo.save.mockImplementation(async (e) => ({
        id: 'export-uuid',
        ...e,
      }));

      const result = await service.createExport(
        {
          format: ExportFormat.JSON,
          credentialIds: [CREDENTIAL_ID],
        },
        WALLET_ADDRESS,
      );

      expect(result.expiresAt).toBeDefined();
      const expiry = new Date(result.expiresAt);
      const now = new Date();
      const diffHours =
        (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(24, 0);
    });
  });

  describe('createBatchExport()', () => {
    it('creates batch exports for filtered credentials', async () => {
      const credentials = [
        makeCredential({ id: 'cred-1' }),
        makeCredential({ id: 'cred-2' }),
      ];
      credentialRepo.find.mockResolvedValue(credentials);
      exportRepo.save.mockImplementation(async (e) => ({
        id: 'export-uuid',
        ...e,
      }));

      const result = await service.createBatchExport(
        {
          format: ExportFormat.CSV,
          batchSize: 100,
        },
        WALLET_ADDRESS,
      );

      expect(result).toHaveLength(1);
      expect(result[0].credentialCount).toBe(2);
    });

    it('splits large result sets into batches', async () => {
      const credentials = Array.from({ length: 250 }, (_, i) =>
        makeCredential({ id: `cred-${i}` }),
      );
      credentialRepo.find.mockResolvedValue(credentials);
      exportRepo.save.mockImplementation(async (e) => ({
        id: `export-${Math.random()}`,
        ...e,
      }));

      const result = await service.createBatchExport(
        {
          format: ExportFormat.JSON,
          batchSize: 100,
        },
        WALLET_ADDRESS,
      );

      expect(result).toHaveLength(3);
      expect(result[0].credentialCount).toBe(100);
      expect(result[1].credentialCount).toBe(100);
      expect(result[2].credentialCount).toBe(50);
    });

    it('throws BadRequestException when no credentials match filters', async () => {
      credentialRepo.find.mockResolvedValue([]);

      await expect(
        service.createBatchExport(
          {
            format: ExportFormat.JSON,
            credentialType: 'nonexistent',
          },
          WALLET_ADDRESS,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getExportStatus()', () => {
    it('returns export status for valid ID', async () => {
      exportRepo.findOne.mockResolvedValue(makeExport());

      const result = await service.getExportStatus('export-uuid');

      expect(result.id).toBe('export-uuid');
      expect(result.status).toBe(ExportStatus.COMPLETED);
    });

    it('throws NotFoundException for unknown export ID', async () => {
      exportRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getExportStatus('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getExportHistory()', () => {
    it('returns export history ordered by creation date', async () => {
      const exports = [
        makeExport({ id: 'export-1', createdAt: new Date('2026-01-02') }),
        makeExport({ id: 'export-2', createdAt: new Date('2026-01-01') }),
      ];
      exportRepo.find.mockResolvedValue(exports);

      const result = await service.getExportHistory(WALLET_ADDRESS);

      expect(result).toHaveLength(2);
      expect(exportRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requestedBy: WALLET_ADDRESS },
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('downloadExport()', () => {
    it('returns formatted export data for completed exports', async () => {
      exportRepo.findOne.mockResolvedValue(makeExport());
      credentialRepo.find.mockResolvedValue([makeCredential()]);

      const result = await service.downloadExport('export-uuid');

      expect(result.exportId).toBe('export-uuid');
      expect(result.format).toBe(ExportFormat.JSON);
      expect(result.data).toBeDefined();
      expect(result.mimeType).toBe('application/json');
    });

    it('throws BadRequestException for non-completed exports', async () => {
      exportRepo.findOne.mockResolvedValue(
        makeExport({ status: ExportStatus.PROCESSING }),
      );

      await expect(
        service.downloadExport('export-uuid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for expired exports', async () => {
      exportRepo.findOne.mockResolvedValue(
        makeExport({
          expiresAt: new Date(Date.now() - 86400000),
        }),
      );

      await expect(
        service.downloadExport('export-uuid'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateExportIntegrity()', () => {
    it('returns valid result for completed export with existing credentials', async () => {
      exportRepo.findOne.mockResolvedValue(makeExport());
      credentialRepo.find.mockResolvedValue([makeCredential()]);

      const result = await service.validateExportIntegrity('export-uuid');

      expect(result.isValid).toBe(true);
      expect(result.credentialCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('reports errors for missing credentials', async () => {
      exportRepo.findOne.mockResolvedValue(
        makeExport({ credentialIds: ['cred-1', 'cred-2'] }),
      );
      credentialRepo.find.mockResolvedValue([makeCredential({ id: 'cred-1' })]);

      const result = await service.validateExportIntegrity('export-uuid');

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('warns about revoked credentials', async () => {
      exportRepo.findOne.mockResolvedValue(makeExport());
      credentialRepo.find.mockResolvedValue([
        makeCredential({ status: 'revoked' }),
      ]);

      const result = await service.validateExportIntegrity('export-uuid');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('revoked');
    });
  });
});
