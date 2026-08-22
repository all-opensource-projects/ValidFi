import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import {
  CredentialExport,
  ExportFormat,
  ExportStatus,
} from './credential-export.entity';
import { Credential } from '../credentials/credential.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';
import { CreateExportDto, BatchExportDto } from './dto/create-export.dto';
import {
  ExportStatusResponseDto,
  ExportValidationDto,
  ExportDownloadDto,
} from './dto/export-response.dto';

@Injectable()
export class CredentialExportService {
  private readonly logger = new Logger(CredentialExportService.name);
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private readonly EXPORT_EXPIRY_HOURS = 24;

  constructor(
    @InjectRepository(CredentialExport)
    private readonly exportRepository: Repository<CredentialExport>,
    @InjectRepository(Credential)
    private readonly credentialRepository: Repository<Credential>,
    @InjectRepository(CredentialVersion)
    private readonly versionRepository: Repository<CredentialVersion>,
  ) {}

  async createExport(
    dto: CreateExportDto,
    requestedBy: string,
  ): Promise<CredentialExport> {
    const credentials = await this.credentialRepository.find({
      where: { id: In(dto.credentialIds) },
    });

    if (credentials.length === 0) {
      throw new BadRequestException('No valid credentials found for the provided IDs');
    }

    const validation = await this.validateExportRequest(
      credentials,
      dto.format,
    );

    if (!validation.isValid) {
      throw new BadRequestException({
        message: 'Export validation failed',
        errors: validation.errors,
      });
    }

    const exportRecord = this.exportRepository.create({
      requestedBy,
      format: dto.format,
      credentialIds: dto.credentialIds,
      includeMetadata: dto.includeMetadata ?? false,
      includeVersionHistory: dto.includeVersionHistory ?? false,
      encryptSensitiveData: dto.encryptSensitiveData ?? true,
      credentialCount: credentials.length,
      status: ExportStatus.PENDING,
      expiresAt: this.calculateExpiryDate(),
    });

    const saved = await this.exportRepository.save(exportRecord);

    this.processExport(saved.id, credentials).catch((err) => {
      this.logger.error(`Export ${saved.id} failed: ${err.message}`);
    });

    return saved;
  }

  async createBatchExport(
    dto: BatchExportDto,
    requestedBy: string,
  ): Promise<CredentialExport[]> {
    const batchSize = dto.batchSize ?? 100;
    const query: any = {};

    if (dto.holderAddress) {
      query.holder = dto.holderAddress;
    }
    if (dto.credentialType) {
      query.type = dto.credentialType;
    }
    if (dto.status) {
      query.status = dto.status;
    }

    const allCredentials = await this.credentialRepository.find({
      where: query,
    });

    if (allCredentials.length === 0) {
      throw new BadRequestException('No credentials match the specified filters');
    }

    const batches: Credential[][] = [];
    for (let i = 0; i < allCredentials.length; i += batchSize) {
      batches.push(allCredentials.slice(i, i + batchSize));
    }

    const exports: CredentialExport[] = [];
    for (const batch of batches) {
      const exportRecord = this.exportRepository.create({
        requestedBy,
        format: dto.format,
        credentialIds: batch.map((c) => c.id),
        includeMetadata: dto.includeMetadata ?? false,
        includeVersionHistory: dto.includeVersionHistory ?? false,
        encryptSensitiveData: dto.encryptSensitiveData ?? true,
        credentialCount: batch.length,
        status: ExportStatus.PENDING,
        expiresAt: this.calculateExpiryDate(),
      });

      const saved = await this.exportRepository.save(exportRecord);
      exports.push(saved);

      this.processExport(saved.id, batch).catch((err) => {
        this.logger.error(`Batch export ${saved.id} failed: ${err.message}`);
      });
    }

    return exports;
  }

  async getExportStatus(exportId: string): Promise<ExportStatusResponseDto> {
    const exportRecord = await this.exportRepository.findOne({
      where: { id: exportId },
    });

    if (!exportRecord) {
      throw new NotFoundException(`Export ${exportId} not found`);
    }

    return this.mapToStatusResponse(exportRecord);
  }

  async getExportHistory(
    requestedBy: string,
    limit = 20,
  ): Promise<ExportStatusResponseDto[]> {
    const exports = await this.exportRepository.find({
      where: { requestedBy },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return exports.map((e) => this.mapToStatusResponse(e));
  }

  async downloadExport(exportId: string): Promise<ExportDownloadDto> {
    const exportRecord = await this.exportRepository.findOne({
      where: { id: exportId },
    });

    if (!exportRecord) {
      throw new NotFoundException(`Export ${exportId} not found`);
    }

    if (exportRecord.status !== ExportStatus.COMPLETED) {
      throw new BadRequestException(
        `Export is not ready for download. Current status: ${exportRecord.status}`,
      );
    }

    if (exportRecord.expiresAt && new Date() > exportRecord.expiresAt) {
      throw new BadRequestException('Export has expired');
    }

    const credentials = await this.credentialRepository.find({
      where: { id: In(exportRecord.credentialIds) },
    });

    const exportData = await this.formatExportData(
      credentials,
      exportRecord.format,
      exportRecord.includeMetadata,
      exportRecord.includeVersionHistory,
      exportRecord.encryptSensitiveData,
    );

    return {
      exportId: exportRecord.id,
      format: exportRecord.format,
      data: exportData.content,
      filename: exportData.filename,
      mimeType: exportData.mimeType,
      fileHash: exportRecord.fileHash,
    };
  }

  async validateExportIntegrity(
    exportId: string,
  ): Promise<ExportValidationDto> {
    const exportRecord = await this.exportRepository.findOne({
      where: { id: exportId },
    });

    if (!exportRecord) {
      throw new NotFoundException(`Export ${exportId} not found`);
    }

    const warnings: string[] = [];
    const errors: string[] = [];

    if (exportRecord.status !== ExportStatus.COMPLETED) {
      errors.push(`Export status is ${exportRecord.status}, not completed`);
    }

    if (exportRecord.expiresAt && new Date() > exportRecord.expiresAt) {
      warnings.push('Export has expired');
    }

    const credentials = await this.credentialRepository.find({
      where: { id: In(exportRecord.credentialIds) },
    });

    const foundIds = new Set(credentials.map((c) => c.id));
    const missingIds = exportRecord.credentialIds.filter(
      (id) => !foundIds.has(id),
    );

    if (missingIds.length > 0) {
      errors.push(
        `${missingIds.length} credentials no longer exist: ${missingIds.join(', ')}`,
      );
    }

    const revokedCount = credentials.filter(
      (c) => c.status === 'revoked',
    ).length;
    if (revokedCount > 0) {
      warnings.push(
        `${revokedCount} credentials in export have been revoked`,
      );
    }

    return {
      isValid: errors.length === 0,
      credentialCount: credentials.length,
      totalSizeBytes: Number(exportRecord.fileSizeBytes),
      warnings,
      errors,
    };
  }

  private async processExport(
    exportId: string,
    credentials: Credential[],
  ): Promise<void> {
    const exportRecord = await this.exportRepository.findOne({
      where: { id: exportId },
    });

    if (!exportRecord) return;

    try {
      exportRecord.status = ExportStatus.PROCESSING;
      await this.exportRepository.save(exportRecord);

      const exportData = await this.formatExportData(
        credentials,
        exportRecord.format,
        exportRecord.includeMetadata,
        exportRecord.includeVersionHistory,
        exportRecord.encryptSensitiveData,
      );

      const fileHash = this.computeHash(exportData.content);

      exportRecord.status = ExportStatus.COMPLETED;
      exportRecord.fileHash = fileHash;
      exportRecord.fileSizeBytes = Buffer.byteLength(
        typeof exportData.content === 'string'
          ? exportData.content
          : exportData.content.toString(),
      );
      exportRecord.completedAt = new Date();
      exportRecord.validationResults = {
        credentialCount: credentials.length,
        format: exportRecord.format,
        encrypted: exportRecord.encryptSensitiveData,
        hashAlgorithm: 'sha256',
      };

      await this.exportRepository.save(exportRecord);
      this.logger.log(
        `Export ${exportId} completed: ${credentials.length} credentials, ${exportRecord.fileSizeBytes} bytes`,
      );
    } catch (err) {
      exportRecord.status = ExportStatus.FAILED;
      exportRecord.errorMessage =
        err instanceof Error ? err.message : String(err);
      await this.exportRepository.save(exportRecord);
      throw err;
    }
  }

  private async formatExportData(
    credentials: Credential[],
    format: ExportFormat,
    includeMetadata: boolean,
    includeVersionHistory: boolean,
    encryptSensitive: boolean,
  ): Promise<{ content: string | Buffer; filename: string; mimeType: string }> {
    let versionHistory: Map<string, CredentialVersion[]> = new Map();

    if (includeVersionHistory) {
      for (const cred of credentials) {
        const versions = await this.versionRepository.find({
          where: { credentialId: cred.id },
          order: { versionNumber: 'ASC' },
        });
        versionHistory.set(cred.id, versions);
      }
    }

    const preparedData = credentials.map((cred) => {
      const base: any = {
        id: cred.id,
        type: cred.type,
        issuer: cred.issuer,
        holder: cred.holder,
        status: cred.status,
        contentHash: cred.contentHash,
        createdAt: cred.createdAt,
        updatedAt: cred.updatedAt,
      };

      if (includeMetadata) {
        base.metadata = {
          systemSource: cred.systemSource,
          isDuplicate: cred.isDuplicate,
          duplicateOfId: cred.duplicateOfId,
          duplicateMetadata: cred.duplicateMetadata,
        };
      }

      if (includeVersionHistory) {
        base.versionHistory = versionHistory.get(cred.id) || [];
      }

      if (encryptSensitive) {
        base.data = this.encryptSensitiveFields(cred.data);
      } else {
        base.data = cred.data;
      }

      return base;
    });

    switch (format) {
      case ExportFormat.JSON:
        return this.formatAsJson(preparedData);
      case ExportFormat.CSV:
        return this.formatAsCsv(preparedData);
      case ExportFormat.PDF:
        return this.formatAsPdf(preparedData);
      case ExportFormat.VERIFIABLE_CREDENTIAL:
        return this.formatAsVerifiableCredential(preparedData);
      default:
        throw new BadRequestException(`Unsupported export format: ${format}`);
    }
  }

  private formatAsJson(data: any[]): {
    content: string;
    filename: string;
    mimeType: string;
  } {
    const exportPayload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      credentialCount: data.length,
      credentials: data,
    };

    return {
      content: JSON.stringify(exportPayload, null, 2),
      filename: `credentials-export-${Date.now()}.json`,
      mimeType: 'application/json',
    };
  }

  private formatAsCsv(data: any[]): {
    content: string;
    filename: string;
    mimeType: string;
  } {
    if (data.length === 0) {
      return { content: '', filename: 'export.csv', mimeType: 'text/csv' };
    }

    const headers = [
      'id',
      'type',
      'issuer',
      'holder',
      'status',
      'contentHash',
      'createdAt',
      'updatedAt',
    ];

    const rows = data.map((item) =>
      headers
        .map((h) => {
          const val = item[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(','),
    );

    return {
      content: [headers.join(','), ...rows].join('\n'),
      filename: `credentials-export-${Date.now()}.csv`,
      mimeType: 'text/csv',
    };
  }

  private formatAsPdf(data: any[]): {
    content: Buffer;
    filename: string;
    mimeType: string;
  } {
    const textContent = data
      .map(
        (cred) =>
          `Credential ID: ${cred.id}\n` +
          `Type: ${cred.type}\n` +
          `Issuer: ${cred.issuer}\n` +
          `Holder: ${cred.holder || 'N/A'}\n` +
          `Status: ${cred.status}\n` +
          `Created: ${cred.createdAt}\n` +
          `---`,
      )
      .join('\n\n');

    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${textContent.length + 100} >>
stream
BT
/F1 12 Tf
50 742 Td
${textContent.replace(/\n/g, '\n0 -14 Td\n')} T*
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;

    return {
      content: Buffer.from(pdfContent),
      filename: `credentials-export-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  private formatAsVerifiableCredential(data: any[]): {
    content: string;
    filename: string;
    mimeType: string;
  } {
    const vc = {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://validfi.io/credentials/v1',
      ],
      type: ['VerifiableCredential', 'CredentialExport'],
      issuer: 'did:validfi:export-service',
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        exportedCredentials: data.map((cred) => ({
          id: `urn:uuid:${cred.id}`,
          type: cred.type,
          issuer: cred.issuer,
          holder: cred.holder,
          status: cred.status,
          data: cred.data,
        })),
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: 'did:validfi:export-service#key-1',
      },
    };

    return {
      content: JSON.stringify(vc, null, 2),
      filename: `credentials-export-${Date.now()}.jsonld`,
      mimeType: 'application/ld+json',
    };
  }

  private encryptSensitiveFields(
    data: Record<string, any>,
  ): Record<string, any> {
    if (!data || typeof data !== 'object') return data;

    const sensitiveKeys = [
      'ssn',
      'dateOfBirth',
      'medicalRecord',
      'diagnosis',
      'medication',
      'treatment',
      'allergies',
      'bloodType',
    ];

    const encrypted = { ...data };

    for (const key of Object.keys(encrypted)) {
      if (
        sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))
      ) {
        encrypted[key] = this.encryptValue(String(encrypted[key]));
      } else if (
        typeof encrypted[key] === 'object' &&
        encrypted[key] !== null
      ) {
        encrypted[key] = this.encryptSensitiveFields(encrypted[key]);
      }
    }

    return encrypted;
  }

  private encryptValue(value: string): string {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private computeHash(content: string | Buffer): string {
    return createHash('sha256')
      .update(typeof content === 'string' ? content : content.toString())
      .digest('hex');
  }

  private calculateExpiryDate(): Date {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + this.EXPORT_EXPIRY_HOURS);
    return expiry;
  }

  private async validateExportRequest(
    credentials: Credential[],
    format: ExportFormat,
  ): Promise<ExportValidationDto> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (credentials.length > 1000) {
      errors.push('Export exceeds maximum of 1000 credentials per request');
    }

    const revokedCount = credentials.filter(
      (c) => c.status === 'revoked',
    ).length;
    if (revokedCount > 0) {
      warnings.push(
        `${revokedCount} credentials are revoked and will be included`,
      );
    }

    const duplicateCount = credentials.filter((c) => c.isDuplicate).length;
    if (duplicateCount > 0) {
      warnings.push(
        `${duplicateCount} credentials are marked as duplicates`,
      );
    }

    if (format === ExportFormat.PDF && credentials.length > 100) {
      warnings.push(
        'PDF exports with >100 credentials may have performance issues',
      );
    }

    return {
      isValid: errors.length === 0,
      credentialCount: credentials.length,
      totalSizeBytes: 0,
      warnings,
      errors,
    };
  }

  private mapToStatusResponse(
    exportRecord: CredentialExport,
  ): ExportStatusResponseDto {
    return {
      id: exportRecord.id,
      status: exportRecord.status,
      format: exportRecord.format,
      credentialCount: exportRecord.credentialCount,
      fileSizeBytes: Number(exportRecord.fileSizeBytes),
      fileHash: exportRecord.fileHash,
      storagePath: exportRecord.storagePath,
      errorMessage: exportRecord.errorMessage,
      validationResults: exportRecord.validationResults,
      createdAt: exportRecord.createdAt,
      completedAt: exportRecord.completedAt,
      expiresAt: exportRecord.expiresAt,
    };
  }
}
